/** Drop everything, re-run migrations and seed. Local development only. */
import "./env";
import postgres from "postgres";
import { closeDb, databaseUrl } from "./client";
import { runMigrations } from "./migrate";
import { seed } from "./seed";

async function main() {
  const url = databaseUrl();
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "db", "postgres"].includes(host) && !process.argv.includes("--force")) {
    throw new Error(`Refusing to reset non-local database (${host}). Pass --force if you really mean it.`);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end();
  await runMigrations(url);
  console.log("✓ schema reset + migrations applied");
  await seed();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
