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
    // CommonJS build tooling, run directly by node, `require` is correct here.
    files: ["src-tauri/scripts/**/*.js", "scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // The codebase marks a deliberately-unused parameter with a leading `_`.
    // That is a real, applied convention across the app, so honour it instead
    // of warning on it.
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
  {
    // Playwright fixtures receive a `use()` callback that is not a React
    // hook; the hooks rule cannot tell the difference.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
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
    // Agent-skill bundles, not application source. `.claude/skills` is a symlink
    // to `.agents/skills`, and the skill bodies include third-party minified
    // bundles. Nothing in `app/`, `features/`, `lib/` or `src-tauri/` imports or
    // executes them. Linting them reports minifier artefacts, not defects.
    ".claude/**",
    // Vendored skill trees (`npx skills`), recorded in skills-lock.json. Their
    // fixtures include .tsx files that are not application source, and nothing
    // under .agents is imported by the app or bundled into a build.
    ".agents/**",
    // One-off migration scripts not part of app
    "src-tauri/scripts/**",
    // Generated docs search index
    "docs/generated/**",
    // Generated preview runtime bundles (esbuild output)
    "src-tauri/runtime/**",
    "public/preview/**",
    // Coverage
    "coverage/**",
    // Playwright output from `npm run qa`: traces, screenshots and a report bundle
    // whose assets are minified. ESLint reads them as source and its formatter
    // dies on the 500KB+ bundles, so `npm run qa && npm run lint` used to crash.
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    "playwright/.cache/**",
  ]),
  {
    // Node tooling scripts; the Next.js config never defines the React hooks
    // plugin for .cjs files, so its hook rules must be off there rather than
    // warn, or ESLint fails the run on a missing plugin. This block must stay
    // after the global rules blocks above or they re-enable the rules.
    files: ["scripts/**/*.cjs"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
    },
  },
]);

export default eslintConfig;
