"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Approve a pending target: flip to queued and enqueue its publish job. */
export async function approveTarget(formData: FormData): Promise<void> {
  const targetId = String(formData.get("targetId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!targetId) return;

  const supabase = await createClient();
  // RLS-scoped read proves membership
  const { data: target } = await supabase
    .from("post_targets")
    .select("id, workspace_id, status, post_id")
    .eq("id", targetId)
    .single();
  if (!target || target.status !== "pending_approval") return;

  const { error: updateErr } = await supabase
    .from("post_targets")
    .update({ status: "queued" })
    .eq("id", targetId);
  if (updateErr) return;

  const { data: post } = await supabase
    .from("posts")
    .select("scheduled_at")
    .eq("id", target.post_id)
    .single();
  const scheduledAt: string | null = post?.scheduled_at ?? null;
  const runAt =
    scheduledAt && new Date(scheduledAt) > new Date()
      ? scheduledAt
      : new Date().toISOString();

  const admin = createAdminClient();
  await admin.from("publish_jobs").insert({
    post_target_id: targetId,
    workspace_id: target.workspace_id,
    run_at: runAt,
  });

  revalidatePath(`/w/${slug}/posts`);
}

/** Skip a pending target (it will never publish). */
export async function skipTarget(formData: FormData): Promise<void> {
  const targetId = String(formData.get("targetId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!targetId) return;

  const supabase = await createClient();
  await supabase
    .from("post_targets")
    .update({ status: "skipped" })
    .eq("id", targetId)
    .eq("status", "pending_approval");

  revalidatePath(`/w/${slug}/posts`);
}
