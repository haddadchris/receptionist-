/** Central runtime configuration read from environment variables. */
const DEV_SECRET = "dev-only-insecure-secret-change-me-0123456789";

export const config = {
  get appUrl(): string {
    return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get voiceUrl(): string {
    return (process.env.VOICE_PUBLIC_URL ?? "http://localhost:3001").replace(/\/$/, "");
  },
  get appSecret(): string {
    const s = process.env.APP_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("APP_SECRET must be set (32+ chars) in production");
      }
      return DEV_SECRET;
    }
    return s;
  },
  get cronSecret(): string | undefined {
    return process.env.CRON_SECRET;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
