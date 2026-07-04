import type { Db } from "@projectsns/core";

const HEARTBEAT_INTERVAL_MS = 30_000;
const VERSION = process.env.APP_VERSION ?? "dev";

/** Upserts a liveness row; the web UI shows a banner when this goes stale >2 min. */
export function startHeartbeat(db: Db, workerId: string): void {
  const beat = async () => {
    try {
      await db`
        insert into worker_heartbeat (worker_id, last_seen, version)
        values (${workerId}, now(), ${VERSION})
        on conflict (worker_id)
        do update set last_seen = now(), version = ${VERSION}
      `;
    } catch (err) {
      console.error("[heartbeat] failed:", err);
    }
  };
  void beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS).unref();
}
