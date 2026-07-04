import { ConnectorError } from "../types.js";
import type {
  AccountMetricsDay,
  ContentType,
  MediaAssetMeta,
  PlatformConstraints,
  PostMetrics,
  TokenSet,
  ValidationResult,
} from "../types.js";
import type {
  Connector,
  MetricsContext,
  PublishContext,
  PublishResult,
} from "./types.js";

/**
 * Deterministic connector for e2e tests and local dev.
 *
 * Failure injection via channel platform_meta:
 * - `failTimes: n`      → first n attempts throw a retryable error
 * - `crashAfterStep: s` → throws (non-retryable crash simulation) right after
 *                          checkpointing step `s` ('container')
 */
export class FakeConnector implements Connector {
  readonly platform = "fake" as const;

  getConstraints(_contentType: ContentType): PlatformConstraints {
    return {
      maxChars: 500,
      mediaRequired: false,
      allowedMediaKinds: ["image", "video"],
      notes: ["fake platform for testing"],
    };
  }

  validateMedia(_ct: ContentType, media: MediaAssetMeta): ValidationResult {
    const errors: string[] = [];
    if (media.sizeBytes > 10 * 1024 * 1024) errors.push("fake: media over 10MB");
    return { ok: errors.length === 0, errors };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const meta = ctx.platformMeta as {
      failTimes?: number;
      crashAfterStep?: string;
    };
    const attempt = (ctx.progress["attempts"] as number | undefined) ?? 0;
    await ctx.saveProgress({ attempts: attempt + 1 });

    if (meta.failTimes && attempt < meta.failTimes) {
      throw new ConnectorError("fake_transient", `injected failure ${attempt + 1}`, {
        retryable: true,
      });
    }

    if (ctx.dryRun) {
      ctx.log("dry-run: would publish", { target: ctx.target.targetId });
      return { externalPostId: `fake_dryrun_${ctx.target.targetId}` };
    }

    // simulate the two-step container flow so resume paths are exercised
    if (!ctx.progress["containerId"]) {
      await ctx.saveProgress({ containerId: `fakec_${ctx.target.targetId}` });
      if (meta.crashAfterStep === "container") {
        throw new ConnectorError("fake_crash", "injected crash after container", {
          retryable: false,
        });
      }
    }

    return {
      externalPostId: `fake_${ctx.target.targetId}`,
      externalPostUrl: `https://fake.example/posts/${ctx.target.targetId}`,
    };
  }

  async refreshToken(tokens: TokenSet): Promise<TokenSet> {
    return { ...tokens, expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000 };
  }

  async pullPostMetrics(
    _ctx: MetricsContext,
    externalPostId: string,
  ): Promise<PostMetrics> {
    // deterministic pseudo-metrics derived from the id
    const seed = [...externalPostId].reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      impressions: seed * 7,
      likes: seed % 97,
      comments: seed % 13,
      shares: seed % 7,
      raw: { seed },
    };
  }

  async pullAccountMetrics(
    _ctx: MetricsContext,
    fromDate: string,
    toDate: string,
  ): Promise<AccountMetricsDay[]> {
    const out: AccountMetricsDay[] = [];
    const from = new Date(`${fromDate}T00:00:00Z`);
    const to = new Date(`${toDate}T00:00:00Z`);
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const seed = [...date].reduce((a, c) => a + c.charCodeAt(0), 0);
      out.push({ date, followers: 1000 + seed, impressions: seed * 3, raw: { seed } });
    }
    return out;
  }
}
