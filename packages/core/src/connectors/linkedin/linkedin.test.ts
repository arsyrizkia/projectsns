import {
  getGlobalDispatcher,
  MockAgent,
  setGlobalDispatcher,
  type Dispatcher,
} from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorError } from "../../types.js";
import type { MediaAssetMeta } from "../../types.js";
import type { PublishContext } from "../types.js";
import { LINKEDIN_VERSION, LinkedInConnector } from "./index.js";

const API = "https://api.linkedin.com";
const CDN = "https://cdn.example";
const UPLOAD = "https://upload.linkedin.example";

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

/** dispatch opts headers arrive as a record or flat [k, v, k, v] array. */
function headerRecord(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(headers)) {
    for (let i = 0; i + 1 < headers.length; i += 2) {
      out[String(headers[i]).toLowerCase()] = String(headers[i + 1]);
    }
  } else if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      out[k.toLowerCase()] = String(v);
    }
  }
  return out;
}

function makeCtx(
  opts: {
    media?: MediaAssetMeta;
    progress?: Record<string, unknown>;
    events?: string[];
  } = {},
): PublishContext {
  const progress = opts.progress ?? {};
  return {
    tokens: { accessToken: "tok" },
    platformMeta: { urn: "urn:li:person:abc", urnType: "person" },
    target: {
      targetId: "t1",
      contentType: "linkedin_post",
      caption: "hello linkedin",
      media: opts.media,
    },
    progress,
    async saveProgress(patch) {
      Object.assign(progress, patch);
      for (const key of Object.keys(patch)) opts.events?.push(`progress:${key}`);
    },
    dryRun: false,
    log() {},
  };
}

const imageMedia: MediaAssetMeta = {
  kind: "image",
  mime: "image/png",
  sizeBytes: 3,
  publicUrl: `${CDN}/pic.png`,
};

describe("LinkedInConnector.publish", () => {
  it("publishes a text post with pinned versioned headers and extracts x-restli-id", async () => {
    let captured: Record<string, string> = {};
    mockAgent
      .get(API)
      .intercept({ path: "/rest/posts", method: "POST" })
      .reply((req) => {
        captured = headerRecord(req.headers);
        return {
          statusCode: 201,
          data: "",
          responseOptions: { headers: { "x-restli-id": "urn:li:share:12345" } },
        };
      });

    const c = new LinkedInConnector();
    const res = await c.publish(makeCtx());

    expect(res.externalPostId).toBe("urn:li:share:12345");
    expect(res.externalPostUrl).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:12345",
    );
    expect(captured["linkedin-version"]).toBe(LINKEDIN_VERSION);
    expect(captured["x-restli-protocol-version"]).toBe("2.0.0");
    expect(captured["authorization"]).toBe("Bearer tok");
  });

  it("runs the image flow and checkpoints imageUrn + finalCallSent before the post call", async () => {
    const events: string[] = [];
    const api = mockAgent.get(API);
    api
      .intercept({ path: "/rest/images?action=initializeUpload", method: "POST" })
      .reply(200, { value: { uploadUrl: `${UPLOAD}/u/1`, image: "urn:li:image:img1" } });
    mockAgent
      .get(CDN)
      .intercept({ path: "/pic.png", method: "GET" })
      .reply(200, Buffer.from([1, 2, 3]));
    mockAgent
      .get(UPLOAD)
      .intercept({ path: "/u/1", method: "PUT" })
      .reply(201, "");
    api.intercept({ path: "/rest/posts", method: "POST" }).reply(() => {
      events.push("call:posts");
      return {
        statusCode: 201,
        data: "",
        responseOptions: { headers: { "x-restli-id": "urn:li:ugcPost:777" } },
      };
    });

    const ctx = makeCtx({ media: imageMedia, events });
    const res = await new LinkedInConnector().publish(ctx);

    expect(res.externalPostId).toBe("urn:li:ugcPost:777");
    expect(ctx.progress["imageUrn"]).toBe("urn:li:image:img1");
    expect(ctx.progress["finalCallSent"]).toBe(true);
    expect(ctx.progress["externalPostId"]).toBe("urn:li:ugcPost:777");

    const postsAt = events.indexOf("call:posts");
    expect(postsAt).toBeGreaterThan(-1);
    expect(events.indexOf("progress:imageUrn")).toBeGreaterThan(-1);
    expect(events.indexOf("progress:imageUrn")).toBeLessThan(postsAt);
    expect(events.indexOf("progress:finalCallSent")).toBeLessThan(postsAt);
  });

  it("resumes from a checkpointed imageUrn without re-uploading", async () => {
    // only /rest/posts is intercepted — with net connect disabled, any
    // initializeUpload/PUT attempt would throw a MockNotMatchedError
    mockAgent
      .get(API)
      .intercept({ path: "/rest/posts", method: "POST" })
      .reply(201, "", {
        headers: { "x-restli-id": "urn:li:share:resumed" },
      });

    const ctx = makeCtx({
      media: imageMedia,
      progress: { imageUrn: "urn:li:image:already" },
    });
    const res = await new LinkedInConnector().publish(ctx);

    expect(res.externalPostId).toBe("urn:li:share:resumed");
    expect(ctx.progress["imageUrn"]).toBe("urn:li:image:already");
  });

  it("classifies 429 as retryable", async () => {
    mockAgent
      .get(API)
      .intercept({ path: "/rest/posts", method: "POST" })
      .reply(429, { message: "throttled" });

    try {
      await new LinkedInConnector().publish(makeCtx());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorError);
      expect((e as ConnectorError).retryable).toBe(true);
      expect((e as ConnectorError).code).toBe("rate_limited");
    }
  });

  it("classifies 401 as non-retryable token_invalid", async () => {
    mockAgent
      .get(API)
      .intercept({ path: "/rest/posts", method: "POST" })
      .reply(401, { message: "expired" });

    try {
      await new LinkedInConnector().publish(makeCtx());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorError);
      expect((e as ConnectorError).retryable).toBe(false);
      expect((e as ConnectorError).code).toBe("token_invalid");
    }
  });
});

describe("LinkedInConnector.refreshToken", () => {
  it("signals reauth when there is no refresh token (self-serve normal case)", async () => {
    const res = await new LinkedInConnector().refreshToken({ accessToken: "tok" });
    expect(res).toEqual({ reauthRequired: true });
  });
});
