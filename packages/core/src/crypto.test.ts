import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto.js";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

describe("secret envelope crypto", () => {
  it("roundtrips utf8 plaintext", () => {
    const secret = "sk-ant-api03-abc123-🔑-token";
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret);
  });

  it("produces distinct ciphertexts per call (random IV)", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("uses the v1 envelope format", () => {
    expect(encryptSecret("x", KEY)).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  it("rejects tampered ciphertext", () => {
    const env = encryptSecret("secret", KEY);
    const [v, iv, blob] = env.split(":") as [string, string, string];
    const bytes = Buffer.from(blob, "base64");
    bytes[0]! ^= 0xff;
    expect(() =>
      decryptSecret(`${v}:${iv}:${bytes.toString("base64")}`, KEY),
    ).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decryptSecret(encryptSecret("secret", KEY), OTHER_KEY)).toThrow();
  });

  it("rejects unknown envelope versions", () => {
    const env = encryptSecret("secret", KEY).replace(/^v1:/, "v9:");
    expect(() => decryptSecret(env, KEY)).toThrow(/envelope format/);
  });

  it("rejects short keys", () => {
    expect(() => encryptSecret("x", Buffer.from("short").toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});
