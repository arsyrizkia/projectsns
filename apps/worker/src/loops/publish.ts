import {
  ConnectorError,
  decryptSecret,
  getConnector,
  type Db,
  type Platform,
  type TokenSet,
} from "@projectsns/core";

const CLAIM_BATCH = 5;
/** backoff after attempt n (1-based): 1m, 5m, 30m, 2h, 6h */
const BACKOFF_S = [60, 300, 1800, 7200, 21600] as const;
const STUCK_AFTER_MIN = 10;
const DRY_RUN = process.env.CONNECTOR_DRY_RUN === "1";

interface ClaimedJob {
  id: string;
  post_target_id: string;
  workspace_id: string;
  attempt: number;
  max_attempts: number;
  progress: Record<string, unknown>;
}

/** One tick: claim due jobs with SKIP LOCKED and run them sequentially. */
export async function publishLoopTick(db: Db, workerId: string): Promise<void> {
  const jobs = await db.begin(async (tx) => {
    const claimed = await tx<ClaimedJob[]>`
      select id, post_target_id, workspace_id, attempt, max_attempts, progress
      from publish_jobs
      where state = 'pending'
        and run_at <= now()
        and (next_retry_at is null or next_retry_at <= now())
      order by run_at
      for update skip locked
      limit ${CLAIM_BATCH}
    `;
    if (claimed.length > 0) {
      await tx`
        update publish_jobs
        set state = 'claimed', claimed_by = ${workerId}, claimed_at = now(), updated_at = now()
        where id in ${tx(claimed.map((j) => j.id))}
      `;
    }
    return claimed;
  });

  for (const job of jobs) {
    await executeJob(db, job);
  }
}

async function executeJob(db: Db, job: ClaimedJob): Promise<void> {
  // guard: only publish targets still in a publishable state
  const moved = await db`
    update post_targets
    set status = 'publishing', updated_at = now()
    where id = ${job.post_target_id} and status in ('queued', 'approved')
    returning id
  `;
  if (moved.length === 0) {
    await db`
      update publish_jobs
      set state = 'failed', last_error = ${db.json({ code: "target_not_queued" })}, updated_at = now()
      where id = ${job.id}
    `;
    return;
  }

  await db`
    update publish_jobs set state = 'processing', updated_at = now() where id = ${job.id}
  `;

  try {
    const [row] = await db<
      {
        target_id: string;
        content_type: string;
        caption: string | null;
        platform: Platform;
        platform_meta: Record<string, unknown>;
        access_token_ciphertext: string;
        refresh_token_ciphertext: string | null;
        media_meta: Record<string, unknown> | null;
        media_url: string | null;
      }[]
    >`
      select
        pt.id as target_id,
        pt.content_type,
        pt.caption,
        c.platform,
        c.platform_meta,
        cs.access_token_ciphertext,
        cs.refresh_token_ciphertext,
        case when ma.id is null then null else jsonb_build_object(
          'kind', ma.kind, 'mime', ma.mime, 'sizeBytes', ma.size_bytes,
          'width', ma.width, 'height', ma.height, 'durationS', ma.duration_s
        ) end as media_meta,
        ma.public_url as media_url
      from post_targets pt
      join channels c on c.id = pt.channel_id
      join channel_secrets cs on cs.channel_id = c.id
      left join media_assets ma on ma.id = pt.media_asset_id
      where pt.id = ${job.post_target_id}
    `;
    if (!row) throw new ConnectorError("target_missing", "post target row vanished");

    const tokens: TokenSet = {
      accessToken: decryptSecret(row.access_token_ciphertext),
      refreshToken: row.refresh_token_ciphertext
        ? decryptSecret(row.refresh_token_ciphertext)
        : undefined,
    };

    const connector = getConnector(row.platform);
    const result = await connector.publish({
      tokens,
      platformMeta: row.platform_meta ?? {},
      target: {
        targetId: row.target_id,
        contentType: row.content_type as never,
        caption: row.caption ?? "",
        media: row.media_meta
          ? ({ ...row.media_meta, publicUrl: row.media_url ?? undefined } as never)
          : undefined,
      },
      progress: job.progress ?? {},
      saveProgress: async (patch) => {
        // db.json (not a ::jsonb cast) — a cast makes the driver double-encode
        // the patch into a jsonb string and `||` array-concats instead of merging
        await db`
          update publish_jobs
          set progress = progress || ${db.json(patch as never)}, updated_at = now()
          where id = ${job.id}
        `;
        Object.assign(job.progress, patch);
      },
      dryRun: DRY_RUN,
      log: (msg, meta) => console.log(`[publish:${job.id}] ${msg}`, meta ?? ""),
    });

    await db.begin(async (tx) => {
      await tx`
        update publish_jobs set state = 'succeeded', updated_at = now() where id = ${job.id}
      `;
      await tx`
        update post_targets
        set status = 'published',
            external_post_id = ${result.externalPostId},
            external_post_url = ${result.externalPostUrl ?? null},
            published_at = now(),
            updated_at = now()
        where id = ${job.post_target_id}
      `;
      await tx`
        insert into activity_log (workspace_id, action, entity_type, entity_id, meta)
        values (${job.workspace_id}, 'post.published', 'post_target', ${job.post_target_id},
                ${tx.json({ externalPostId: result.externalPostId, warnings: result.warnings ?? [] })})
      `;
    });
  } catch (err) {
    await handlePublishError(db, job, err);
  }
}

async function handlePublishError(db: Db, job: ClaimedJob, err: unknown): Promise<void> {
  const retryable = err instanceof ConnectorError ? err.retryable : true; // unknown errors: retry
  const attempt = job.attempt + 1;
  const errJson = {
    code: err instanceof ConnectorError ? err.code : "unknown",
    message: err instanceof Error ? err.message : String(err),
  };

  if (retryable && attempt < job.max_attempts) {
    const backoff = BACKOFF_S[Math.min(attempt - 1, BACKOFF_S.length - 1)]!;
    await db.begin(async (tx) => {
      await tx`
        update publish_jobs
        set state = 'pending', attempt = ${attempt},
            next_retry_at = now() + make_interval(secs => ${backoff}),
            last_error = ${tx.json(errJson)}, updated_at = now()
        where id = ${job.id}
      `;
      await tx`
        update post_targets set status = 'queued', updated_at = now()
        where id = ${job.post_target_id}
      `;
    });
    return;
  }

  await db.begin(async (tx) => {
    await tx`
      update publish_jobs
      set state = 'dead', attempt = ${attempt},
          last_error = ${tx.json(errJson)}, updated_at = now()
      where id = ${job.id}
    `;
    await tx`
      update post_targets
      set status = 'failed', error = ${tx.json(errJson)}, updated_at = now()
      where id = ${job.post_target_id}
    `;
    await tx`
      insert into activity_log (workspace_id, action, entity_type, entity_id, meta)
      values (${job.workspace_id}, 'job.dead_lettered', 'publish_job', ${job.id}, ${tx.json(errJson)})
    `;
  });
}

/**
 * Rescue jobs stuck in claimed/processing (worker crash). Resolution by
 * progress shape: externalPostId → it went out, mark published; a final
 * non-idempotent call in flight (finalCallSent) → needs_review, never blind
 * retry; anything else → back to pending (checkpoints make resume safe).
 */
export async function reaperTick(db: Db): Promise<void> {
  const stuck = await db<
    { id: string; post_target_id: string; workspace_id: string; progress: Record<string, unknown> }[]
  >`
    select id, post_target_id, workspace_id, progress
    from publish_jobs
    where state in ('claimed', 'processing')
      and claimed_at < now() - make_interval(mins => ${STUCK_AFTER_MIN})
  `;

  for (const job of stuck) {
    if (job.progress?.["externalPostId"]) {
      await db.begin(async (tx) => {
        await tx`update publish_jobs set state = 'succeeded', updated_at = now() where id = ${job.id}`;
        await tx`
          update post_targets
          set status = 'published', external_post_id = ${String(job.progress["externalPostId"])},
              published_at = now(), updated_at = now()
          where id = ${job.post_target_id}
        `;
      });
    } else if (job.progress?.["finalCallSent"]) {
      await db.begin(async (tx) => {
        await tx`
          update publish_jobs
          set state = 'failed', last_error = ${tx.json({ code: "ambiguous_final_call" })}, updated_at = now()
          where id = ${job.id}
        `;
        await tx`
          update post_targets set status = 'needs_review', updated_at = now()
          where id = ${job.post_target_id}
        `;
        await tx`
          insert into activity_log (workspace_id, action, entity_type, entity_id, meta)
          values (${job.workspace_id}, 'job.needs_review', 'publish_job', ${job.id},
                  ${tx.json({ reason: "worker crashed during final publish call" })})
        `;
      });
    } else {
      await db`
        update publish_jobs
        set state = 'pending', claimed_by = null, claimed_at = null, updated_at = now()
        where id = ${job.id}
      `;
    }
  }
}
