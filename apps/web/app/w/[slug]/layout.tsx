import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const NAV = [
  { href: "", label: "Dashboard" },
  { href: "/calendar", label: "Calendar" },
  { href: "/posts", label: "Posts" },
  { href: "/suggestions", label: "AI Suggestions" },
  { href: "/media", label: "Media" },
  { href: "/channels", label: "Channels" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
] as const;

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS: only returns the workspace if the user is a member
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  if (!workspace) notFound();

  return (
    <div className="flex flex-1">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 px-2">
          <div className="text-xs uppercase tracking-wide text-zinc-400">
            Workspace
          </div>
          <div className="truncate font-semibold">{workspace.name}</div>
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={`/w/${workspace.slug}${item.href}`}
              className="rounded-lg px-2 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action="/auth/signout" method="post" className="mt-auto px-2">
          <button className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            Sign out
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
