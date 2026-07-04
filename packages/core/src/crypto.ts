import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for OAuth tokens and BYO API keys at rest.
 * Format: `v1:<b64 iv>:<b64 ciphertext||tag>` — the version prefix enables
 * key rotation (introduce v2 with a new key, decrypt falls back by prefix).
 *
 * The key never lives in the database: 32 bytes, base64, from TOKEN_ENC_KEY
 * (droplet: /etc/projectsns.env, mode 600).
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(explicit?: string): Buffer {
  const raw = explicit ?? process.env.TOKEN_ENC_KEY;
  if (!raw) throw new Error("TOKEN_ENC_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64-encoded");
  }
  return key;
}

export function encryptSecret(plaintext: string, key?: string): string {
  const k = loadKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${Buffer.concat([ct, tag]).toString("base64")}`;
}

export function decryptSecret(envelope: string, key?: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("Unrecognized secret envelope format");
  }
  const k = loadKey(key);
  const iv = Buffer.from(parts[1]!, "base64");
  const blob = Buffer.from(parts[2]!, "base64");
  if (iv.length !== IV_BYTES || blob.length < TAG_BYTES) {
    throw new Error("Malformed secret envelope");
  }
  const ct = blob.subarray(0, blob.length - TAG_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
