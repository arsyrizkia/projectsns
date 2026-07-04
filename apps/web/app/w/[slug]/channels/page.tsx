import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceBySlug } from "@/lib/workspace";
import { setApprovalMode } from "./actions";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  needs_reauth: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  disconnected: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { connected, error } = await searchParams;
  const supabase = await createClient();
  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) notFound();

  const { data: channels } = await supabase
    .from("channels")
    .select(
      "id, platform, display_name, status, approval_mode, token_expires_at, avatar_url",
    )
    .eq("workspace_id", workspace.id)
    .order("created_at");

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Channels</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Connect the social accounts this workspace publishes to.
      </p>

      {connected && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {connected} connected successfully.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Connection failed: {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {(channels ?? []).map((ch) => (
          <div
            key={ch.id}
            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div>
              <div className="font-medium">
                {ch.display_name}
                <span className="ml-2 text-xs uppercase text-zinc-400">
                  {ch.platform}
                </span>
              </div>
              <span
                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[ch.status] ?? ""}`}
              >
                {ch.status.replace("_", " ")}
              </span>
            </div>
            <form action={setApprovalMode}>
              <input type="hidden" name="channelId" value={ch.id} />
              <input type="hidden" name="slug" value={workspace.slug} />
              <input
                type="hidden"
                name="mode"
                value={ch.approval_mode === "auto" ? "manual" : "auto"}
              />
              <button
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                title="Toggle whether posts to this channel need manual approval"
              >
                {ch.approval_mode === "auto" ? "Auto-post: on" : "Approval required"}
              </button>
            </form>
          </div>
        ))}
        {(channels ?? []).length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
            No channels connected yet.
          </p>
        )}
      </div>

      <div className="mt-8 flex gap-3">
        <a
          href={`/api/oauth/linkedin/start?workspace=${workspace.slug}`}
          className="rounded-lg bg-[#0a66c2] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Connect LinkedIn
        </a>
        <button
          disabled
          title="Phase 2"
          className="cursor-not-allowed rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-400 dark:bg-zinc-800"
        >
          Instagram (soon)
        </button>
        <button
          disabled
          title="Phase 5"
          className="cursor-not-allowed rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-400 dark:bg-zinc-800"
        >
          TikTok (soon)
        </button>
      </div>
    </div>
  );
}
