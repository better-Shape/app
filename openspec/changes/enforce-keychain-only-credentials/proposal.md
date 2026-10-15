# Keychain-only provider credential persistence

## Why

The failed-write fallback copied unrelated vaulted keys into plaintext and let stale settings saves erase recovery drafts. The user approved keychain-only persistence instead of a redesigned plaintext recovery store.

## What changes

- Persist provider, service and connection-header secrets only in the OS keychain.
- Keep failed edits in memory with unsaved state, retry and close warnings.
- Preserve legacy plaintext copies until migration succeeds. Require destination review or explicit re-entry when copies disagree.
- Distinguish unreadable native accounts from empty credentials.
- Persist destination bindings inside vault records and reject mismatched hydration and runtime configuration.
- Keep early edits while hydrating unrelated settings.
- Await file-save acknowledgements and revalidate close approval before destroying a window.

## Impact

Users without a usable OS keychain can use session-only credentials but cannot persist new ones. Existing legacy settings may remain unchanged until migration completes. Forced termination can lose unsaved edits. No new dependency, recovery file, telemetry or broader capability grant is required.

The user approved this direction. Native runtime and complete review verification remain pending.
