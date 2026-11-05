import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { createServerClient } from "@supabase/ssr";
import { config } from "@fekerte/core/config";
import { withSystem } from "@fekerte/core/db/tenant";
import {
  consumeMagicLinkToken,
  createMagicLinkToken,
  createUser,
  findUserByEmail,
  getUserById,
  verifyCredentials,
} from "@fekerte/core/auth/users";
import { logger } from "@fekerte/core/lib/logger";

/**
 * Auth adapter. `AUTH_PROVIDER=local` (default) uses our own users table with
 * scrypt passwords, magic links logged to the console in dev, and a signed
 * JWT session cookie. `AUTH_PROVIDER=supabase` delegates to Supabase Auth;
 * users are mirrored into our `users` table with the same id.
 */
export interface AuthAdapter {
  readonly kind: "local" | "supabase";
  signIn(email: string, password: string): Promise<{ userId: string } | { error: "invalid" }>;
  signUp(input: { email: string; password: string; name: string }): Promise<{ userId: string } | { error: string }>;
  /** Returns a dev-only link when emails are not actually sent. */
  sendMagicLink(email: string, next: string): Promise<{ ok: true; devLink?: string }>;
  /** Completes a magic-link / OAuth callback. */
  completeCallback(params: URLSearchParams): Promise<{ userId: string } | null>;
  getUserId(): Promise<string | null>;
  signOut(): Promise<void>;
}

const SESSION_COOKIE = "fk_session";
const SESSION_DAYS = 30;
const secretKey = () => new TextEncoder().encode(config.appSecret);

async function setSession(userId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

class LocalAuthAdapter implements AuthAdapter {
  readonly kind = "local" as const;

  async signIn(email: string, password: string) {
    const user = await withSystem((tx) => verifyCredentials(tx, email, password));
    if (!user) return { error: "invalid" as const };
    await setSession(user.id);
    return { userId: user.id };
  }

  async signUp(input: { email: string; password: string; name: string }) {
    try {
      const user = await withSystem((tx) => createUser(tx, input));
      await setSession(user.id);
      return { userId: user.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "error" };
    }
  }

  async sendMagicLink(email: string, next: string) {
    const token = await withSystem(async (tx) => {
      const user = await findUserByEmail(tx, email);
      return user ? createMagicLinkToken(tx, user.id) : null;
    });
    if (!token) return { ok: true as const }; // don't reveal whether the email exists
    const link = `${config.appUrl}/auth/callback?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
    // Email adapter: in local mode we log the link (no email provider required).
    logger.info("[auth] magic link", { email, link });
    return { ok: true as const, devLink: config.isProduction ? undefined : link };
  }

  async completeCallback(params: URLSearchParams) {
    const token = params.get("token");
    if (!token) return null;
    const user = await withSystem((tx) => consumeMagicLinkToken(tx, token));
    if (!user) return null;
    await setSession(user.id);
    return { userId: user.id };
  }

  async getUserId() {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  async signOut() {
    (await cookies()).delete(SESSION_COOKIE);
  }
}

class SupabaseAuthAdapter implements AuthAdapter {
  readonly kind = "supabase" as const;

  private async client() {
    const store = await cookies();
    return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Called from a Server Component: cookies are read-only there; proxy refreshes sessions.
          }
        },
      },
    });
  }

  /** Make sure the Supabase user exists in our users table (same id). */
  private async mirror(id: string, email: string, name?: string | null) {
    await withSystem(async (tx) => {
      if (await getUserById(tx, id)) return;
      await createUser(tx, { id, email, name: name ?? null, password: null });
    });
  }

  async signIn(email: string, password: string) {
    const sb = await this.client();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { error: "invalid" as const };
    await this.mirror(data.user.id, data.user.email ?? email, data.user.user_metadata?.name);
    return { userId: data.user.id };
  }

  async signUp(input: { email: string; password: string; name: string }) {
    const sb = await this.client();
    const { data, error } = await sb.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name }, emailRedirectTo: `${config.appUrl}/auth/callback?next=/onboarding` },
    });
    if (error || !data.user) return { error: error?.message ?? "error" };
    await this.mirror(data.user.id, input.email, input.name);
    return { userId: data.user.id };
  }

  async sendMagicLink(email: string, next: string) {
    const sb = await this.client();
    await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${config.appUrl}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    return { ok: true as const };
  }

  async completeCallback(params: URLSearchParams) {
    const code = params.get("code");
    if (!code) return null;
    const sb = await this.client();
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (error || !data.user) return null;
    await this.mirror(data.user.id, data.user.email ?? "", data.user.user_metadata?.name);
    return { userId: data.user.id };
  }

  async getUserId() {
    const sb = await this.client();
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? null;
  }

  async signOut() {
    const sb = await this.client();
    await sb.auth.signOut();
  }
}

let adapter: AuthAdapter | null = null;

export function getAuth(): AuthAdapter {
  if (!adapter) adapter = process.env.AUTH_PROVIDER === "supabase" ? new SupabaseAuthAdapter() : new LocalAuthAdapter();
  return adapter;
}
