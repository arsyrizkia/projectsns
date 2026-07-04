import { createClient } from "@/lib/supabase/server";

const STALE_MS = 2 * 60 * 1000;

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const [{ data: workspace }, { data: heartbeats }] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("slug", slug).single(),
    supabase
      .from("worker_heartbeat")
      .select("worker_id, last_seen, version")
      .order("last_seen", { ascending: false })
      .limit(1),
  ]);

  const hb = heartbeats?.[0];
  const workerAlive =
    !!hb && Date.now() - new Date(hb.last_seen).getTime() < STALE_MS;

  const [{ count: channelCount }, { count: postCount }] = await Promise.all([
    supabase
      .from("channels")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace?.id ?? ""),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace?.id ?? ""),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">{workspace?.name}</h1>

      {!workerAlive && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Publishing worker is not reporting a heartbeat — scheduled posts will
          not go out until it&apos;s back.
        </div>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dt className="text-sm text-zinc-500">Connected channels</dt>
          <dd className="mt-1 text-2xl font-semibold">{channelCount ?? 0}</dd>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dt className="text-sm text-zinc-500">Posts</dt>
          <dd className="mt-1 text-2xl font-semibold">{postCount ?? 0}</dd>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dt className="text-sm text-zinc-500">Worker</dt>
          <dd className="mt-1 text-2xl font-semibold">
            {workerAlive ? "🟢 live" : "🔴 down"}
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-sm text-zinc-500">
        Next: connect a channel under <span className="font-medium">Channels</span>,
        fill in your company profile under{" "}
        <span className="font-medium">Settings</span>, then compose or let the AI
        suggest your first post.
      </p>
    </div>
  );
}
