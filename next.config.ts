import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const extraDevOrigins = (process.env.BETTERSHAPE_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0 && !origin.includes("*"));

const nextConfig: NextConfig = {
  output: isProd ? "export" : undefined,
  // Dev only: Playwright and browser-preview workflows drive the dev server
  // via 127.0.0.1 (see playwright.config.ts); without this, Next blocks HMR
  // for that origin. Extra exact origins can be passed via BETTERSHAPE_ALLOWED_DEV_ORIGINS.
  allowedDevOrigins: ["127.0.0.1", "localhost", ...extraDevOrigins],
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
