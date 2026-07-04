import type { SupabaseClient } from "@supabase/supabase-js";

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

/** RLS-scoped lookup — returns null unless the current user is a member. */
export async function getWorkspaceBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<WorkspaceRow | null> {
  const { data } = await supabase
    .from("workspaces")
    .select("id, name, slug, timezone")
    .eq("slug", slug)
    .single();
  return (data as WorkspaceRow | null) ?? null;
}
