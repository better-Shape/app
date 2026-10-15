# Preserve session lifecycle intent

## Why
Recovery and authorization can fail at lifecycle boundaries even when the individual save, spawn and navigation calls succeed. Incomplete keychain hydration was not retried; shared shelf-map writes lost independent updates; preview startup missed early exits; replacement services could not reconnect; viewing history cleared disposition; main-close cancellation occurred after closing peers.

## What Changes
- Retry incomplete credential hydration on the existing serialized queue, retaining local intent fences.
- Persist shelf intent per chat with legacy seed compatibility and explicit clear tombstones.
- Register preview listeners before spawn and invalidate stopped startups.
- Reauthorize replacement preview services without weakening project/origin/frame checks.
- Keep viewing history separate from explicit lifecycle actions.
- Complete main close prompts before secondary closure, then revalidate approval.

## Impact
Frontend lifecycle owners and regression tests change. No new dependency, credential plaintext format, native IPC DTO, visual primitive or platform-support claim is introduced.
