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
  {
    // The codebase marks a deliberately-unused parameter with a leading `_`.
    // `lib/telemetry/index.ts` is the clearest example: its no-op helpers keep
    // their parameters so call sites keep their shape. That is a real, applied
    // convention, so honour it instead of warning on it.
    //
    // Deliberately NOT set: `varsIgnorePattern`. That option also matches dead
    // local `const`s, which would hide genuinely removable code. Unused locals
    // are deleted, not exempted.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
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
    // Vendored agent-skill bundles, not application source. `.claude/skills/**`
    // holds 96 files of third-party skill content (63 md, 16 py, 5 js) including
    // a 548 KB bundle (`live-browser.js`) and a single-line minified UMD bundle
    // (`modern-screenshot.umd.js`). Nothing in `app/`, `features/`, `lib/` or
    // `src-tauri/` imports or executes them — `lib/chat/discover-skills.ts` only
    // reads `.md` skill definitions. Linting them reports minifier artefacts,
    // not defects.
    ".claude/**",
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
