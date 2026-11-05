/** Global setup: fresh test database with migrations (shared with core; tests run sequentially). */
import postgres from "postgres";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://fekerte:fekerte@localhost:5432/fekerte_test";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end();
  process.env.DATABASE_URL = url;
  const { runMigrations } = await import("@fekerte/core/db/migrate");
  const { closeDb } = await import("@fekerte/core/db/client");
  await runMigrations(url);
  await closeDb(url);
}
