import { encryptSecret } from "@projectsns/core/crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { nonceCookieName, verifyState } from "@/lib/oauth/state";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const REQUESTED_SCOPES = ["openid", "profile", "email", "w_member_social"];

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
  scope: z.string().optional(),
});

const UserinfoSchema = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
  picture: z.string().optional(),
});

function redirectClearingNonce(to: string): NextResponse {
  const res = NextResponse.redirect(to);
  res.cookies.set(nonceCookieName("linkedin"), "", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/api/oauth/linkedin",
  });
  return res;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const appOrigin = process.env.APP_ORIGIN ?? url.origin;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!stateSecret || !clientId || !clientSecret) {
    return redirectClearingNonce(`${appOrigin}/?error=oauth_config`);
  }

  // no workspace context until the state verifies — fall back to the root
  const payload = verifyState(url.searchParams.get("state") ?? "", stateSecret);
  if (!payload || payload.platform !== "linkedin") {
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

  const nonceCookie = request.cookies.get(nonceCookieName("linkedin"))?.value;
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
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appOrigin}/api/oauth/linkedin/callback`,
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
  const { sub, name, picture } = userinfo.data;

  // LinkedIn returns granted scopes comma-separated; fall back to requested
  const scopes = token.data.scope
    ? token.data.scope.split(/[,\s]+/).filter(Boolean)
    : REQUESTED_SCOPES;
  const now = Date.now();

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .upsert(
      {
        workspace_id: workspace.id,
        platform: "linkedin",
        display_name: name ?? "LinkedIn member",
        external_account_id: sub,
        avatar_url: picture ?? null,
        scopes,
        token_expires_at: new Date(now + token.data.expires_in * 1000).toISOString(),
        refresh_token_expires_at: token.data.refresh_token_expires_in
          ? new Date(now + token.data.refresh_token_expires_in * 1000).toISOString()
          : null,
        status: "active",
        // author URN is data-driven: person now, organization after the
        // Community Management upgrade (reconnect, not a code change)
        platform_meta: { urn: `urn:li:person:${sub}`, urnType: "person" },
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
    meta: { platform: "linkedin", external_account_id: sub },
  });

  return redirectClearingNonce(`${channelsUrl}?connected=linkedin`);
}
