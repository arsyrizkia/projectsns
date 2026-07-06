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

const OPEN_API = "https://open.tiktokapis.com";
const TOKEN_URL = `${OPEN_API}/v2/oauth/token/`;
const USERINFO_URL = `${OPEN_API}/v2/user/info/`;
const CREATOR_INFO_URL = `${OPEN_API}/v2/post/publish/creator_info/query/`;
const DIRECT_INIT_URL = `${OPEN_API}/v2/post/publish/video/init/`;
const INBOX_INIT_URL = `${OPEN_API}/v2/post/publish/inbox/video/init/`;
const STATUS_URL = `${OPEN_API}/v2/post/publish/status/fetch/`;
const VIDEO_QUERY_URL = `${OPEN_API}/v2/video/query/`;

const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm"];
const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
// single-PUT upload cap; larger videos need multi-chunk (not built yet)
const SINGLE_CHUNK_MAX = 64 * 1024 * 1024;
const CAPTION_MAX = 2200;
const STATUS_POLL_ATTEMPTS = 6;
const STATUS_POLL_MS = 2500;

interface ApiRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** "envelope" parses TikTok's { data, error } and throws on error.code != ok */
  expect?: "envelope" | "json" | "bytes" | "none";
  dryRun?: boolean;
  log?: (message: string, meta?: Record<string, unknown>) => void;
  synthetic?: { status?: number; json?: unknown; bytes?: Uint8Array };
}

interface ApiResponse {
  status: number;
  json: unknown;
  bytes: Uint8Array | null;
}

interface TikTokEnvelope {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; log_id?: string };
}

// TikTok returns HTTP 200 with error.code for logical failures, so retryability
// is decided by the envelope code, not just the HTTP status.
function classifyEnvelope(env: TikTokEnvelope, at: string): ConnectorError | null {
  const code = env.error?.code;
  if (!code || code === "ok") return null;
  const message = env.error?.message ?? code;
  const details = { code, message, log_id: env.error?.log_id, at };
  if (code === "rate_limit_exceeded") {
    return new ConnectorError("rate_limited", `tiktok rate limit at ${at}`, {
      retryable: true,
      details,
    });
  }
  if (code === "internal_error") {
    return new ConnectorError("server_error", `tiktok internal error at ${at}`, {
      retryable: true,
      details,
    });
  }
  if (code === "access_token_invalid" || code === "access_token_expired") {
    return new ConnectorError("token_invalid", `tiktok token invalid at ${at}`, {
      retryable: false,
      details,
    });
  }
  if (code === "scope_not_authorized" || code === "scope_permission_missed") {
    return new ConnectorError("forbidden", `tiktok scope missing at ${at}`, {
      retryable: false,
      details,
    });
  }
  return new ConnectorError("request_failed", `tiktok ${code} at ${at}`, {
    retryable: false,
    details,
  });
}

function classifyHttp(status: number, at: string, body: string): ConnectorError {
  const details = { status, at, body: body.slice(0, 2000) };
  if (status === 429) {
    return new ConnectorError("rate_limited", `tiktok 429 at ${at}`, {
      retryable: true,
      details,
    });
  }
  if (status >= 500) {
    return new ConnectorError("server_error", `tiktok ${status} at ${at}`, {
      retryable: true,
      details,
    });
  }
  if (status === 401) {
    return new ConnectorError("token_invalid", `tiktok 401 at ${at}`, {
      retryable: false,
      details,
    });
  }
  return new ConnectorError("request_failed", `tiktok ${status} at ${at}`, {
    retryable: false,
    details,
  });
}

async function apiFetch(req: ApiRequest): Promise<ApiResponse> {
  const at = `${req.method} ${req.url}`;
  if (req.dryRun) {
    req.log?.(`dry-run: would ${at}`, { bodyBytes: req.body?.length ?? 0 });
    const synth = req.synthetic ?? {};
    return { status: synth.status ?? 200, json: synth.json ?? null, bytes: synth.bytes ?? null };
  }

  let res: Response;
  try {
    res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  } catch (cause) {
    throw new ConnectorError("network", `tiktok unreachable: ${at}`, { retryable: true, cause });
  }

  if (!res.ok) throw classifyHttp(res.status, at, await res.text().catch(() => ""));

  let json: unknown = null;
  let bytes: Uint8Array | null = null;
  if (req.expect === "envelope" || req.expect === "json") {
    try {
      json = await res.json();
    } catch (cause) {
      throw new ConnectorError("bad_response", `tiktok non-JSON at ${at}`, {
        retryable: false,
        cause,
      });
    }
    if (req.expect === "envelope") {
      const err = classifyEnvelope(json as TikTokEnvelope, at);
      if (err) throw err;
    }
  } else if (req.expect === "bytes") {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  return { status: res.status, json, bytes };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envData(res: ApiResponse): Record<string, unknown> {
  return ((res.json as TikTokEnvelope | null)?.data ?? {}) as Record<string, unknown>;
}

/**
 * TikTok posting + analytics.
 *
 * Two publish modes, chosen by channel platform_meta.audited:
 *  - unaudited (default): upload to the user's TikTok inbox; they tap publish
 *    in-app (content can be public). This is the pre-audit path.
 *  - audited: Direct Post straight to the feed with a chosen privacy level.
 *
 * Media is uploaded via chunked FILE_UPLOAD (not PULL_FROM_URL), so we avoid
 * TikTok's domain-verification requirement for the media URL. Analytics come
 * from the Display API (video/query).
 */
export class TikTokConnector implements Connector {
  readonly platform = "tiktok" as const;

  getConstraints(_contentType: ContentType): PlatformConstraints {
    return {
      maxChars: CAPTION_MAX,
      mediaRequired: true,
      allowedMediaKinds: ["video"],
      video: {
        mimes: [...VIDEO_MIMES],
        maxSizeBytes: VIDEO_MAX_BYTES,
        minDurationS: 3,
      },
      notes: [
        "unaudited apps publish to the user's inbox (they tap publish in-app)",
        "public Direct Post requires passing TikTok's content-posting audit",
        `single-chunk upload only for now (video <= ${SINGLE_CHUNK_MAX / 1024 / 1024}MB)`,
      ],
    };
  }

  validateMedia(contentType: ContentType, media: MediaAssetMeta): ValidationResult {
    const rule = this.getConstraints(contentType).video;
    const errors: string[] = [];
    if (media.kind !== "video") {
      errors.push(`tiktok: media kind '${media.kind}' not supported (video only)`);
    }
    if (rule) {
      if (!rule.mimes.includes(media.mime)) {
        errors.push(`tiktok: mime '${media.mime}' not allowed (${rule.mimes.join(", ")})`);
      }
      if (media.sizeBytes > rule.maxSizeBytes) {
        errors.push(`tiktok: video over ${Math.floor(rule.maxSizeBytes / 1024 / 1024)}MB`);
      }
      if (media.sizeBytes > SINGLE_CHUNK_MAX) {
        errors.push(
          `tiktok: video over ${SINGLE_CHUNK_MAX / 1024 / 1024}MB needs chunked upload (not supported yet)`,
        );
      }
      if (rule.minDurationS && media.durationS && media.durationS < rule.minDurationS) {
        errors.push(`tiktok: video shorter than ${rule.minDurationS}s`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const already = ctx.progress["externalPostId"];
    if (typeof already === "string" && already.length > 0) {
      return { externalPostId: already, warnings: ["resumed: already submitted to TikTok"] };
    }

    const media = ctx.target.media;
    if (!media) {
      throw new ConnectorError("missing_media", "tiktok: a video is required", {
        retryable: false,
      });
    }
    if (!media.publicUrl) {
      throw new ConnectorError(
        "missing_media_url",
        "tiktok: media.publicUrl required to fetch video bytes",
        { retryable: false },
      );
    }

    const auth = {
      Authorization: `Bearer ${ctx.tokens.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    };
    const audited = ctx.platformMeta["audited"] === true;

    // creator_info is mandatory before any publish; it also surfaces the
    // account's allowed privacy levels and duration caps.
    await apiFetch({
      method: "POST",
      url: CREATOR_INFO_URL,
      headers: auth,
      expect: "envelope",
      dryRun: ctx.dryRun,
      log: ctx.log,
      synthetic: { json: { data: { creator_username: "dryrun", privacy_level_options: ["SELF_ONLY"] } } },
    });

    let publishId =
      typeof ctx.progress["publishId"] === "string"
        ? (ctx.progress["publishId"] as string)
        : undefined;
    let uploadUrl =
      typeof ctx.progress["uploadUrl"] === "string"
        ? (ctx.progress["uploadUrl"] as string)
        : undefined;

    if (!publishId) {
      const sourceInfo = {
        source: "FILE_UPLOAD",
        video_size: media.sizeBytes,
        chunk_size: media.sizeBytes,
        total_chunk_count: 1,
      };
      const initBody = audited
        ? {
            post_info: {
              title: ctx.target.caption.slice(0, CAPTION_MAX),
              // creator must pick privacy in-UI before audit; default private
              privacy_level: (ctx.platformMeta["privacyLevel"] as string) ?? "SELF_ONLY",
              disable_comment: false,
              disable_duet: false,
              disable_stitch: false,
            },
            source_info: sourceInfo,
          }
        : { source_info: sourceInfo };

      // non-idempotent: init creates the publish. A crash here (before we save
      // publishId) routes to needs_review rather than a possible duplicate.
      await ctx.saveProgress({ finalCallSent: true });
      const init = await apiFetch({
        method: "POST",
        url: audited ? DIRECT_INIT_URL : INBOX_INIT_URL,
        headers: auth,
        body: JSON.stringify(initBody),
        expect: "envelope",
        dryRun: ctx.dryRun,
        log: ctx.log,
        synthetic: {
          json: { data: { publish_id: `dryrun_${ctx.target.targetId}`, upload_url: "https://dry.run/up" } },
        },
      });
      const data = envData(init);
      publishId = typeof data["publish_id"] === "string" ? data["publish_id"] : undefined;
      uploadUrl = typeof data["upload_url"] === "string" ? data["upload_url"] : undefined;
      if (!publishId || !uploadUrl) {
        throw new ConnectorError("bad_response", "tiktok: init missing publish_id/upload_url", {
          retryable: false,
          details: init.json,
        });
      }
      // publishId saved → a normal retry resumes the upload instead of re-init.
      // Clearing finalCallSent lets the reaper reset (safe) rather than needs_review.
      await ctx.saveProgress({ publishId, uploadUrl, finalCallSent: false });
    }

    if (!uploadUrl) {
      // publishId checkpointed without its upload_url (partial/expired resume)
      throw new ConnectorError(
        "resume_no_upload_url",
        "tiktok: cannot resume upload — missing upload_url; recreate the post",
        { retryable: false },
      );
    }

    // fetch the bytes and PUT them as a single chunk
    const download = await apiFetch({
      method: "GET",
      url: media.publicUrl,
      expect: "bytes",
      dryRun: ctx.dryRun,
      log: ctx.log,
      synthetic: { bytes: new Uint8Array(0) },
    });
    const bytes = download.bytes ?? new Uint8Array(0);
    await apiFetch({
      method: "PUT",
      url: uploadUrl,
      headers: {
        "Content-Type": media.mime,
        "Content-Range": `bytes 0-${Math.max(media.sizeBytes - 1, 0)}/${media.sizeBytes}`,
      },
      body: bytes,
      expect: "none",
      dryRun: ctx.dryRun,
      log: ctx.log,
      synthetic: { status: 201 },
    });

    // poll status: terminal-published gives us the real video id; otherwise the
    // upload succeeded and TikTok is still processing / awaiting the user's tap.
    let videoId: string | undefined;
    let lastStatus = "PROCESSING_UPLOAD";
    for (let i = 0; i < STATUS_POLL_ATTEMPTS; i++) {
      const status = await apiFetch({
        method: "POST",
        url: STATUS_URL,
        headers: auth,
        body: JSON.stringify({ publish_id: publishId }),
        expect: "envelope",
        dryRun: ctx.dryRun,
        log: ctx.log,
        synthetic: { json: { data: { status: "SEND_TO_USER_INBOX" } } },
      });
      const data = envData(status);
      lastStatus = typeof data["status"] === "string" ? data["status"] : lastStatus;
      const posted = data["publicaly_available_post_id"];
      if (Array.isArray(posted) && typeof posted[0] === "string") videoId = posted[0];
      if (
        lastStatus === "PUBLISH_COMPLETE" ||
        lastStatus === "SEND_TO_USER_INBOX" ||
        lastStatus === "FAILED"
      ) {
        break;
      }
      if (!ctx.dryRun) await sleep(STATUS_POLL_MS);
    }

    if (lastStatus === "FAILED") {
      throw new ConnectorError("publish_failed", "tiktok: publish reported FAILED", {
        retryable: false,
        details: { publishId },
      });
    }

    const externalPostId = videoId ?? publishId!;
    await ctx.saveProgress({ externalPostId });

    const username = ctx.platformMeta["username"];
    const warnings: string[] = [];
    if (!audited) {
      warnings.push("uploaded to your TikTok inbox — open TikTok and tap publish to post it");
    }
    if (!videoId) {
      warnings.push(`TikTok status: ${lastStatus} (video id resolves once it's live)`);
    }

    return {
      externalPostId,
      externalPostUrl:
        videoId && typeof username === "string"
          ? `https://www.tiktok.com/@${username}/video/${videoId}`
          : undefined,
      warnings,
      raw: { publishId, status: lastStatus },
    };
  }

  async refreshToken(tokens: TokenSet): Promise<TokenSet | { reauthRequired: true }> {
    // TikTok access tokens live only ~24h, so this runs often; the refresh
    // token is valid ~1 year.
    if (!tokens.refreshToken) return { reauthRequired: true };
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      throw new ConnectorError("config", "tiktok: TIKTOK_CLIENT_KEY/SECRET not set", {
        retryable: false,
      });
    }

    let res: ApiResponse;
    try {
      res = await apiFetch({
        method: "POST",
        url: TOKEN_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }).toString(),
        expect: "json",
      });
    } catch (e) {
      if (e instanceof ConnectorError && !e.retryable) return { reauthRequired: true };
      throw e;
    }

    const body = res.json as {
      access_token?: unknown;
      expires_in?: unknown;
      refresh_token?: unknown;
      refresh_expires_in?: unknown;
      error?: unknown;
    } | null;
    if (typeof body?.access_token !== "string") return { reauthRequired: true };

    const now = Date.now();
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === "string" ? body.refresh_token : tokens.refreshToken,
      expiresAt: typeof body.expires_in === "number" ? now + body.expires_in * 1000 : undefined,
      refreshTokenExpiresAt:
        typeof body.refresh_expires_in === "number"
          ? now + body.refresh_expires_in * 1000
          : undefined,
    };
  }

  async pullPostMetrics(ctx: MetricsContext, externalPostId: string): Promise<PostMetrics> {
    // a publish_id (inbox/still-processing) has no metrics yet
    if (externalPostId.startsWith("dryrun_") || externalPostId.includes("_")) {
      return { raw: { note: "tiktok: metrics available once the video is live", externalPostId } };
    }
    const res = await apiFetch({
      method: "POST",
      url: `${VIDEO_QUERY_URL}?fields=id,like_count,comment_count,share_count,view_count`,
      headers: {
        Authorization: `Bearer ${ctx.tokens.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ filters: { video_ids: [externalPostId] } }),
      expect: "envelope",
    });
    const videos = envData(res)["videos"];
    const v = (Array.isArray(videos) ? videos[0] : undefined) as
      | Record<string, unknown>
      | undefined;
    const num = (k: string): number | undefined =>
      typeof v?.[k] === "number" ? (v[k] as number) : undefined;
    return {
      impressions: num("view_count"),
      videoViews: num("view_count"),
      likes: num("like_count"),
      comments: num("comment_count"),
      shares: num("share_count"),
      raw: v ?? { note: "tiktok: video not found", externalPostId },
    };
  }

  async pullAccountMetrics(
    ctx: MetricsContext,
    _fromDate: string,
    toDate: string,
  ): Promise<AccountMetricsDay[]> {
    // TikTok exposes current follower/like totals (a point-in-time snapshot),
    // not a historical daily series — record today's snapshot.
    const res = await apiFetch({
      method: "GET",
      url: `${USERINFO_URL}?fields=follower_count,likes_count,video_count`,
      headers: { Authorization: `Bearer ${ctx.tokens.accessToken}` },
      expect: "envelope",
    });
    const u = envData(res)["user"] as Record<string, unknown> | undefined;
    const num = (k: string): number | undefined =>
      typeof u?.[k] === "number" ? (u[k] as number) : undefined;
    return [
      {
        date: toDate,
        followers: num("follower_count"),
        engagements: num("likes_count"),
        raw: u ?? {},
      },
    ];
  }
}
