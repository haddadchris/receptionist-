/**
 * Platform user accounts (used by the built-in "local" auth adapter; with the
 * Supabase adapter, users are mirrored here by id on first login).
 * All functions take a *system* transaction — users are not tenant-scoped.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { authTokens, businesses, memberships, users, type User } from "../db/schema";
import { DomainError } from "../lib/errors";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const normEmail = (e: string) => e.trim().toLowerCase();

export async function findUserByEmail(tx: Tx, email: string): Promise<User | null> {
  const [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${normEmail(email)}`);
  return u ?? null;
}

export async function getUserById(tx: Tx, id: string): Promise<User | null> {
  const [u] = await tx.select().from(users).where(eq(users.id, id));
  return u ?? null;
}

export async function createUser(
  tx: Tx,
  input: { id?: string; email: string; name?: string | null; password?: string | null; isSuperAdmin?: boolean },
): Promise<User> {
  const email = normEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("VALIDATION", "Invalid email", { field: "email" });
  if (await findUserByEmail(tx, email)) throw new DomainError("CONFLICT", "An account with this email already exists", { field: "email" });
  if (input.password !== undefined && input.password !== null && input.password.length < 8) {
    throw new DomainError("VALIDATION", "Password must be at least 8 characters", { field: "password" });
  }
  const [u] = await tx
    .insert(users)
    .values({
      ...(input.id ? { id: input.id } : {}),
      email,
      name: input.name ?? null,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      isSuperAdmin: input.isSuperAdmin ?? false,
    })
    .returning();
  return u!;
}

export async function verifyCredentials(tx: Tx, email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(tx, email);
  // Always run a hash to keep timing similar for unknown emails.
  const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!user || !ok) return null;
  await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return user;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createMagicLinkToken(tx: Tx, userId: string, ttlMinutes = 20): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await tx.insert(authTokens).values({
    userId,
    tokenHash: sha256(raw),
    purpose: "magic_link",
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  });
  return raw;
}

export async function consumeMagicLinkToken(tx: Tx, raw: string): Promise<User | null> {
  const [tok] = await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(raw)), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning();
  if (!tok) return null;
  const user = await getUserById(tx, tok.userId);
  if (user) await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return user;
}

export type MembershipView = {
  businessId: string;
  businessName: string;
  slug: string;
  role: "owner" | "staff";
  onboarded: boolean;
};

export async function getUserMemberships(tx: Tx, userId: string): Promise<MembershipView[]> {
  const rows = await tx
    .select({
      businessId: businesses.id,
      businessName: businesses.name,
      slug: businesses.slug,
      role: memberships.role,
      onboardingCompletedAt: businesses.onboardingCompletedAt,
    })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(eq(memberships.userId, userId))
    .orderBy(businesses.createdAt);
  return rows.map((r) => ({
    businessId: r.businessId,
    businessName: r.businessName,
    slug: r.slug,
    role: r.role,
    onboarded: !!r.onboardingCompletedAt,
  }));
}
