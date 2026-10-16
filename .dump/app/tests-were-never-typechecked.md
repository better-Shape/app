# The test suite was never type-checked, and that hid real defects

## What I found

`tsconfig.json` excluded tests from `tsc`:

```json
"exclude": ["node_modules", ".agents", ".claude", "tests", "**/*.test.ts", "**/*.test.tsx"]
```

There was no second tsconfig covering tests, and vitest does not typecheck. So the
root `tsc --noEmit` had never once looked at a test file, and `npm run typecheck`
reported a clean gate while every test import path was unchecked.

## The defect it hid

Two agents writing test files in the same session produced the SAME class of
broken relative import: `../helpers/tauri` and `../helpers/events` from a file
two directories deep, where the real path is `../../helpers/...`. Neither was
caught by any gate. Vitest caught them only because the import happened to be
top-level enough to fail at collection time; an import used lazily inside a test
would have thrown at run time or, worse, been swallowed by a try/catch.

## Why it matters beyond the two files

Every test that constructs a fake for a real type is unverified. A test passing
`undefined` where a `number` is required, or an object literal with a property
that no longer exists, is a test that no longer tests what it claims. Adding the
scope surfaced 33 such errors immediately across long-standing test files.

## The fix

`tests/tsconfig.json` extends the root config, turns the excludes off, and pulls
in the ambient declarations the root config gets from its own include list
(`global.d.ts` for `*.css`, plus the `styled-jsx` and `vitest/globals` types that
two test files rely on implicitly). `npm run typecheck` now runs both configs,
and `ci.yml`, `lefthook.yml` and `pr-policy.yml` were updated to call the script
rather than naming `tsc` directly, so the scope cannot silently regress.

## Verified, not assumed

- Root `tsc --noEmit` is still clean: 0 errors.
- The new config reports errors in test files, which is the point.
- MUTATION CONTROL: adding one unknown property to an object literal in
  `tests/lib/models-keys.test.ts` produced errors in that file, and removing it
  returned to the previous count. The new gate can fail.
- Zero errors in the three new test suites (`tests/git/stash`, `tests/packages`,
  `tests/git/blame`), so this was pre-existing debt, not something the new work
  introduced.

## Not fixed here, deliberately

The 33 pre-existing errors are recorded, not mass-edited. Several are real drift
between a test's fixture and a type that has since changed, and each deserves a
decision about which side is right. Bulk-editing them without reading each one
would be exactly the "delete the assertion to get to green" move this repo's own
rules forbid.
