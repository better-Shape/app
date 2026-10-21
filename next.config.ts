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
const forwardedDevOrigins = (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const extraDevOrigins = (process.env.BETTERSHAPE_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0 && !origin.includes("*"));

const nextConfig: NextConfig = {
  env: {
    OPENUI_TELEMETRY_DISABLED: "1",
  },
  output: isProd ? "export" : undefined,
  // Dev only: local Playwright uses loopback; forwarded previews and explicit dev
  // origin overrides can add exact host patterns without opening wildcard origins.
  allowedDevOrigins: ["127.0.0.1", "localhost", ...forwardedDevOrigins, ...extraDevOrigins],
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
