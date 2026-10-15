# Preflight checklist

Use this before every push. Paste the results and head SHA into the PR Verification Gate section.

## Required local checks

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build:runtime`
- [ ] `npm run test:all`
- [ ] `npm run test:rust` if you touched `src-tauri/`
- [ ] `npm run skills:verify`

## Rust checks

If you changed Rust, also run:

- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

## Branch and review rules

- [ ] Work is on a focused branch, not `main`.
- [ ] The PR base matches the branch's inherited base.
- [ ] I confirmed `PR Policy Check` is required directly by branch protection, or noted the maintainer action needed to configure it. The workflow must be present on the default branch before GitHub runs it.
- [ ] The PR body includes `@codeant-ai review`.
- [ ] I posted a standalone `@codeant-ai review` comment and recorded its link and head SHA.
- [ ] I set `Substantially critical` to Yes or No and gave a reason when Yes.
- [ ] If the PR is substantially critical, I included and posted `@coderabbitai review` and recorded its link and head SHA.
- [ ] If the PR is not substantially critical, I did not manually request CodeRabbit. Automatic reviews for non-draft PRs targeting `main` still run and must finish before reporting the PR ready; drafts are excluded.
- [ ] Before reporting ready, I confirmed CodeAnt approved the current head, all applicable CodeRabbit reviews completed (manual for substantially critical PRs and automatic for non-draft PRs targeting `main`), required checks passed, no review thread remains unresolved, and the ten-minute quiet window passed.

A PR is substantially critical if it changes a public contract in a breaking way, fixes a security issue, changes major architecture or protocol, makes a new platform support claim, or materially changes repository policy or workflows.

## UI rule

- [ ] For a UI change, I read `DESIGN.md`, `engineering/design-system-baseline.md`, and any relevant surface design file before editing.
