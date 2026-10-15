# Dependency audit checkpoint — 2026-10-14

This checkpoint is **not** the missing devbox analysis report. That report and
its adjudication state were not available in the continuation environment.

## JavaScript dependency evidence

- `npm audit --omit=dev --audit-level=high`: no production dependency findings.
- Full `npm audit`: five high-severity entries, all from one advisory and its
  dependency chain: `eslint-config-next` → `@next/eslint-plugin-next` →
  `fast-glob` → `micromatch` → `braces`.
- Advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
  stack-exhaustion denial of service with deeply nested brace patterns.
- `npm view braces version` returned `3.0.3`; the advisory covers `<=3.0.3`.
  There is no patched published version at this checkpoint. This is a real,
  development-tooling risk, **not a false positive**. Do not downgrade Next's
  ESLint configuration to a different framework major just to clear an audit.
  Run lint only in resource-limited environments against untrusted checkouts.
- Removed the unused general-purpose `gray-matter` dependency chain, including
  the `sprintf-js` unbounded-precision advisory. The docs index now uses
  YAML-only metadata parsing; it has no executable frontmatter language engine.
- Updated the TypeScript ESLint toolchain to `8.71.2`, whose peer range includes
  TypeScript 6. `package-lock.json` is the sole application dependency lockfile;
  the pre-consolidation Bun lockfile was stale and has been removed.

Re-run both audits after dependency changes. This file does not suppress any
scanner result or turn a failed audit into a passing check. Cargo audit and
external Sonar/reviewer findings require their own evidence.
