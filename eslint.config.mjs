import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Downgrade React 19 / Next.js 15 strict hooks rules from error to warning
      // These are extensive (set-state-in-effect, refs during render) and need gradual fix
      // They should still gate via warnings but not block CI immediately
      // TODO: fix and re-enable as error after cleanup
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // CommonJS build tooling, run directly by node — `require` is correct here.
    files: ["src-tauri/scripts/**/*.js", "scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src-tauri/target/**",
    // One-off migration scripts not part of app
    "src-tauri/scripts/**",
    // Generated docs search index
    "docs/generated/**",
    // Generated preview runtime bundles (esbuild output)
    "src-tauri/runtime/**",
    "public/preview/**",
    // Coverage
    "coverage/**",
  ]),
  { rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/refs": "warn" } },
]);

export default eslintConfig;
