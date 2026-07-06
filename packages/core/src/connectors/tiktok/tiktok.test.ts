import {
  getGlobalDispatcher,
  MockAgent,
  setGlobalDispatcher,
  type Dispatcher,
} from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorError } from "../../types.js";
import type { MediaAssetMeta } from "../../types.js";
import type { MetricsContext, PublishContext } from "../types.js";
import { TikTokConnector } from "./index.js";

const OPEN = "https://open.tiktokapis.com";
const CDN = "https://cdn.example";
const UPLOAD = "https://upload.tiktok.example";

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await mockAgent.close();
});

const videoMedia: MediaAssetMeta = {
  kind: "video",
  mime: "video/mp4",
  sizeBytes: 1024,
  durationS: 12,
  publicUrl: `${CDN}/clip.mp4`,
};

function makeCtx(
  opts: {
    media?: MediaAssetMeta;
    platformMeta?: Record<string, unknown>;
    progress?: Record<string, unknown>;
    events?: string[];
  } = {},
): PublishContext {
  const progress = opts.progress ?? {};
  return {
    tokens: { accessToken: "tok", refreshToken: "ref" },
    platformMeta: opts.platformMeta ?? { audited: false, username: "dilatih" },
    target: {
      targetId: "t1",
      contentType: "tiktok_video",
      caption: "hello tiktok",
      media: opts.media ?? videoMedia,
    },
    progress,
    async saveProgress(patch) {
      Object.assign(progress, patch);
      for (const key of Object.keys(patch)) opts.events?.push(`${key}=${String(patch[key])}`);
    },
    dryRun: false,
    log() {},
  };
}

function creatorInfoOk() {
  mockAgent
    .get(OPEN)
    .intercept({ path: "/v2/post/publish/creator_info/query/", method: "POST" })
    .reply(200, { data: { creator_username: "dilatih", privacy_level_options: ["SELF_ONLY"] } });
}

describe("TikTokConnector.publish", () => {
  it("uploads to the inbox when unaudited, checkpoints publishId, and warns to tap publish", async () => {
    const events: string[] = [];
    creatorInfoOk();
    mockAgent
      .get(OPEN)
      .intercept({ path: "/v2/post/publish/inbox/video/init/", method: "POST" })
      .reply(200, { data: { publish_id: "pub_1", upload_url: `${UPLOAD}/u/1` } });
    mockAgent.get(CDN).intercept({ path: "/clip.mp4", method: "GET" }).reply(200, Buffer.from([1, 2, 3]));
    mockAgent.get(UPLOAD).intercept({ path: "/u/1", method: "PUT" }).reply(201, "");
    mockAgent
      .get(OPEN)
      .intercept({ path: "/v2/post/publish/status/fetch/", method: "POST" })
      .reply(200, { data: { status: "SEND_TO_USER_INBOX" } });

    const c = new TikTokConnector();
    const res = await c.publish(makeCtx({ events }));

    expect(res.externalPostId).toBe("pub_1");
    expect(res.warnings?.some((w) => w.includes("tap publish"))).toBe(true);
    // finalCallSent set before init, then cleared once publishId is saved
    expect(events).toContain("finalCallSent=true");
    expect(events).toContain("publishId=pub_1");
    expect(events).toContain("finalCallSent=false");
  });

  it("uses the Direct Post endpoint when the channel is audited", async () => {
    let directCalled = false;
    creatorInfoOk();
    mockAgent
      .get(OPEN)
      .intercept({ path: "/v2/post/publish/video/init/", method: "POST" })
      .reply(() => {
        directCalled = true;
        return { statusCode: 200, data: JSON.stringify({ data: { publish_id: "pub_2", upload_url: `${UPLOAD}/u/2` } }) };
      });
    mockAgent.get(CDN).intercept({ path: "/clip.mp4", method: "GET" }).reply(200, Buffer.from([9]));
    mockAgent.get(UPLOAD).intercept({ path: "/u/2", method: "PUT" }).reply(201, "");
    mockAgent
      .get(OPEN)
      .intercept({ path: "/v2/post/publish/status/fetch/", method: "POST" })
      .reply(200, { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7777"] } });

    const c = new TikTokConnector();
    const res = await c.publish(
      makeCtx({ platformMeta: { audited: true, username: "dilatih" } }),
    );

    expect(directCalled).toBe(true);
    expect(res.externalPostId).toBe("7777");
    expect(res.externalPostUrl).toBe("https://www.tiktok.com/@dilatih/video/7777");
  });

  it("returns immediately when the target was already submitted (idempotent resume)", async () => {
    const c = new TikTokConnector();
    const res = await c.publish(makeCtx({ progress: { externalPostId: "pub_done" } }));
    expect(res.externalPostId).toBe("pub_done");
    // no interceptors registered → proves no network calls were made
  });

  it("classifies a rate-limit envelope (HTTP 200, error.code) as retryable", async () => {
    mockAgent
      .get(OPEN)
      .intercept({ path: "/v2/post/publish/creator_info/query/", method: "POST" })
      .reply(200, { error: { code: "rate_limit_exceeded", message: "slow down" } });

    const c = new TikTokConnector();
    await expect(c.publish(makeCtx())).rejects.toMatchObject({
      name: "ConnectorError",
      code: "rate_limited",
      retryable: true,
    });
  });

  it("rejects video kinds other than video", () => {
    const c = new TikTokConnector();
    const res = c.validateMedia("tiktok_video", { kind: "image", mime: "image/png", sizeBytes: 10 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("video only");
  });
});

describe("TikTokConnector.refreshToken", () => {
  it("exchanges the refresh token and returns the new pair", async () => {
    mockAgent
      .get(OPEN)
      .intercept({ path: "/v2/oauth/token/", method: "POST" })
      .reply(200, {
        access_token: "new_tok",
        refresh_token: "new_ref",
        expires_in: 86400,
        refresh_expires_in: 31536000,
      });

    process.env.TIKTOK_CLIENT_KEY = "ck";
    process.env.TIKTOK_CLIENT_SECRET = "cs";
    const c = new TikTokConnector();
    const out = await c.refreshToken({ accessToken: "old", refreshToken: "ref" });
    expect(out).toMatchObject({ accessToken: "new_tok", refreshToken: "new_ref" });
  });

  it("signals reauth when there is no refresh token", async () => {
    const c = new TikTokConnector();
    expect(await c.refreshToken({ accessToken: "old" })).toEqual({ reauthRequired: true });
  });
});

describe("TikTokConnector.pullPostMetrics", () => {
  it("parses per-video stats from the Display API", async () => {
    mockAgent
      .get(OPEN)
      .intercept({ method: "POST", path: (p) => p.startsWith("/v2/video/query/") })
      .reply(200, {
        data: {
          videos: [
            { id: "7777", view_count: 500, like_count: 40, comment_count: 5, share_count: 2 },
          ],
        },
      });

    const ctx: MetricsContext = { tokens: { accessToken: "tok" }, platformMeta: {} };
    const c = new TikTokConnector();
    const m = await c.pullPostMetrics(ctx, "7777");
    expect(m.videoViews).toBe(500);
    expect(m.likes).toBe(40);
    expect(m.comments).toBe(5);
    expect(m.shares).toBe(2);
  });
});
