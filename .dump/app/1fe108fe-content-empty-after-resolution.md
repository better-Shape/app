# 1fe108fe resolved to zero content (2026-10-23)

Cherry-picking PR #3 commit 1fe108fe "settings: persist redacted preferences without
sacrificing legacy recovery" onto mega/absorb-all after the taken-over remote line already
carried the same work. All four add/add blobs (src-tauri/src/core/settings_file.rs,
tests/lib/settings-bridge-ordering.test.ts, tests/lib/settings-desktop-store.test.ts,
.dump/app/audits/protected-settings-preferences.md) resolved toward the stage-2 side
because ours was a byte-superset of theirs (18378 vs 13284 bytes for settings_file.rs,
14611 vs 6046 for the ordering test, 4508 vs 2834 for the desktop-store test, 13748 vs
8734 for the audit doc with an extra "Fields this build does not model" section). Content
conflicts (lib/backend/commands.ts TurnJournal import, src-tauri/src/core/mod.rs
session_ownership module, tests/lib/settings-persistence.test.ts forged-redacted construct)
all favored ours as evolved states. After staging, the sequencer reported the pick EMPTY:
every line of 1fe108fe is already on the absorbed line, so the patch was skipped and
recorded here instead of committed empty. If PR #3 is re-read later, do not re-pick this.
