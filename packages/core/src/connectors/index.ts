import type { Platform } from "../types.js";
import { FakeConnector } from "./fake.js";
import { LinkedInConnector } from "./linkedin/index.js";
import { TikTokConnector } from "./tiktok/index.js";
import type { Connector } from "./types.js";

export * from "./types.js";
export { FakeConnector } from "./fake.js";
export { LinkedInConnector, LINKEDIN_VERSION } from "./linkedin/index.js";
export { TikTokConnector } from "./tiktok/index.js";

const registry = new Map<Platform, Connector>([
  ["fake", new FakeConnector()],
  ["linkedin", new LinkedInConnector()],
  ["tiktok", new TikTokConnector()],
]);

/** Real connectors register here as they land (Phase 1: linkedin, Phase 2: instagram, Phase 5: tiktok). */
export function registerConnector(connector: Connector): void {
  registry.set(connector.platform, connector);
}

export function getConnector(platform: Platform): Connector {
  const c = registry.get(platform);
  if (!c) throw new Error(`No connector registered for platform: ${platform}`);
  return c;
}
