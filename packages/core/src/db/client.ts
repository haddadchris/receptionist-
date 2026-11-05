import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

type DbHandle = { db: Database; client: postgres.Sql };

const globalForDb = globalThis as unknown as { __fekerteDb?: Map<string, DbHandle> };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://fekerte:fekerte@localhost:5432/fekerte";
}

/** Create (or reuse, per URL) a pooled connection. Cached on globalThis to survive Next.js HMR. */
export function getDbHandle(url = databaseUrl()): DbHandle {
  globalForDb.__fekerteDb ??= new Map();
  let handle = globalForDb.__fekerteDb.get(url);
  if (!handle) {
    const client = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 20,
      // Supabase's transaction pooler (port 6543) does not support prepared statements.
      prepare: process.env.DATABASE_PREPARE !== "false",
      onnotice: () => {},
    });
    handle = { db: drizzle(client, { schema }), client };
    globalForDb.__fekerteDb.set(url, handle);
  }
  return handle;
}

export function getDb(url?: string): Database {
  return getDbHandle(url).db;
}

export async function closeDb(url = databaseUrl()): Promise<void> {
  const handle = globalForDb.__fekerteDb?.get(url);
  if (handle) {
    globalForDb.__fekerteDb!.delete(url);
    await handle.client.end({ timeout: 5 });
  }
}
