import { createDb } from "@projectsns/core";
import cron from "node-cron";
import { startHeartbeat } from "./heartbeat.js";
import { runAnalyticsPull } from "./loops/analytics.js";
import { publishLoopTick, reaperTick } from "./loops/publish.js";
import { tokenRefreshTick } from "./loops/refresh.js";

const PUBLISH_INTERVAL_MS = 20_000;
const REAPER_INTERVAL_MS = 60_000;
const REFRESH_INTERVAL_MS = 60 * 60_000;

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;

const db = createDb();
let shuttingDown = false;
let activeTick: Promise<void> = Promise.resolve();

function loop(name: string, intervalMs: number, fn: () => Promise<void>) {
  const run = async () => {
    if (shuttingDown) return;
    try {
      const p = fn();
      activeTick = p.then(
        () => {},
        () => {},
      );
      await p;
    } catch (err) {
      console.error(`[${name}] tick failed:`, err);
    } finally {
      if (!shuttingDown) setTimeout(run, intervalMs);
    }
  };
  void run();
}

async function main() {
  console.log(`ProjectSNS worker ${WORKER_ID} starting`);

  startHeartbeat(db, WORKER_ID);

  loop("publish", PUBLISH_INTERVAL_MS, () => publishLoopTick(db, WORKER_ID));
  loop("reaper", REAPER_INTERVAL_MS, () => reaperTick(db));
  loop("refresh", REFRESH_INTERVAL_MS, () => tokenRefreshTick(db));

  // daily analytics pull, 02:30 WIB
  cron.schedule("30 2 * * *", () => void runAnalyticsPull(db), {
    timezone: "Asia/Jakarta",
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received — draining current job`);
    shuttingDown = true;
    await activeTick;
    await db.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("worker failed to start:", err);
  process.exit(1);
});
