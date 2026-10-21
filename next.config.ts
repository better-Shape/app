import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NEXT_TELEMETRY_DISABLED = "1";
process.env.OPENUI_TELEMETRY_DISABLED = "1";

const isProd = process.env.NODE_ENV === "production";
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const watchIgnored = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.next/**",
  "**/out/**",
  "**/src-tauri/target/**",
  "**/src-tauri/runtime/**",
  "**/target/**",
];

const nextConfig: NextConfig = {
  env: {
    OPENUI_TELEMETRY_DISABLED: "1",
  },
  output: isProd ? "export" : undefined,
  // Dev only: Playwright uses loopback and Arena proxies the live preview
  // through a dynamic *.e2b.app hostname. No effect on the production export.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.e2b.app"],
  // Use root-absolute asset URLs so secondary windows (/settings/, /git/, etc.)
  // load CSS/JS from /_next/... instead of broken nested /_next/... paths.
  trailingSlash: isProd ? true : undefined,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    optimizePackageImports: ["@tauri-apps/api", "react-syntax-highlighter"],
  },
  // Cut noisy full reloads when Cargo/target or runtime files change.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: watchIgnored,
      };
    }
    return config;
  },
};

export default nextConfig;
