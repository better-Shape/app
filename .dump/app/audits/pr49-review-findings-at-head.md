# PR 49 review findings: disposition at HEAD

## Conclusion

Every live finding the review tools raised against PR 49 is either already
fixed on `mega/absorb-all` or was not a defect. One genuinely-live defect
survived: embedding-model routing across the TypeScript/Rust boundary. It is
fixed here.

The reason a re-derivation was needed at all is a branch fact, not a code fact.
PR 49's head is `arena/7861709c-app`, its base is `draft/mega-absorb-all`
(`f2cefa62`), and the branch `pr49` (`c8ff4be0`) is a **parallel** line with
merge base `ee90df4a` ("chore: release v0.0.1"). `mega/absorb-all` and `pr49`
are 536 commits apart. In particular `d60a5b6b` ("fix(ai): address review
findings on catalog, embeddings, and model routing") is **not** an ancestor of
HEAD, and the file it fixes, `lib/ai/model-catalog.ts`, does not exist on HEAD.
So no PR 49 fix commit can be assumed present; each finding has to be checked
against the line it names on HEAD.

## The live defect: embedding-provider routing

`embeddingsTarget()` in `lib/ai/providers.ts` chose the provider for the
semantic index, but `toRustAiConfig()` sent only `embeddingModel` and dropped
the provider id. Rust's `embeddings_target()` then re-derived a provider by
preference order (`openai` > `openrouter` > any other OpenAI-wire provider).
The two halves of one contract disagreed: a user who selected `mistral-embed`
while an OpenAI key was also present had that slug sent to OpenAI, whose
`/embeddings` rejects it. The same held for any vendor slug (NVIDIA, Together,
Qwen, DeepInfra).

The fix makes the frontend's pick authoritative:

| Side | Change |
| --- | --- |
| `lib/ai/providers.ts` | `embeddingsTarget()` routes a named model to a connection that advertises it (preset `embeddingModels`, or the connection's `models`/`extraModels`), else falls back to the old preference order. `RustAiConfig` gains `embeddingProvider`. |
| `src-tauri/src/core/ai_providers.rs` | `AiProviderConfig` gains `embedding_provider` (serde camelCase maps to `embeddingProvider`). `embeddings_target()` honours it when it names a usable OpenAI-wire provider, else falls back to the preference order. |
| `lib/backend/commands.ts` | `setAiConfig`/`getAiConfig` IPC types carry the field. |
| `lib/preview/tauri-mock.ts` | Preview config includes it. |

Evidence the TS test catches the regression: stashing `lib/ai/providers.ts` and
running `tests/lib/ai-providers-secrets.test.ts` fails
`routes a vendor model to the connection that advertises it` with
`expected { Object (id, model) } to deeply equal { id: 'mistral', … }`.

## Findings already fixed at HEAD

Verified by reading each anchor on HEAD. Grouped by the file the report names.

- `features/chat/ui/prs/query.ts`: `-draft:false` uses
  `(value === "true") !== negated`, and `status:all` returns `!negated`.
- `tests/editor/bracket-actions.test.ts`, `features/chat/ui/prs/query.ts`
  (CodeQL "incomplete string escaping"): the anchors no longer hold the
  patterns; the current `unquote` uses global `replace(/\\"/g, …)`.
- `features/editor/ui/main/hooks/use-file-content.ts`: `cancelled` is read in
  every async continuation after its guard.
- `features/agent/sidebar/motion/animated-size.tsx`: `durationMs` is consumed;
  `defaultCreateObserver` calls `new ResizeObserver(() => onResize())` with no
  superfluous argument; `AnimatedWidth` is the documented width twin.
- `features/agent/workspace/problems-tab.tsx`: `manualRun` is in the effect
  inputs.
- `src-tauri/src/commands/ai_byok.rs`: Anthropic requests `?limit=100` and
  Google `?pageSize=200`, which return the full list in one page.
- `src-tauri/src/core/ai_providers.rs`: `opencode-go` maps to `zen-go`; the
  `x-goog-api-key` auth style has a matching arm.
- `src-tauri/src/commands/testing/mod.rs`: a nonzero exit is an error only when
  the runner produced no results.
- `src-tauri/src/agent/commands/streaming.rs`: the nested `reasoning` object is
  skipped for direct OpenAI; `data:` without a space is parsed.
- `src-tauri/src/agent/tools/plugins.rs`: all-failed searches report the
  failures instead of "no matching actions".
- `src-tauri/src/agent/tools/search.rs`: the native fallback compiles the same
  glob; `filter_entry` exempts depth 0; redirects are followed manually with
  `validate_outbound_url_resolved` on every hop; the body is capped while
  streaming.
- `src-tauri/src/agent/commands/provider_wire.rs`: Gemini's `thinkingConfig` is
  sent when thinking is off.
- `features/chat/lib/use-chat-session.ts`: the composer is consumed only at
  admission; the viewed chat is activated before a native compact.
- `src-tauri/src/mcp/admin.rs`: `redact_inline_secrets` masks inline
  credentials before model-visible output.
- `.github/workflows/ci.yml`: the Rust jobs set `persist-credentials: false`.
- `features/editor/ui/codemirror/editor.tsx`: wrap/indent/EOL seed from
  `getEditorOptionsFromSettings()` and live in compartments.
- `src-tauri/src/mcp/registry.rs`: legacy `sse` remotes reuse the HTTP client,
  which negotiates the content type.
- `src-tauri/src/agent/tools/dispatch/meta.rs`: `insert_new` closes the
  concurrent-add race; `env` changes trigger approval; `test` requires approval
  when the command changes; an `Error` status inside `Ok` is reported.

## Gates at the fix head

Run on `mega/absorb-all` with the vendored toolchain from
`vendor/sandbox-toolchain` (`58094f1c`), `--ignore-rust-version`, and
`CARGO_BUILD_JOBS=1`.

- `cargo fmt --all -- --check`: clean.
- `cargo clippy --all-targets --all-features -- -D warnings`: clean.
- `cargo test --all-features`: 437 passed, 0 failed.
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm run test`: 212 files, 2362 tests pass.
- `npm run skills:verify`: 53 of 53 locked skills verified.

Two sandbox notes worth keeping. The `Cargo.lock` sha pin in `FETCH.md` is stale
for this branch, because `2111ece7` added `globset`; the vendor tree still
covers every package. And the Rust test binary needs `libunistring.so.2`, which
is absent from the extracted sysroot but present at
`system/tools/lib/libunistring.so.2` in the payload; without it the binary exits
127 before any test runs.
