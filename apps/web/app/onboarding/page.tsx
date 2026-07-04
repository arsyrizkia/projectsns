"use client";

import { useActionState, useState } from "react";
import { createWorkspace, type OnboardingState } from "./actions";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default function OnboardingPage() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    createWorkspace,
    {},
  );
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">Create your workspace</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          A workspace holds your brand profile, connected social accounts, and
          content calendar.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Company / brand name</span>
            <input
              name="name"
              required
              autoFocus
              onChange={(e) => {
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Workspace URL</span>
            <div className="mt-1 flex items-center gap-1 text-sm">
              <span className="text-zinc-400">/w/</span>
              <input
                name="slug"
                required
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </div>
          </label>

          {state.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </div>
    </main>
  );
}
