# S9383: seven floating promises, all real

SonarCloud reports 28 `typescript:S9383` ("Promises must be awaited...") at line
numbers that no longer hold the code. The report was generated against an older
commit, so the anchors are stale.

Rather than trust the anchors, the rule was run directly with type information
(`@typescript-eslint/no-floating-promises`, `ignoreVoid: true` to match what
SonarCloud accepts, across `features/`, `lib/`, `core/` and `components/`). That
found 7 genuine dropped promises in 6 files:

- `features/terminal/ui/terminal.tsx:455` — `init()`, an async function whose
  rejection was dropped. Now `void init().catch(...)`.
- `features/terminal/ui/terminal.tsx:748` — a dynamic `import(...)` whose
  rejection was dropped, plus the inner `invoke` chain. Both now terminate.
- `features/agent/sidebar/chats.tsx:325` — `loadChats()` inside an event
  listener; it returns a promise that already self-catches, so `void` matches
  the neighbouring call two lines up.
- `features/chat/lib/use-chat-session.ts:1747` — `handleSendMessage()` from the
  Enter key handler. The function has a `finally` but no `catch`, so a rejected
  send was unhandled. Now `void ... .catch(...)`.
- `features/command-palette/cmd-palette.tsx:976` — a dynamic import for the
  language-mode picker. Now terminates.
- `features/git/ui/branches/actions.ts:223` and
  `features/git/ui/branches/panel.tsx:559` — `commands.openUrlExternal(...)`
  inside an `async` try/catch. These take `await`, so a rejected open surfaces
  in the existing catch and the error toast fires.

The `ignoreVoid: false` variant of the same run reported 548 problems across the
tree; those are `void`-marked calls that SonarCloud does not flag, so the
narrower run is the one that matches the report.

After the fix the same run reports zero. `npx tsc --noEmit` is clean and the
terminal and shortcut test files pass (51 tests).
