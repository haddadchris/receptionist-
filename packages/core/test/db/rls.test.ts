import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSuperAdmin, withSystem, withTenant } from "../../src/db/tenant";
import { closeDb } from "../../src/db/client";
import { appointments, businesses, customers, services, staff, TENANT_TABLES, users } from "../../src/db/schema";
import { createBooking } from "../../src/booking/service";
import { createTestBusiness, dbAvailable, futureDate, localIso, type TestBusiness } from "../fixtures";

describe.skipIf(!dbAvailable())("row-level security: tenant isolation", () => {
  let a: TestBusiness;
  let b: TestBusiness;

  beforeAll(async () => {
    a = await createTestBusiness({ name: "Tenant A" });
    b = await createTestBusiness({ name: "Tenant B" });
    for (const t of [a, b]) {
      await withTenant(t.businessId, (tx) =>
        createBooking(tx, t.businessId, {
          serviceId: t.checkup.id,
          staffId: t.staff[0]!.id,
          startsAt: localIso(futureDate(4), "10:00"),
          customer: { phone: "+96170555444", name: `Customer of ${t.business.name}` },
          source: "booking_page",
          actor: { type: "customer" },
        }),
      );
    }
  });
  afterAll(() => closeDb());

  it("tenant A cannot read tenant B rows, even without a WHERE clause", async () => {
    const seen = await withTenant(a.businessId, async (tx) => ({
      customers: await tx.select().from(customers),
      appointments: await tx.select().from(appointments),
      services: await tx.select().from(services),
      staff: await tx.select().from(staff),
      businesses: await tx.select().from(businesses),
    }));
    expect(seen.customers.every((c) => c.businessId === a.businessId)).toBe(true);
    expect(seen.customers.length).toBeGreaterThan(0);
    expect(seen.appointments.every((x) => x.businessId === a.businessId)).toBe(true);
    expect(seen.services.every((x) => x.businessId === a.businessId)).toBe(true);
    expect(seen.staff.every((x) => x.businessId === a.businessId)).toBe(true);
    expect(seen.businesses.map((x) => x.id)).toEqual([a.businessId]);
  });

  it("explicitly querying tenant B's ids from tenant A returns nothing", async () => {
    const rows = await withTenant(a.businessId, (tx) => tx.select().from(customers).where(eq(customers.businessId, b.businessId)));
    expect(rows).toEqual([]);
  });

  it("tenant A cannot insert rows into tenant B", async () => {
    await expect(
      withTenant(a.businessId, (tx) => tx.insert(customers).values({ businessId: b.businessId, phone: "+9613000999", name: "Intruder" })),
    ).rejects.toThrow();
  });

  it("tenant A cannot update or delete tenant B rows", async () => {
    const updated = await withTenant(a.businessId, (tx) =>
      tx.update(customers).set({ name: "hacked" }).where(eq(customers.businessId, b.businessId)).returning(),
    );
    expect(updated).toEqual([]);
    const deleted = await withTenant(a.businessId, (tx) => tx.delete(services).where(eq(services.businessId, b.businessId)).returning());
    expect(deleted).toEqual([]);
    const bServices = await withTenant(b.businessId, (tx) => tx.select().from(services));
    expect(bServices.length).toBe(2);
  });

  it("tenant A cannot move its own rows into tenant B", async () => {
    await expect(
      withTenant(a.businessId, (tx) => tx.update(customers).set({ businessId: b.businessId }).where(eq(customers.businessId, a.businessId))),
    ).rejects.toThrow();
  });

  it("users are only visible when they are members of the current business", async () => {
    const visible = await withTenant(a.businessId, (tx) => tx.select({ id: users.id }).from(users));
    expect(visible.map((u) => u.id)).toEqual([a.owner.id]);
  });

  it("super admin context sees every tenant", async () => {
    const all = await withSuperAdmin((tx) => tx.select({ id: businesses.id }).from(businesses));
    const ids = all.map((x) => x.id);
    expect(ids).toContain(a.businessId);
    expect(ids).toContain(b.businessId);
  });

  it("without a tenant set, the app role sees nothing", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql.raw("set local role fekerte_app"));
      return tx.select().from(customers);
    });
    expect(rows).toEqual([]);
  });

  it("every tenant table has RLS enabled with a policy, and no business_id table is missing", async () => {
    const rls = (await withSystem((tx) =>
      tx.execute(sql`
        select c.relname as table, c.relrowsecurity as enabled,
               (select count(*) from pg_policies p where p.tablename = c.relname)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      `),
    )) as unknown as { table: string; enabled: boolean; policies: number }[];
    const byName = new Map(rls.map((r) => [r.table, r]));
    for (const t of TENANT_TABLES) {
      expect(byName.get(t)?.enabled, `${t} RLS enabled`).toBe(true);
      expect(byName.get(t)?.policies, `${t} has policy`).toBeGreaterThan(0);
    }
    const withBusinessId = (await withSystem((tx) =>
      tx.execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id'`),
    )) as unknown as { table_name: string }[];
    const allowedExtra = new Set(["leads"]); // platform table, super-admin only policy
    for (const { table_name } of withBusinessId) {
      if (allowedExtra.has(table_name)) continue;
      expect(TENANT_TABLES as readonly string[], `${table_name} must be listed in TENANT_TABLES`).toContain(table_name);
    }
    // Every public table has RLS enabled (default-deny for Supabase anon/authenticated roles too).
    for (const r of rls) expect(r.enabled, `${r.table} RLS enabled`).toBe(true);
  });
});
