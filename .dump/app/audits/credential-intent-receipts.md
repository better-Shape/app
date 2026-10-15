# Credential intent and completion receipts

## Contract and failure mechanism

A native vault completion must not rewrite a newer credential intent. Checking a localStorage token and then writing to the same key is not an atomic compare-and-swap across WebViews. A deletion can be recorded between those two operations, then erased by the older save acknowledgement.

The keychain's revision check protects the native value, but it cannot recover deletion intent that the renderer erased before the delete reached the keychain. This matters on restart, when metadata controls hydration and deletion retries.

## Storage decision

User edits write `bettershape-ai-vault-entry:${encodeURIComponent(id)}`. Successful native completions write `bettershape-ai-vault-receipt:${encodeURIComponent(id)}` instead. Both contain only a random token and operation state, never a credential value.

Readers apply a receipt only when its token matches the current intent and its completed state matches that operation. A stale receipt cannot replace a pending deletion. There is one receipt slot per credential id, not a growing receipt history. An older receipt can replace a newer receipt, but a mismatched token then leaves the current intent pending and causes a conservative retry rather than restoring a key.

Existing plain `stored`/`delete` markers and JSON completed states remain readable. This is backward-readable storage, not a guarantee that old and new app versions can write concurrently. Native revision and destination checks remain unchanged.

A metadata write failure retains the local deletion in the existing in-memory intent map. Retry enumeration includes these entries even when settings no longer contain the removed key. No plaintext recovery file or journal is introduced.

## Migration distinction

Two different nonempty legacy credentials, or different destinations, still require explicit review. A redacted desktop copy at the same destination is not evidence of a conflicting key. Existing plaintext is removed only after successful vault persistence.

## Evidence and limits

- `tests/lib/ai-vault-cross-window.test.ts` interleaves a second module's deletion precisely between the first module's ownership check and receipt write, then imports a fresh reader and retries deletion. It failed with the shared-entry acknowledgement and passes with separate receipts.
- `tests/lib/ai-sync.test.ts` rejects localStorage writes during a clear, restores storage and exercises explicit retry. The key remains saved during failure and is deleted after retry. This failed when retry enumeration ignored the in-memory clear.
- `tests/lib/ai-vault-fallback.test.ts` migrates a local legacy key against a redacted desktop copy while retaining divergent-key and divergent-destination regressions.
- These tests use mounted modules, actual jsdom storage and a revision-aware simulated native vault. They do not prove native keychain execution or real multiprocess WebView delivery. Native and independent-review gates remain separate and incomplete.
