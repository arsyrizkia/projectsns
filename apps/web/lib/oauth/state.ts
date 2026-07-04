import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Signed OAuth state: `base64url(JSON payload) + "." + base64url(HMAC-SHA256)`.
 * Pure functions — the secret is always passed in, never read from env here.
 */

const StatePayloadSchema = z.object({
  nonce: z.string().min(1),
  workspaceId: z.uuid(),
  userId: z.uuid(),
  platform: z.string().min(1),
});
export type OAuthStatePayload = z.infer<typeof StatePayloadSchema>;

function hmac(encoded: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encoded).digest();
}

export function signState(payload: OAuthStatePayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${hmac(encoded, secret).toString("base64url")}`;
}

export function verifyState(state: string, secret: string): OAuthStatePayload | null {
  const dot = state.indexOf(".");
  if (dot <= 0 || dot === state.length - 1) return null;
  const encoded = state.slice(0, dot);
  const sig = Buffer.from(state.slice(dot + 1), "base64url");
  const expected = hmac(encoded, secret);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const result = StatePayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function nonceCookieName(platform: string): string {
  return `${platform}_oauth_nonce`;
}
