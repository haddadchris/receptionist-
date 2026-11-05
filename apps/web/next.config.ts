import type { NextConfig } from "next";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Monorepo: load the repo-root .env (apps/web/.env* still take precedence via Next).
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@fekerte/core"],
  serverExternalPackages: ["postgres"],
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  poweredByHeader: false,
  experimental: {
    // Receipt uploads (≤ 5 MB) go through server actions.
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    return [
      // Everything except the chat widget: never framed (clickjacking).
      { source: "/((?!chat/).*)", headers: [...common, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      // The web-chat page is embedded by widget.js on clinics' own websites.
      { source: "/chat/:path*", headers: [...common, { key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
};

export default nextConfig;
