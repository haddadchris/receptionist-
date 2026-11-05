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
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
