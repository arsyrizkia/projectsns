import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Root: route the user to login, onboarding, or their first workspace. */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // RLS returns only workspaces the user is a member of
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("slug")
    .order("created_at")
    .limit(1);

  const slug = workspaces?.[0]?.slug;
  redirect(slug ? `/w/${slug}` : "/onboarding");
}
