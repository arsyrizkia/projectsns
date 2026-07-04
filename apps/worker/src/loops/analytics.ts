import type { Db } from "@projectsns/core";

/**
 * Daily analytics ingestion (02:30 WIB):
 * - account metrics for every active channel → analytics_account_daily
 * - post metrics for targets published in the last 30 days → analytics_post_snapshots
 *
 * Implemented per-platform in Phase 3 (LinkedIn + Instagram first).
 */
export async function runAnalyticsPull(db: Db): Promise<void> {
  const rows = await db<{ count: string }[]>`
    select count(*) as count from channels where status = 'active'
  `;
  console.log(
    `[analytics] pull skipped (Phase 3) — ${rows[0]?.count ?? 0} active channel(s)`,
  );
}
