import postgres from "postgres";

export type Db = ReturnType<typeof postgres>;

/**
 * Direct Postgres connection (service role) — used by the worker for
 * FOR UPDATE SKIP LOCKED job claims and by server-side code that touches
 * the secrets tables. `prepare: false` keeps it compatible with Supabase's
 * transaction-mode pooler (port 6543).
 */
export function createDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}
