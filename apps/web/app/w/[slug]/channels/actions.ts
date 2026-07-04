"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Per-channel approval mode toggle (RLS: members may update channels). */
export async function setApprovalMode(formData: FormData): Promise<void> {
  const channelId = String(formData.get("channelId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!channelId || !["auto", "manual"].includes(mode)) return;

  const supabase = await createClient();
  await supabase
    .from("channels")
    .update({ approval_mode: mode })
    .eq("id", channelId);

  revalidatePath(`/w/${slug}/channels`);
}
