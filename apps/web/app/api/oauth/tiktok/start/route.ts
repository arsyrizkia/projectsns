import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { nonceCookieName, signState } from "@/lib/oauth/state";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceBySlug } from "@/lib/workspace";

const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
// posting (upload=inbox, publish=direct), analytics (video.list), identity + stats.
// TikTok separates scopes with commas.
const SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.upload",
  "video.publish",
  "video.list",
].join(",");

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("workspace");
  if (!slug) {
    return NextResponse.json({ error: "workspace param required" }, { status: 400 });
  }

  // /api/oauth is excluded from the auth middleware — enforce auth here
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  const appOrigin = process.env.APP_ORIGIN;
  if (!clientKey || !stateSecret || !appOrigin) {
    return NextResponse.json({ error: "tiktok oauth not configured" }, { status: 500 });
  }

  const nonce = randomBytes(16).toString("base64url");
  const state = signState(
    { nonce, workspaceId: workspace.id, userId: user.id, platform: "tiktok" },
    stateSecret,
  );

  // Confidential (server-side) client with a secret — PKCE is optional here.
  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_key", clientKey);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("redirect_uri", `${appOrigin}/api/oauth/tiktok/callback`);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(nonceCookieName("tiktok"), nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: appOrigin.startsWith("https://"),
    maxAge: 600,
    path: "/api/oauth/tiktok",
  });
  return response;
}
