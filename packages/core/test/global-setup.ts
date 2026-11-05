/**
 * Vitest global setup: prepares the test database (TEST_DATABASE_URL) by
 * resetting the public schema and applying migrations. Pure unit tests do not
 * need it, but DB tests (booking, RLS, concurrency) do.
 */
import postgres from "postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dbAvailable: boolean;
  }
}

export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://fekerte:fekerte@localhost:5432/fekerte_test";
  process.env.TEST_DATABASE_URL = url;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
  } catch {
    console.warn(`\n[test] Postgres not reachable at ${url} — DB tests will be skipped.\n`);
    project.provide("dbAvailable", false);
    await sql.end().catch(() => {});
    return;
  }
  await sql.unsafe(`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await sql.end();
  process.env.DATABASE_URL = url;
  const { runMigrations } = await import("../src/db/migrate");
  const { closeDb } = await import("../src/db/client");
  await runMigrations(url);
  await closeDb(url);
  project.provide("dbAvailable", true);
}
