/**
 * Makes `pnpm dev` work out of the box:
 *  1. Creates .env from .env.example if missing.
 *  2. Checks Postgres; if unreachable, tries `docker compose up -d db` and waits.
 *  3. Applies migrations and seeds demo data on an empty database.
 */
import { existsSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (!existsSync(envPath)) {
  copyFileSync(path.join(root, ".env.example"), envPath);
  console.log("• created .env from .env.example");
}
config({ path: envPath, quiet: true });

const url = process.env.DATABASE_URL ?? "postgres://fekerte:fekerte@localhost:5432/fekerte";

async function reachable(): Promise<boolean> {
  const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function main() {
  if (!(await reachable())) {
    console.log("• Postgres not reachable — trying `docker compose up -d db` …");
    try {
      execSync("docker compose up -d db", { cwd: root, stdio: "inherit" });
    } catch {
      console.error(`\n✗ Could not reach Postgres at ${url} and Docker is not available.\n  Start Postgres 15+ yourself (see README "Local setup") or set DATABASE_URL.\n`);
      process.exit(1);
    }
    for (let i = 0; i < 30 && !(await reachable()); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await reachable())) {
      console.error("✗ Postgres did not become ready in time.");
      process.exit(1);
    }
  }
  execSync("pnpm --filter @fekerte/core db:migrate", { cwd: root, stdio: "inherit" });
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from businesses`;
  await sql.end();
  if (n === 0) {
    console.log("• empty database — seeding demo data");
    execSync("pnpm --filter @fekerte/core db:seed", { cwd: root, stdio: "inherit" });
  }
}

main();
