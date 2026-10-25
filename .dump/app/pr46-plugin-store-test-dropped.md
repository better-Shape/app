# PR #46: dropped `tests/lib/settings-tauri-store.test.ts`

The motion-review follow-up added a test that mocks `@tauri-apps/plugin-store` and drives
`initSettings()` through that adapter. This branch no longer has that adapter: desktop
persistence goes through `lib/settings/desktop-store.ts`, which reads and writes the two
fixed native settings files through `commands.readSettingsFile` /
`commands.writeSettingsFile` and carries the opaque revision itself.

Keeping the test would mean resurrecting the plugin-store path it was written for. The two
behaviours it pinned already have coverage against the live adapter:

- an edit made while the startup read is pending survives hydration —
  `tests/lib/settings-bridge-ordering.test.ts`, "retains a local edit made while a native
  reconciliation read is pending";
- concurrent snapshots serialize so an older save cannot finish last —
  `tests/lib/settings-desktop-store.test.ts`, "acknowledges the saved clone without losing a
  newer set during the write".

The file is dropped rather than rewritten because the mock it is built on targets a module
the store never imports.
