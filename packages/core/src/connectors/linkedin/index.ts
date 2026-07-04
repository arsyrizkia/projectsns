import { ConnectorError } from "../../types.js";
import type {
  AccountMetricsDay,
  ContentType,
  MediaAssetMeta,
  PlatformConstraints,
  PostMetrics,
  TokenSet,
  ValidationResult,
} from "../../types.js";
import type {
  Connector,
  MetricsContext,
  PublishContext,
  PublishResult,
} from "../types.js";

/** Pinned LinkedIn versioned-REST release (YYYYMM). Bump deliberately. */
export const LINKEDIN_VERSION = "202506";

const API_BASE = "https://api.linkedin.com";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif"];
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

interface ApiRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  expect?: "json" | "bytes" | "none";
  dryRun?: boolean;
  log?: (message: string, meta?: Record<string, unknown>) => void;
  /** Response returned instead of hitting the network when dryRun is set. */
  synthetic?: {
    status?: number;
    headers?: Record<string, string>;
    json?: unknown;
    bytes?: Uint8Array;
  };
}

interface ApiResponse {
  status: number;
  json: unknown;
  bytes: Uint8Array | null;
  header(name: string): string | null;
}

async function classify(res: Response, req: ApiRequest): Promise<ConnectorError> {
  const bodyText = await res.text().catch(() => "");
  const at = `${req.method} ${req.url}`;
  const details = { status: res.status, url: req.url, body: bodyText.slice(0, 2000) };
  // w_member_social budget is 150 requests/member/day — 429 means back off
  if (res.status === 429) {
    return new ConnectorError("rate_limited", `LinkedIn rate limit at ${at}`, {
      retryable: true,
      details,
    });
  }
  if (res.status >= 500) {
    return new ConnectorError("server_error", `LinkedIn ${res.status} at ${at}`, {
      retryable: true,
      details,
    });
  }
  if (res.status === 401) {
    return new ConnectorError("token_invalid", `LinkedIn 401 at ${at}`, {
      retryable: false,
      details,
    });
  }
  if (res.status === 403) {
    return new ConnectorError("forbidden", `LinkedIn 403 at ${at}`, {
      retryable: false,
      details,
    });
  }
  return new ConnectorError("request_failed", `LinkedIn ${res.status} at ${at}`, {
    retryable: false,
    details,
  });
}

/** Single choke point for network I/O: dry-run short-circuit + error classification. */
async function apiFetch(req: ApiRequest): Promise<ApiResponse> {
  if (req.dryRun) {
    req.log?.(`dry-run: would ${req.method} ${req.url}`, {
      bodyBytes: req.body?.length ?? 0,
    });
    const synth = req.synthetic ?? {};
    const headers = new Map(
      Object.entries(synth.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      status: synth.status ?? 200,
      json: synth.json ?? null,
      bytes: synth.bytes ?? null,
      header: (name) => headers.get(name.toLowerCase()) ?? null,
    };
  }

  let res: Response;
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
  } catch (cause) {
    throw new ConnectorError("network", `LinkedIn unreachable: ${req.method} ${req.url}`, {
      retryable: true,
      cause,
    });
  }

  if (!res.ok) throw await classify(res, req);

  let json: unknown = null;
  let bytes: Uint8Array | null = null;
  if (req.expect === "json") {
    try {
      json = await res.json();
    } catch (cause) {
      throw new ConnectorError("bad_response", `LinkedIn returned non-JSON at ${req.url}`, {
        retryable: false,
        cause,
      });
    }
  } else if (req.expect === "bytes") {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  return {
    status: res.status,
    json,
    bytes,
    header: (name) => res.headers.get(name),
  };
}

function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}`;
}

/**
 * Personal-profile posting via the self-serve "Share on LinkedIn" product
 * (scope w_member_social + OpenID Connect for identity). The author URN is
 * data-driven from channel platform_meta.urn — urn:li:person:{id} today,
 * urn:li:organization:{id} once Community Management approval lands — so the
 * org upgrade is a reconnect, not a code change.
 */
export class LinkedInConnector implements Connector {
  readonly platform = "linkedin" as const;

  getConstraints(_contentType: ContentType): PlatformConstraints {
    return {
      maxChars: 3000,
      mediaRequired: false,
      allowedMediaKinds: ["image"],
      image: {
        mimes: [...IMAGE_MIMES],
        // LinkedIn's real cap is 36,152,320 pixels; 8MB is our practical file cap
        maxSizeBytes: IMAGE_MAX_BYTES,
      },
      notes: [
        "personal-profile posting (Share on LinkedIn); org pages arrive with Community Management",
        "image posts only for MVP",
      ],
    };
  }

  validateMedia(contentType: ContentType, media: MediaAssetMeta): ValidationResult {
    const constraints = this.getConstraints(contentType);
    const errors: string[] = [];
    if (!constraints.allowedMediaKinds.includes(media.kind)) {
      errors.push(`linkedin: media kind '${media.kind}' not supported (image-only MVP)`);
    }
    const rule = media.kind === "image" ? constraints.image : constraints.video;
    if (rule) {
      if (!rule.mimes.includes(media.mime)) {
        errors.push(`linkedin: mime '${media.mime}' not allowed (${rule.mimes.join(", ")})`);
      }
      if (media.sizeBytes > rule.maxSizeBytes) {
        errors.push(`linkedin: media over ${Math.floor(rule.maxSizeBytes / 1024 / 1024)}MB`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    // crash between the post call and job completion → resume returns the id
    const already = ctx.progress["externalPostId"];
    if (typeof already === "string" && already.length > 0) {
      return { externalPostId: already, externalPostUrl: postUrl(already) };
    }

    const author = ctx.platformMeta["urn"];
    if (typeof author !== "string" || !author.startsWith("urn:li:")) {
      throw new ConnectorError(
        "missing_author_urn",
        "linkedin: channel platform_meta.urn missing — reconnect the channel",
        { retryable: false },
      );
    }

    const auth = { Authorization: `Bearer ${ctx.tokens.accessToken}` };
    const restHeaders = {
      ...auth,
      "LinkedIn-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    };

    let imageUrn =
      typeof ctx.progress["imageUrn"] === "string"
        ? (ctx.progress["imageUrn"] as string)
        : undefined;

    const media = ctx.target.media;
    if (media && !imageUrn) {
      if (media.kind !== "image") {
        throw new ConnectorError(
          "unsupported_media",
          `linkedin: media kind '${media.kind}' not supported (image-only MVP)`,
          { retryable: false },
        );
      }
      if (!media.publicUrl) {
        throw new ConnectorError(
          "missing_media_url",
          "linkedin: media.publicUrl required to upload image bytes",
          { retryable: false },
        );
      }

      ctx.log("initializing image upload", { owner: author });
      const init = await apiFetch({
        method: "POST",
        url: `${API_BASE}/rest/images?action=initializeUpload`,
        headers: restHeaders,
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
        expect: "json",
        dryRun: ctx.dryRun,
        log: ctx.log,
        synthetic: {
          json: { value: { uploadUrl: "https://dry.run/upload", image: "urn:li:image:dryrun" } },
        },
      });
      const value = (init.json as { value?: { uploadUrl?: unknown; image?: unknown } } | null)
        ?.value;
      const uploadUrl = value?.uploadUrl;
      const newImageUrn = value?.image;
      if (typeof uploadUrl !== "string" || typeof newImageUrn !== "string") {
        throw new ConnectorError(
          "bad_response",
          "linkedin: initializeUpload response missing uploadUrl/image",
          { retryable: false, details: init.json },
        );
      }

      const download = await apiFetch({
        method: "GET",
        url: media.publicUrl,
        expect: "bytes",
        dryRun: ctx.dryRun,
        log: ctx.log,
        synthetic: { bytes: new Uint8Array(0) },
      });

      await apiFetch({
        method: "PUT",
        url: uploadUrl,
        headers: { ...auth, "Content-Type": media.mime },
        body: download.bytes ?? new Uint8Array(0),
        expect: "none",
        dryRun: ctx.dryRun,
        log: ctx.log,
        synthetic: { status: 201 },
      });

      imageUrn = newImageUrn;
      // bytes are on LinkedIn's side now — a resumed job must not re-upload
      await ctx.saveProgress({ imageUrn });
    }

    const body: Record<string, unknown> = {
      author,
      commentary: ctx.target.caption,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (imageUrn) body["content"] = { media: { id: imageUrn } };

    // non-idempotent call ahead: the reaper routes crashes after this
    // checkpoint to needs_review instead of blind-retrying (double post risk)
    await ctx.saveProgress({ finalCallSent: true });

    const created = await apiFetch({
      method: "POST",
      url: `${API_BASE}/rest/posts`,
      headers: restHeaders,
      body: JSON.stringify(body),
      expect: "none",
      dryRun: ctx.dryRun,
      log: ctx.log,
      synthetic: {
        status: 201,
        headers: { "x-restli-id": `urn:li:share:dryrun_${ctx.target.targetId}` },
      },
    });

    const externalPostId = created.header("x-restli-id");
    if (!externalPostId) {
      throw new ConnectorError(
        "bad_response",
        "linkedin: post created but x-restli-id header missing",
        { retryable: false },
      );
    }
    await ctx.saveProgress({ externalPostId });
    return { externalPostId, externalPostUrl: postUrl(externalPostId) };
  }

  async refreshToken(tokens: TokenSet): Promise<TokenSet | { reauthRequired: true }> {
    // self-serve LinkedIn apps get no refresh token — the ~60-day access
    // token simply expires and the member reconnects
    if (!tokens.refreshToken) return { reauthRequired: true };

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ConnectorError(
        "config",
        "linkedin: LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET not set",
        { retryable: false },
      );
    }

    let res: ApiResponse;
    try {
      res = await apiFetch({
        method: "POST",
        url: TOKEN_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        expect: "json",
      });
    } catch (e) {
      // a rejected grant is spent — retrying cannot help, only a reconnect can
      if (e instanceof ConnectorError && !e.retryable) return { reauthRequired: true };
      throw e;
    }

    const body = res.json as {
      access_token?: unknown;
      expires_in?: unknown;
      refresh_token?: unknown;
      refresh_token_expires_in?: unknown;
    } | null;
    if (typeof body?.access_token !== "string") return { reauthRequired: true };

    const now = Date.now();
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === "string" ? body.refresh_token : tokens.refreshToken,
      expiresAt:
        typeof body.expires_in === "number" ? now + body.expires_in * 1000 : undefined,
      refreshTokenExpiresAt:
        typeof body.refresh_token_expires_in === "number"
          ? now + body.refresh_token_expires_in * 1000
          : undefined,
    };
  }

  async pullPostMetrics(
    _ctx: MetricsContext,
    externalPostId: string,
  ): Promise<PostMetrics> {
    // personal profiles have no analytics API under self-serve scopes —
    // return honest emptiness, never fabricated numbers
    return {
      raw: {
        note: "linkedin: member post analytics unavailable under self-serve scopes; org analytics arrive with Community Management",
        externalPostId,
      },
    };
  }

  async pullAccountMetrics(
    _ctx: MetricsContext,
    _fromDate: string,
    _toDate: string,
  ): Promise<AccountMetricsDay[]> {
    // same self-serve limitation as pullPostMetrics — no data, not zeros
    return [];
  }
}
