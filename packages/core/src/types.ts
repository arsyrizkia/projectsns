import { z } from "zod";

export const PLATFORMS = ["linkedin", "instagram", "tiktok", "fake"] as const;
export const PlatformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof PlatformSchema>;

export const CONTENT_TYPES = [
  "linkedin_post",
  "ig_feed",
  "ig_story",
  "ig_reel",
  "tiktok_video",
  "fake_post",
] as const;
export const ContentTypeSchema = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const CONTENT_TYPES_BY_PLATFORM: Record<Platform, ContentType[]> = {
  linkedin: ["linkedin_post"],
  instagram: ["ig_feed", "ig_story", "ig_reel"],
  tiktok: ["tiktok_video"],
  fake: ["fake_post"],
};

export const TokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  /** epoch ms */
  expiresAt: z.number().optional(),
  /** epoch ms */
  refreshTokenExpiresAt: z.number().optional(),
});
export type TokenSet = z.infer<typeof TokenSetSchema>;

export const MediaKindSchema = z.enum(["image", "video"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MediaAssetMetaSchema = z.object({
  kind: MediaKindSchema,
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationS: z.number().positive().optional(),
  /** Public HTTPS URL (required by Instagram's pull model). */
  publicUrl: z.string().url().optional(),
});
export type MediaAssetMeta = z.infer<typeof MediaAssetMetaSchema>;

export interface MediaRule {
  mimes: string[];
  maxSizeBytes: number;
  minWidth?: number;
  maxWidth?: number;
  /** width/height bounds, e.g. IG feed 0.8 (4:5) to 1.91 */
  minAspect?: number;
  maxAspect?: number;
  minDurationS?: number;
  maxDurationS?: number;
}

export interface PlatformConstraints {
  maxChars: number;
  mediaRequired: boolean;
  allowedMediaKinds: MediaKind[];
  image?: MediaRule;
  video?: MediaRule;
  notes?: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface PostMetrics {
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  videoViews?: number;
  engagementRate?: number;
  raw: unknown;
}

export interface AccountMetricsDay {
  /** YYYY-MM-DD */
  date: string;
  followers?: number;
  impressions?: number;
  reach?: number;
  engagements?: number;
  raw: unknown;
}

/** Error thrown by connectors; `retryable` drives the worker's backoff logic. */
export class ConnectorError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    opts: { retryable?: boolean; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "ConnectorError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}
