# Workflows

## CI (`ci.yml`)

Main quality gate. Runs on PRs and pushes to `main`.

- Lint & Typecheck (ESLint + tsc --noEmit)
- Test JS (Vitest)
- Test Rust (Cargo)
- Rust Lints (fmt, clippy -D warnings, check)
- Build Next.js (export)
- Version Sync Check (package.json ↔ tauri.conf.json ↔ Cargo.toml)
- Security Audit (npm + cargo, warn)
- CI Success gate (required)

Uses composite action `.github/actions/setup` for Node 22 + Rust + caches.

Concurrency: cancel stale PR runs, let main finish.

## Security (`security.yml`)

- CodeQL for JS/TS and Rust
- Dependency Review (PRs only)
- Audit (npm + cargo)
- Zizmor (Actions linter)
- Scorecard (main only, weekly + push)

Triggers: PR, push to main, weekly Monday 00:00 UTC.

## Release (`release.yml`)

Tag `v*` → test → build Windows x86_64 + aarch64 → publish.

- Test job validates tag == package.json version
- Build matrix uses windows-latest + windows-11-arm
- Secrets verified before build
- SBOM via anchore/sbom-action
- Publish job generates notes, attests provenance, uploads via retry script

Concurrency: `release-${ref}` cancel-in-progress false (never cancel release).

## PR Hygiene (`pr.yml`)

- Title lint (conventional area: description)
- Large file check (>5MB)
- Secret heuristic
- Size warning (>2000 lines)

## PR policy check: `pr-policy.yml`

- Triggers on `pull_request_target` when a PR opens, is edited, receives a new head, or reopens. GitHub runs the trusted workflow definition from the repository's default branch; this workflow must be present there before the check can run. A PR that introduces the workflow does not activate its own check.
- Checks the required PR sections and completed Verification Gate and Code Research Gate fields, the CodeAnt body tag, a Yes or No criticality classification, and that the recorded 40-character head SHA matches the current PR head.
- Fails closed when GitHub's pull-request files API returns its 3,000-file maximum, because additional changed paths may be omitted and cannot be classified reliably.
- Marks workflow and policy changes, shared GitHub Actions, release scripts, `lefthook.yml`, and documented policy files as critical. Critical PRs must include the CodeRabbit body tag; other PRs must omit it. Automatic CodeRabbit reviews for non-draft PRs targeting `main` remain separate; drafts are excluded by `.coderabbit.yaml`.
- Uses only `pull-requests: read`; it does not check out or execute PR code.
- The check validates PR body content, not standalone bot comments. Contributors still post the required comments and record their links and head SHA.
- `PR Policy Check` is a separate status, not part of `CI Success`. Branch protection must require it directly for failures to block merging.

## Composite Setup (`.github/actions/setup`)

DRY setup for Node, Rust, system deps, caches.

Inputs:

- node-version (default 22)
- install-rust (default true)
- rust-targets
- rust-components (rustfmt,clippy)
- install-system-deps
- cache-key

## Dependabot (`.github/dependabot.yml`)

Weekly updates for npm, cargo (src-tauri), GitHub Actions.

Grouping for dev deps and next ecosystem to reduce noise.

## Local vs CI

```text
npm run lint          → lint job
npm run typecheck    → lint job
npm run test          → test-js
npm run test:rust     → test-rust
cargo fmt --check     → rust-lints
cargo clippy -D warnings → rust-lints
npm run build         → build
npm run sync-version  → version-sync
npm run test:all      → local aggregate (CI runs Vitest and Cargo separately)
```

On a network that cannot reach `crates.io` or the Playwright browser CDN, the Rust and browser gates
still run through the orphan branch `vendor/sandbox-toolchain`, with the two cargo flags
`engineering/rust-toolchain.md` documents. See
`engineering/rust-toolchain.md` for the cargo flags and `engineering/sandbox-vendored-toolchain.md`
for the fetch recipe. `.github/CICD_REVIEW_AND_IMPLEMENTATION.md` records that pipeline as it stood
on 2026-10-12 and is not a recipe.

## Adding a new workflow

1. Use top-level `permissions: contents: read`
2. Elevate per job only if needed (`contents: write`, `security-events: write`, `id-token: write`)
3. Add `timeout-minutes` to all jobs
4. Use composite setup action
5. Add concurrency with appropriate cancel-in-progress
6. Use `actions/checkout@v4`, `setup-node@v4`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`
7. Document in `docs/developing/ci-cd.mdx`
