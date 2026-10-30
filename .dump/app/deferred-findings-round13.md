# Round 13 deferred findings: dispositions

Reviewed at `8bc5e7ad` against the current tree. No open item in this file is a
confirmed code defect.

## PR #49 review findings

The audit in `audits/pr49-review-findings-at-head.md` covers every inline
finding. All are fixed at HEAD except the one genuine cross-boundary defect,
which is fixed and covered by tests:

- `lib/ai/providers.ts` carries `embeddingProvider` through `RustAiConfig` and
  `toRustAiConfig()`.
- `lib/backend/commands.ts` and `lib/preview/tauri-mock.ts` keep the IPC shape
  in sync.
- `src-tauri/src/core/ai_providers.rs` stores `embedding_provider`, routes
  `embeddings_target()` through it, and tests the named-provider and
  default-provider cases.

The remaining findings were re-checked at HEAD and are already addressed:
query negation, unquote escaping, cancelled guards, the motion observer,
problems-tab dependencies, BYOK pagination, the zen-go/auth arm, streaming
reasoning and data parsing, and the plugin, search, provider-wire, MCP, admin,
CI, editor, registry and meta findings.

## Chat streaming review

- **C-02** upstream OpenUI parser review: dependency-level work, no local
  defect. The parser is constrained and bounded in `features/chat/ui/md`.
- **C-03** no dedicated Rust test for the Ask-only OpenUI prompt branch: a
  coverage gap, not a defect. The prompt selection is exercised indirectly by
  the chat turn tests.
- **C-05** the earlier OpenUI postinstall request: delivery is unknown, but
  telemetry is disabled through the `.npmrc` `node-options` preload, so no
  install-time network request is expected from the current tree.
- **C-06** runtime multi-window races and the remaining restore/shutdown paths:
  broad, with no reproduction. Track as follow-up work rather than a finding
  against this diff.
- `npm run qa` is **25 passed / 1 failed**, not green. The failure is the
  pre-existing `/settings` hydration-audit mismatch documented in
  `e2e/README.md`; it is unrelated to the absorption.
- The note recommending `macos-15-intel` predates the current workflows. All
  three use `macos-26-intel` for x86_64 and `macos-latest` for arm64. The Kilo
  Windows-compile finding is addressed by the `Manager`/`get_webview_window`
  imports in `src-tauri/src/browser/surface.rs`.

## Other open documents

- `round-9-deepsource-findings-loop-2026-10-16.md`: `features/chat/ui/md/view.tsx`
  has a forward reference between the component map and `ChatMarkdown`. The
  analyzer reports it as a growing diff-window finding, but the recursion is
  required by the component registry and is not a code defect.
- `micro-interaction-roadmap-2026-10-15.md` and
  `reports/micro-interactions-2026-10-15.md`: the remaining items are planned
  design work (hold-to-confirm, first-run states, git-graph branch line,
  `DrawnCheck` wiring, four orphan motion patterns, folding the collapsible and
  dropdown into `Collapse`, terminal-dot scope, refreshed captures; roughly
  16.5 hours). They are not review findings against this diff.

The raw `/tmp/opencode/reviews-digest/` files are HTML dumps with repeated
DeepSource comment bodies and are not used as a finding list here.
