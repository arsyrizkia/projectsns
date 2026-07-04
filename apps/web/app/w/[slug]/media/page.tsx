import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceBySlug } from "@/lib/workspace";

export default async function MediaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) notFound();

  const { data: assets } = await supabase
    .from("media_assets")
    .select("id, public_url, kind, mime, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(60);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Media</h1>
      <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {(assets ?? []).map((a) => (
          <div
            key={a.id}
            className="aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
          >
            {a.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.public_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                video
              </div>
            )}
          </div>
        ))}
      </div>
      {(assets ?? []).length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
          Uploads from the composer appear here.
        </p>
      )}
    </div>
  );
}
