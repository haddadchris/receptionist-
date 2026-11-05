/**
 * Tenant-scoped database access.
 *
 * - `withTenant(businessId, fn)`: runs `fn` in a transaction as the restricted
 *   `fekerte_app` role with `app.business_id` set. Postgres RLS then guarantees
 *   the transaction can only see/modify that business's rows.
 * - `withSuperAdmin(fn)`: restricted role with the super-admin flag (sees all tenants).
 * - `withSystem(fn)`: owner connection, bypasses RLS. Only for trusted platform
 *   code paths (auth, cron/job runner, slug → business resolution, webhooks
 *   before the tenant is known). Never pass user-controlled filters through it
 *   without scoping.
 */
import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { getDb } from "./client";
import type * as schema from "./schema";

export type Tx = PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const APP_ROLE = "fekerte_app";

export async function withTenant<T>(businessId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(businessId)) throw new Error(`withTenant: invalid business id "${businessId}"`);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.business_id', ${businessId}, true)`);
    await tx.execute(sql.raw(`set local role ${APP_ROLE}`));
    return fn(tx);
  });
}

export async function withSuperAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.is_super_admin', 'on', true)`);
    await tx.execute(sql.raw(`set local role ${APP_ROLE}`));
    return fn(tx);
  });
}

export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => fn(tx));
}
