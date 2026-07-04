import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceBySlug } from "@/lib/workspace";
import { ComposerForm } from "./composer-form";

export default async function NewPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) notFound();

  const { data: channels } = await supabase
    .from("channels")
    .select("id, platform, display_name, approval_mode, status")
    .eq("workspace_id", workspace.id)
    .eq("status", "active")
    .order("created_at");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Compose</h1>
      <ComposerForm slug={workspace.slug} channels={channels ?? []} />
    </div>
  );
}
