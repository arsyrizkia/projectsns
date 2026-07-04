import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { nonceCookieName, signState } from "@/lib/oauth/state";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceBySlug } from "@/lib/workspace";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
// w_member_social = personal-profile posting; OpenID Connect for member id
const SCOPES = "openid profile email w_member_social";

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

  // RLS-scoped: resolves only if the user is a member of the workspace
  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  const appOrigin = process.env.APP_ORIGIN;
  if (!clientId || !stateSecret || !appOrigin) {
    return NextResponse.json({ error: "linkedin oauth not configured" }, { status: 500 });
  }

  const nonce = randomBytes(16).toString("base64url");
  const state = signState(
    { nonce, workspaceId: workspace.id, userId: user.id, platform: "linkedin" },
    stateSecret,
  );

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${appOrigin}/api/oauth/linkedin/callback`);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", SCOPES);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(nonceCookieName("linkedin"), nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: appOrigin.startsWith("https://"),
    maxAge: 600,
    path: "/api/oauth/linkedin",
  });
  return response;
}
