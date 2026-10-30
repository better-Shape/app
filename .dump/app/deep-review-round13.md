# Round 13 deep review

Head reviewed: `15bdc30c743f4ee41c1c213c6aee70eec64786b5`

Scope: the whole `mega/absorb-all` line after absorbing PRs #3, #45, #46, #49,
#50, #51 and #53. The diff against `main` is 2631 files, so the review targeted
the boundaries that can lose user data or leak secrets rather than every line.

## Gates

- `npx tsc --noEmit`: passed
- `npx tsc --noEmit -p tests/tsconfig.json`: passed
- `npx vitest run`: 255 files, 2742 tests passed
- `npm run lint:strict`: passed
- `cargo fmt --check`: passed
- `cargo check --locked`: passed
- `npm audit`: 0 vulnerabilities after the `undici` 7.30.1 override
- Redaction tests: 3 files, 73 tests passed

`cargo audit` and `cargo deny` are not installed in this sandbox, so no Rust
advisory scan ran.

## Findings

No confirmed defect was found in the reviewed paths. The checks below record
what was inspected and why each path is considered safe.

### Chat stream store

Late chunks that carry a `turnId` are rejected unless they match the live turn.
Duplicate `chat_complete` events are ignored after the live turn is removed.
An unscoped completion event, one with a conversation id but no turn id, could
still finish a newer live turn if a legacy backend emitted it. The current
backend includes both ids, and the scoped stale-completion test passes, so this
is recorded as legacy-event robustness rather than a current defect.

### Markdown stream sanitizer

Fence scanning handles backtick and tilde fences, CRLF line endings, list
indentation and info strings. The tag scanners are quote-aware, bound their
state, and truncate malformed openers instead of swallowing later prose.
Inline code spans are protected before stripping and recomputed after nested
blocks are removed, so offsets stay valid. No unbounded regex or buffer was
found.

### Renderer

The parse cache is bounded to 8 entries and 192000 characters, keyed by raw
text. OpenUI source is bounded to 32000 characters and reports truncation.
Cached chunks are not mutated by the renderers.

### Rust chat status

`emit_chat_status` and `emit_chat_status_scoped` duplicate label inference and
model-reset logic. Both produce the same payload shape and call sites pass the
turn and conversation ids. This is a cleanup opportunity, not a defect.

### Redaction

Chat error redaction, terminal persistence redaction and diagnostics scrubbing
cover assignments, bearer and basic tokens, URL authority passwords, query
secrets, known key prefixes and PEM blocks. The terminal path is explicitly
best-effort and bounded by its persistence caps.

### Installer and CI

The installer uses the static `sidebar.bmp`; the animated NSIS design from
PR #45 remains out. Workflows use least-privilege defaults, pin actions by full
SHA, and disable checkout credential persistence where PR-controlled Cargo
build scripts run.

## Residual items

- The upstream OpenUI parser has not been reviewed at dependency level.
- There is no dedicated Rust test for the Ask-only OpenUI prompt branch.
- `npm run qa` has a pre-existing `/settings` hydration-audit mismatch
  documented in `e2e/README.md`; it is not green.
- Multi-window restore and shutdown races have no concrete reproduction.
- The micro-interaction backlog in
  `.dump/app/micro-interaction-roadmap-2026-10-15.md` is deliberate design
  work, not review findings.
