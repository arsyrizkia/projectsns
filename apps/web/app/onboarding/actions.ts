"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const WorkspaceInput = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, "lowercase letters, digits, dashes"),
});

export type OnboardingState = { error?: string };

export async function createWorkspace(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = WorkspaceInput.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });

  if (error) {
    if (error.code === "23505") return { error: "That URL slug is already taken." };
    return { error: error.message };
  }

  redirect(`/w/${parsed.data.slug}`);
}
