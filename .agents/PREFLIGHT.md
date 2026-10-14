# Preflight checklist

Use this before any push and paste the results into the PR verification block.

## Required local checks

- [ ] npm ci
- [ ] npm run lint
- [ ] npx tsc --noEmit
- [ ] npm run build:runtime
- [ ] npm run test:all
- [ ] npm run test:rust (if touched src-tauri)
- [ ] npm run skills:verify

## Rust-only checks

- [ ] cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
- [ ] cargo test --manifest-path src-tauri/Cargo.toml

## Branch and review rules

- [ ] Not pushing to main
- [ ] One concern per branch
- [ ] PR base confirmed
- [ ] CodeAnt tag included: `@codeant-ai review`
- [ ] CodeRabbit tag included only if this PR is substantially critical

## UI rule

- [ ] Design docs read for any UI touch: `DESIGN.md`, `engineering/design-system-baseline.md`, and any relevant surface `DESIGN.md`
