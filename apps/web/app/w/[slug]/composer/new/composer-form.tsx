"use client";

import { useActionState, useState } from "react";
import { createPost, type ComposeState } from "../actions";

interface ChannelOption {
  id: string;
  platform: string;
  display_name: string;
  approval_mode: string;
  status: string;
}

export function ComposerForm({
  slug,
  channels,
}: {
  slug: string;
  channels: ChannelOption[];
}) {
  const [state, formAction, pending] = useActionState<ComposeState, FormData>(
    createPost,
    {},
  );
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [localTime, setLocalTime] = useState("");

  // datetime-local has no timezone — convert to ISO before submit
  const scheduledIso =
    mode === "schedule" && localTime ? new Date(localTime).toISOString() : "";

  if (channels.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
        Connect a channel first, then come back to compose.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <input type="hidden" name="slug" value={slug} />
      {scheduledIso && <input type="hidden" name="scheduledAt" value={scheduledIso} />}

      <label className="block">
        <span className="text-sm font-medium">Caption</span>
        <textarea
          name="caption"
          required
          rows={5}
          maxLength={3000}
          placeholder="What do you want to share?"
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">Publish to</legend>
        <div className="mt-2 space-y-2">
          {channels.map((ch) => (
            <label
              key={ch.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <input type="checkbox" name="channelIds" value={ch.id} />
              <span className="font-medium">{ch.display_name}</span>
              <span className="text-xs uppercase text-zinc-400">{ch.platform}</span>
              {ch.approval_mode === "manual" && (
                <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
                  needs approval
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm font-medium">Image (optional)</span>
        <input
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/gif"
          className="mt-1 block w-full text-sm text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-zinc-800"
        />
      </label>

      <fieldset className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="when"
            checked={mode === "now"}
            onChange={() => setMode("now")}
          />
          Post now
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="when"
            checked={mode === "schedule"}
            onChange={() => setMode("schedule")}
          />
          Schedule
        </label>
        {mode === "schedule" && (
          <input
            type="datetime-local"
            required
            value={localTime}
            onChange={(e) => setLocalTime(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
        )}
      </fieldset>

      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Saving…" : mode === "now" ? "Publish" : "Schedule"}
      </button>
    </form>
  );
}
