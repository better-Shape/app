# Impeccable layout detector execution

- Surface: the existing agent workspace file-editor and explorer group.
- Conflict: `impeccable/reference/layout.md` recommends running `.agents/skills/impeccable/scripts/impeccable detect --json`; `engineering/design-skills.md` explicitly forbids running Impeccable's launcher because it downloads and executes an external binary.
- Decision: do not run the detector. Inspect the source and rendered layout, then use the existing local Playwright E2E flow and build/type/lint checks as evidence.
- Scope: no detector output is represented as a pass.
