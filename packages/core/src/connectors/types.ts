import type {
  AccountMetricsDay,
  ContentType,
  MediaAssetMeta,
  Platform,
  PlatformConstraints,
  PostMetrics,
  TokenSet,
  ValidationResult,
} from "../types.js";

/**
 * One implementation per platform. All platform quirks (IG container flow,
 * TikTok chunked upload + creator_info, LinkedIn versioned REST) live inside
 * the implementation — the worker and UI only see this contract.
 */
export interface Connector {
  readonly platform: Platform;

  /** Static rules that drive composer validation UI. */
  getConstraints(contentType: ContentType): PlatformConstraints;

  /** Local (no network) media validation against platform rules. */
  validateMedia(contentType: ContentType, media: MediaAssetMeta): ValidationResult;

  /**
   * Full multi-step publish flow. MUST checkpoint intermediate platform
   * artifacts (IG creation_id, TikTok publish_id) via ctx.saveProgress()
   * so a crashed job can resume idempotently instead of double-posting.
   */
  publish(ctx: PublishContext): Promise<PublishResult>;

  /** Refresh tokens expiring soon. Returns new tokens or a reauth signal. */
  refreshToken(tokens: TokenSet): Promise<TokenSet | { reauthRequired: true }>;

  pullPostMetrics(ctx: MetricsContext, externalPostId: string): Promise<PostMetrics>;

  pullAccountMetrics(
    ctx: MetricsContext,
    fromDate: string,
    toDate: string,
  ): Promise<AccountMetricsDay[]>;
}

export interface PublishTarget {
  targetId: string;
  contentType: ContentType;
  caption: string;
  media?: MediaAssetMeta;
}

export interface PublishContext {
  tokens: TokenSet;
  /** channels.platform_meta — IG ids, LinkedIn URN, TikTok creator_info/audited. */
  platformMeta: Record<string, unknown>;
  target: PublishTarget;
  /** Prior checkpoints from publish_jobs.progress (empty object on first attempt). */
  progress: Record<string, unknown>;
  /** Persist a checkpoint patch immediately (merged into publish_jobs.progress). */
  saveProgress(patch: Record<string, unknown>): Promise<void>;
  /** When true, log intended calls without sending (CONNECTOR_DRY_RUN=1). */
  dryRun: boolean;
  log(message: string, meta?: Record<string, unknown>): void;
}

export interface PublishResult {
  externalPostId: string;
  externalPostUrl?: string;
  /** e.g. "published as private draft — app not yet audited by TikTok" */
  warnings?: string[];
  raw?: unknown;
}

export interface MetricsContext {
  tokens: TokenSet;
  platformMeta: Record<string, unknown>;
}
