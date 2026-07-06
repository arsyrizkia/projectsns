import { encryptSecret } from "@projectsns/core/crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { nonceCookieName, verifyState } from "@/lib/oauth/state";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USERINFO_URL =
  "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  refresh_expires_in: z.number().optional(),
  open_id: z.string().optional(),
  scope: z.string().optional(),
});

const UserinfoSchema = z.object({
  data: z.object({
    user: z.object({
      open_id: z.string().min(1),
      display_name: z.string().optional(),
      username: z.string().optional(),
      avatar_url: z.string().optional(),
    }),
  }),
});

function redirectClearingNonce(to: string): NextResponse {
  const res = NextResponse.redirect(to);
  res.cookies.set(nonceCookieName("tiktok"), "", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/api/oauth/tiktok",
  });
  return res;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const appOrigin = process.env.APP_ORIGIN ?? url.origin;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!stateSecret || !clientKey || !clientSecret) {
    return redirectClearingNonce(`${appOrigin}/?error=oauth_config`);
  }

  const payload = verifyState(url.searchParams.get("state") ?? "", stateSecret);
  if (!payload || payload.platform !== "tiktok") {
    return redirectClearingNonce(`${appOrigin}/?error=oauth_state`);
  }

  const admin = createAdminClient();
  const { data: workspace } = await admin
    .from("workspaces")
    .select("id, slug")
    .eq("id", payload.workspaceId)
    .single();
  if (!workspace) {
    return redirectClearingNonce(`${appOrigin}/?error=workspace_not_found`);
  }
  const channelsUrl = `${appOrigin}/w/${workspace.slug}/channels`;
  const failTo = (code: string) => redirectClearingNonce(`${channelsUrl}?error=${code}`);

  const nonceCookie = request.cookies.get(nonceCookieName("tiktok"))?.value;
  if (!nonceCookie || nonceCookie !== payload.nonce) return failTo("state_mismatch");
  if (url.searchParams.get("error")) return failTo("oauth_denied");
  const code = url.searchParams.get("code");
  if (!code) return failTo("missing_code");

  let tokenJson: unknown;
  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${appOrigin}/api/oauth/tiktok/callback`,
      }),
    });
    if (!tokenRes.ok) return failTo("token_exchange");
    tokenJson = await tokenRes.json();
  } catch {
    return failTo("token_exchange");
  }
  const token = TokenResponseSchema.safeParse(tokenJson);
  if (!token.success) return failTo("token_exchange");

  let userinfoJson: unknown;
  try {
    const userinfoRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token.data.access_token}` },
    });
    if (!userinfoRes.ok) return failTo("userinfo");
    userinfoJson = await userinfoRes.json();
  } catch {
    return failTo("userinfo");
  }
  const userinfo = UserinfoSchema.safeParse(userinfoJson);
  if (!userinfo.success) return failTo("userinfo");
  const u = userinfo.data.data.user;
  const openId = token.data.open_id ?? u.open_id;

  const scopes = token.data.scope ? token.data.scope.split(/[,\s]+/).filter(Boolean) : [];
  const now = Date.now();

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .upsert(
      {
        workspace_id: workspace.id,
        platform: "tiktok",
        display_name: u.display_name ?? u.username ?? "TikTok account",
        external_account_id: openId,
        avatar_url: u.avatar_url ?? null,
        scopes,
        token_expires_at: new Date(now + token.data.expires_in * 1000).toISOString(),
        refresh_token_expires_at: token.data.refresh_expires_in
          ? new Date(now + token.data.refresh_expires_in * 1000).toISOString()
          : null,
        status: "active",
        // audited stays false until the app passes TikTok's content-posting
        // audit; the connector uses the inbox-draft path while it's false.
        platform_meta: { open_id: openId, username: u.username ?? null, audited: false },
        created_by: payload.userId,
      },
      { onConflict: "workspace_id,platform,external_account_id" },
    )
    .select("id")
    .single();
  if (channelError || !channel) return failTo("channel_upsert");

  const { error: secretError } = await admin.from("channel_secrets").upsert({
    channel_id: channel.id,
    access_token_ciphertext: encryptSecret(token.data.access_token),
    refresh_token_ciphertext: token.data.refresh_token
      ? encryptSecret(token.data.refresh_token)
      : null,
    updated_at: new Date().toISOString(),
  });
  if (secretError) return failTo("secret_upsert");

  await admin.from("activity_log").insert({
    workspace_id: workspace.id,
    actor_user_id: payload.userId,
    action: "channel.connected",
    entity_type: "channel",
    entity_id: channel.id,
    meta: { platform: "tiktok", external_account_id: openId },
  });

  return redirectClearingNonce(`${channelsUrl}?connected=tiktok`);
}
