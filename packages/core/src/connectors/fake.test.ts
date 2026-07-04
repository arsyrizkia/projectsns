import { describe, expect, it } from "vitest";
import { ConnectorError } from "../types.js";
import { FakeConnector } from "./fake.js";
import type { PublishContext } from "./types.js";

function makeCtx(
  platformMeta: Record<string, unknown> = {},
  progress: Record<string, unknown> = {},
): PublishContext {
  return {
    tokens: { accessToken: "t" },
    platformMeta,
    target: { targetId: "t1", contentType: "fake_post", caption: "hello" },
    progress,
    async saveProgress(patch) {
      Object.assign(progress, patch);
    },
    dryRun: false,
    log() {},
  };
}

describe("FakeConnector", () => {
  it("publishes deterministically", async () => {
    const c = new FakeConnector();
    const res = await c.publish(makeCtx());
    expect(res.externalPostId).toBe("fake_t1");
  });

  it("injects retryable failures then succeeds, resuming from progress", async () => {
    const c = new FakeConnector();
    const progress: Record<string, unknown> = {};
    const meta = { failTimes: 2 };

    await expect(c.publish(makeCtx(meta, progress))).rejects.toThrow(ConnectorError);
    await expect(c.publish(makeCtx(meta, progress))).rejects.toThrow(/injected/);
    const res = await c.publish(makeCtx(meta, progress));
    expect(res.externalPostId).toBe("fake_t1");
    expect(progress["attempts"]).toBe(3);
  });

  it("checkpoints the container step before a crash", async () => {
    const c = new FakeConnector();
    const progress: Record<string, unknown> = {};
    await expect(
      c.publish(makeCtx({ crashAfterStep: "container" }, progress)),
    ).rejects.toThrow(/crash/);
    expect(progress["containerId"]).toBe("fakec_t1");

    // resume: container exists, so it completes without re-creating it
    const res = await c.publish(makeCtx({ crashAfterStep: "container" }, progress));
    expect(res.externalPostId).toBe("fake_t1");
  });

  it("classifies injected failures as retryable", async () => {
    const c = new FakeConnector();
    try {
      await c.publish(makeCtx({ failTimes: 1 }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorError);
      expect((e as ConnectorError).retryable).toBe(true);
    }
  });
});
