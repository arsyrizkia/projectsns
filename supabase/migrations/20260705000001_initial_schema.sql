-- ProjectSNS initial schema
-- Multi-workspace social automation platform: tenancy, channels, content,
-- publish queue, AI, analytics, audit. RLS everywhere; secrets tables are
-- service-role-only (no policies + revoked grants).

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tenancy
-- ---------------------------------------------------------------------------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  timezone text not null default 'Asia/Jakarta',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- membership helpers (defined after workspace_members exists — sql-language
-- function bodies are parse-validated at creation time)
create or replace function private.is_member(ws uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function private.is_owner(ws uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'owner'
  );
$$;

create table company_profiles (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  company_name text not null default '',
  industry text not null default '',
  description text not null default '',
  target_audience text not null default '',
  tone_of_voice text not null default '',
  language text not null default 'id',
  content_pillars jsonb not null default '[]',
  goals jsonb not null default '[]',
  brand jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table workspace_settings (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  ai_model text not null default 'claude-sonnet-5',
  ai_daily_generation_limit int not null default 20,
  anthropic_key_last4 text,
  updated_at timestamptz not null default now()
);

-- creating a workspace and its owner membership must be atomic
create or replace function public.create_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into workspaces (name, slug, created_by)
  values (p_name, p_slug, auth.uid())
  returning id into ws_id;
  insert into workspace_members (workspace_id, user_id, role)
  values (ws_id, auth.uid(), 'owner');
  insert into company_profiles (workspace_id) values (ws_id);
  insert into workspace_settings (workspace_id) values (ws_id);
  return ws_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- secrets (service-role only: RLS enabled with NO policies + revoked grants)
-- ---------------------------------------------------------------------------

create table workspace_secrets (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  anthropic_key_ciphertext text,
  updated_at timestamptz not null default now()
);

create table channel_secrets (
  channel_id uuid primary key,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- channels
-- ---------------------------------------------------------------------------

create table channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'instagram', 'tiktok', 'fake')),
  display_name text not null,
  external_account_id text not null,
  avatar_url text,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_refresh_at timestamptz,
  last_refresh_error text,
  approval_mode text not null default 'manual' check (approval_mode in ('auto', 'manual')),
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'disconnected')),
  platform_meta jsonb not null default '{}',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_account_id)
);

alter table channel_secrets
  add constraint channel_secrets_channel_fk
  foreign key (channel_id) references channels (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- content
-- ---------------------------------------------------------------------------

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  bucket text not null default 'media',
  storage_path text not null,
  public_url text not null,
  kind text not null check (kind in ('image', 'video')),
  mime text not null,
  width int,
  height int,
  duration_s numeric,
  size_bytes bigint not null,
  source text not null default 'upload' check (source in ('upload', 'ai_generated')),
  ai_prompt text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table ai_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind text not null check (kind in ('suggestions', 'image_template')),
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  est_cost_usd numeric not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  generation_id uuid references ai_generations (id) on delete set null,
  title text not null,
  rationale text not null default '',
  pillar text,
  suggested_slot timestamptz,
  variants jsonb not null default '[]',
  status text not null default 'new' check (status in ('new', 'accepted', 'dismissed')),
  accepted_post_id uuid,
  created_at timestamptz not null default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  internal_title text not null default '',
  base_caption text not null default '',
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'scheduled', 'publishing',
    'published', 'partially_published', 'failed', 'canceled'
  )),
  ai_suggestion_id uuid references ai_suggestions (id) on delete set null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ai_suggestions
  add constraint ai_suggestions_accepted_post_fk
  foreign key (accepted_post_id) references posts (id) on delete set null;

create table post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  content_type text not null check (content_type in (
    'linkedin_post', 'ig_feed', 'ig_story', 'ig_reel', 'tiktok_video', 'fake_post'
  )),
  caption text not null default '',
  media_asset_id uuid references media_assets (id) on delete set null,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'queued', 'publishing',
    'published', 'failed', 'skipped', 'needs_review'
  )),
  external_post_id text,
  external_post_url text,
  error jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, channel_id)
);

-- ---------------------------------------------------------------------------
-- publish queue
-- ---------------------------------------------------------------------------

create table publish_jobs (
  id uuid primary key default gen_random_uuid(),
  post_target_id uuid not null unique references post_targets (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  run_at timestamptz not null,
  state text not null default 'pending' check (state in (
    'pending', 'claimed', 'processing', 'succeeded', 'failed', 'dead'
  )),
  attempt int not null default 0,
  max_attempts int not null default 5,
  next_retry_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  progress jsonb not null default '{}',
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index publish_jobs_due_idx on publish_jobs (state, run_at);

create table worker_heartbeat (
  worker_id text primary key,
  last_seen timestamptz not null default now(),
  version text not null default 'dev'
);

-- ---------------------------------------------------------------------------
-- analytics
-- ---------------------------------------------------------------------------

create table analytics_account_daily (
  channel_id uuid not null references channels (id) on delete cascade,
  date date not null,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  followers int,
  impressions int,
  reach int,
  engagements int,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (channel_id, date)
);

create table analytics_post_snapshots (
  post_target_id uuid not null references post_targets (id) on delete cascade,
  snapshot_date date not null,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  impressions int,
  likes int,
  comments int,
  shares int,
  saves int,
  video_views int,
  engagement_rate numeric,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (post_target_id, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------

create table activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index activity_log_ws_idx on activity_log (workspace_id, created_at desc);
create index posts_ws_sched_idx on posts (workspace_id, scheduled_at);
create index post_targets_ws_idx on post_targets (workspace_id, status);
create index media_assets_ws_idx on media_assets (workspace_id, created_at desc);
create index ai_suggestions_ws_idx on ai_suggestions (workspace_id, status);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger channels_updated_at before update on channels
  for each row execute function private.set_updated_at();
create trigger posts_updated_at before update on posts
  for each row execute function private.set_updated_at();
create trigger post_targets_updated_at before update on post_targets
  for each row execute function private.set_updated_at();
create trigger publish_jobs_updated_at before update on publish_jobs
  for each row execute function private.set_updated_at();
create trigger company_profiles_updated_at before update on company_profiles
  for each row execute function private.set_updated_at();
create trigger workspace_settings_updated_at before update on workspace_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table company_profiles enable row level security;
alter table workspace_settings enable row level security;
alter table workspace_secrets enable row level security;
alter table channel_secrets enable row level security;
alter table channels enable row level security;
alter table media_assets enable row level security;
alter table ai_generations enable row level security;
alter table ai_suggestions enable row level security;
alter table posts enable row level security;
alter table post_targets enable row level security;
alter table publish_jobs enable row level security;
alter table worker_heartbeat enable row level security;
alter table analytics_account_daily enable row level security;
alter table analytics_post_snapshots enable row level security;
alter table activity_log enable row level security;

-- secrets: NO policies, and belt-and-braces revoke (service role only)
revoke all on workspace_secrets from anon, authenticated;
revoke all on channel_secrets from anon, authenticated;

-- workspaces: members read; creation via create_workspace() only
create policy workspaces_select on workspaces
  for select using (private.is_member(id));

-- workspace_members: members can see the member list; owners manage it
create policy members_select on workspace_members
  for select using (private.is_member(workspace_id));
create policy members_insert on workspace_members
  for insert with check (private.is_owner(workspace_id));
create policy members_update on workspace_members
  for update using (private.is_owner(workspace_id));
create policy members_delete on workspace_members
  for delete using (private.is_owner(workspace_id) or user_id = auth.uid());

-- company profile: members read, owners write
create policy company_profiles_select on company_profiles
  for select using (private.is_member(workspace_id));
create policy company_profiles_update on company_profiles
  for update using (private.is_owner(workspace_id));

-- settings: members read, owners write
create policy workspace_settings_select on workspace_settings
  for select using (private.is_member(workspace_id));
create policy workspace_settings_update on workspace_settings
  for update using (private.is_owner(workspace_id));

-- channels: members read + update approval mode etc.; owners delete;
-- inserts happen server-side (OAuth callback, service role)
create policy channels_select on channels
  for select using (private.is_member(workspace_id));
create policy channels_update on channels
  for update using (private.is_member(workspace_id));
create policy channels_delete on channels
  for delete using (private.is_owner(workspace_id));

-- content: members full CRUD (simple two-role model)
create policy media_select on media_assets
  for select using (private.is_member(workspace_id));
create policy media_insert on media_assets
  for insert with check (private.is_member(workspace_id) and created_by = auth.uid());
create policy media_delete on media_assets
  for delete using (private.is_member(workspace_id));

create policy posts_select on posts
  for select using (private.is_member(workspace_id));
create policy posts_insert on posts
  for insert with check (private.is_member(workspace_id) and created_by = auth.uid());
create policy posts_update on posts
  for update using (private.is_member(workspace_id));
create policy posts_delete on posts
  for delete using (private.is_member(workspace_id));

create policy post_targets_select on post_targets
  for select using (private.is_member(workspace_id));
create policy post_targets_insert on post_targets
  for insert with check (private.is_member(workspace_id));
create policy post_targets_update on post_targets
  for update using (private.is_member(workspace_id));
create policy post_targets_delete on post_targets
  for delete using (private.is_member(workspace_id));

-- queue: members can watch job status; writes are worker-only (service role)
create policy publish_jobs_select on publish_jobs
  for select using (private.is_member(workspace_id));

-- ai: members read/insert; status updates by members
create policy ai_generations_select on ai_generations
  for select using (private.is_member(workspace_id));
create policy ai_generations_insert on ai_generations
  for insert with check (private.is_member(workspace_id));

create policy ai_suggestions_select on ai_suggestions
  for select using (private.is_member(workspace_id));
create policy ai_suggestions_insert on ai_suggestions
  for insert with check (private.is_member(workspace_id));
create policy ai_suggestions_update on ai_suggestions
  for update using (private.is_member(workspace_id));

-- analytics: members read; worker writes (service role)
create policy analytics_account_select on analytics_account_daily
  for select using (private.is_member(workspace_id));
create policy analytics_post_select on analytics_post_snapshots
  for select using (private.is_member(workspace_id));

-- audit: members read; user-action inserts by members, system via service role
create policy activity_select on activity_log
  for select using (private.is_member(workspace_id));
create policy activity_insert on activity_log
  for insert with check (private.is_member(workspace_id) and actor_user_id = auth.uid());

-- worker_heartbeat: any authenticated user may read (staleness banner)
create policy heartbeat_select on worker_heartbeat
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- storage: public media bucket (Instagram pull-model requires public URLs);
-- unguessable {workspace_id}/{uuid}.{ext} paths; writes gated by membership
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy media_objects_insert on storage.objects
  for insert with check (
    bucket_id = 'media'
    and private.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy media_objects_delete on storage.objects
  for delete using (
    bucket_id = 'media'
    and private.is_member(((storage.foldername(name))[1])::uuid)
  );
