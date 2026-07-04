"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceBySlug } from "@/lib/workspace";

const CONTENT_TYPE_BY_PLATFORM: Record<string, string> = {
  linkedin: "linkedin_post",
  instagram: "ig_feed",
  tiktok: "tiktok_video",
  fake: "fake_post",
};

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const Input = z.object({
  slug: z.string(),
  caption: z.string().trim().min(1).max(3000),
  channelIds: z.array(z.string().uuid()).min(1),
  scheduledAt: z.string().datetime().optional(),
});

export type ComposeState = { error?: string };

export async function createPost(
  _prev: ComposeState,
  formData: FormData,
): Promise<ComposeState> {
  const parsed = Input.safeParse({
    slug: formData.get("slug"),
    caption: formData.get("caption"),
    channelIds: formData.getAll("channelIds").map(String),
    scheduledAt: formData.get("scheduledAt") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, caption, channelIds, scheduledAt } = parsed.data;

  const supabase = await createClient();
  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) return { error: "Workspace not found" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // channels must belong to this workspace (RLS scopes the read)
  const { data: channels } = await supabase
    .from("channels")
    .select("id, platform, approval_mode, status")
    .eq("workspace_id", workspace.id)
    .in("id", channelIds);
  if (!channels || channels.length !== channelIds.length) {
    return { error: "Unknown channel selected" };
  }
  const inactive = channels.find((c) => c.status !== "active");
  if (inactive) return { error: `Channel needs reconnecting (${inactive.platform})` };

  // optional image upload → public bucket → media_assets
  let mediaAssetId: string | null = null;
  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    if (!IMAGE_MIMES.includes(file.type)) return { error: "Image must be JPEG/PNG/GIF" };
    if (file.size > MAX_IMAGE_BYTES) return { error: "Image over 8MB" };

    const admin = createAdminClient();
    const ext = file.type.split("/")[1] ?? "jpg";
    const path = `${workspace.id}/${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();
    const { error: upErr } = await admin.storage
      .from("media")
      .upload(path, bytes, { contentType: file.type });
    if (upErr) return { error: `Upload failed: ${upErr.message}` };

    const publicUrl = admin.storage.from("media").getPublicUrl(path).data.publicUrl;
    const { data: asset, error: assetErr } = await supabase
      .from("media_assets")
      .insert({
        workspace_id: workspace.id,
        storage_path: path,
        public_url: publicUrl,
        kind: "image",
        mime: file.type,
        size_bytes: file.size,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (assetErr) return { error: assetErr.message };
    mediaAssetId = asset.id;
  }

  const runAt = scheduledAt ? new Date(scheduledAt) : new Date();

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .insert({
      workspace_id: workspace.id,
      internal_title: caption.slice(0, 60),
      base_caption: caption,
      scheduled_at: runAt.toISOString(),
      status: "scheduled",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (postErr) return { error: postErr.message };

  const admin = createAdminClient();
  let anyPending = false;

  for (const ch of channels) {
    const needsApproval = ch.approval_mode === "manual";
    anyPending ||= needsApproval;

    const { data: target, error: targetErr } = await supabase
      .from("post_targets")
      .insert({
        post_id: post.id,
        channel_id: ch.id,
        workspace_id: workspace.id,
        content_type: CONTENT_TYPE_BY_PLATFORM[ch.platform] ?? "fake_post",
        caption,
        media_asset_id: mediaAssetId,
        status: needsApproval ? "pending_approval" : "queued",
      })
      .select("id")
      .single();
    if (targetErr) return { error: targetErr.message };

    if (!needsApproval) {
      // queue writes are service-role only
      const { error: jobErr } = await admin.from("publish_jobs").insert({
        post_target_id: target.id,
        workspace_id: workspace.id,
        run_at: runAt.toISOString(),
      });
      if (jobErr) return { error: jobErr.message };
    }
  }

  if (anyPending) {
    await supabase
      .from("posts")
      .update({ status: "pending_approval" })
      .eq("id", post.id);
  }

  redirect(`/w/${slug}/posts`);
}
