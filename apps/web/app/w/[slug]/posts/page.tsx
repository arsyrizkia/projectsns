import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceBySlug } from "@/lib/workspace";
import { approveTarget, skipTarget } from "./actions";

const TARGET_BADGE: Record<string, string> = {
  pending_approval:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  queued: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  publishing: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  published:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  needs_review: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  skipped: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export default async function PostsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) notFound();

  const { data: posts } = await supabase
    .from("posts")
    .select(
      `id, internal_title, base_caption, scheduled_at, status,
       post_targets (
         id, status, content_type, external_post_url,
         channels ( display_name, platform )
       )`,
    )
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <Link
          href={`/w/${slug}/composer/new`}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Compose
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {(posts ?? []).map((post) => (
          <div
            key={post.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-baseline justify-between gap-4">
              <p className="line-clamp-2 text-sm">{post.base_caption}</p>
              <span className="shrink-0 text-xs text-zinc-400">
                {post.scheduled_at
                  ? new Date(post.scheduled_at).toLocaleString()
                  : "—"}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {(post.post_targets ?? []).map((t) => {
                const ch = t.channels as unknown as {
                  display_name: string;
                  platform: string;
                } | null;
                return (
                  <div key={t.id} className="flex items-center gap-3 text-sm">
                    <span className="text-zinc-500">
                      {ch?.display_name}
                      <span className="ml-1 text-xs uppercase text-zinc-400">
                        {ch?.platform}
                      </span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${TARGET_BADGE[t.status] ?? ""}`}
                    >
                      {t.status.replace("_", " ")}
                    </span>
                    {t.external_post_url && (
                      <a
                        href={t.external_post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        view live ↗
                      </a>
                    )}
                    {t.status === "pending_approval" && (
                      <span className="ml-auto flex gap-2">
                        <form action={approveTarget}>
                          <input type="hidden" name="targetId" value={t.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <button className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500">
                            Approve
                          </button>
                        </form>
                        <form action={skipTarget}>
                          <input type="hidden" name="targetId" value={t.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <button className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                            Skip
                          </button>
                        </form>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {(posts ?? []).length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
            Nothing here yet — compose your first post.
          </p>
        )}
      </div>
    </div>
  );
}
