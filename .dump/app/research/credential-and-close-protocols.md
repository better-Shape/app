# Credential and close protocol research

## Scope

These checks cover the credential record format, keyring errors and file-close dialogs. They do not constitute a full review of the consolidated branch or replace native execution.

## Primary sources

| Assumption | Source | Conclusion |
| --- | --- | --- |
| A missing password is distinguishable from a failed read. | [keyring 3.6.3, `Entry::get_password`](https://github.com/open-source-cooperative/keyring-rs/blob/v3.6.3/src/lib.rs), blob `00d91f430846b91fe4303ebf2bad8722735f9364`, lines 419 onward | `NoEntry` represents absence. Other errors, including ambiguous entries, must not grant a deletion lease. This version matches `src-tauri/Cargo.lock`. |
| An internally tagged enum may flatten a struct into its variant. | [serde 1.0.228, `containing_flatten`](https://github.com/serde-rs/serde/blob/v1.0.228/test_suite/tests/test_enum_internally_tagged.rs), blob `b4d428c4dd901b2d31e7326245aa8cca9eb0dfc8`, lines 1395 onward | The upstream test covers the serialization pattern used by `ReadResult::Available`. The app's own serialization test must still run. This version matches the lockfile. |
| A native message dialog can distinguish Save, Don't save and Cancel. | [dialog 2.6.0, command implementation](https://github.com/tauri-apps/plugins-workspace/blob/dialog-v2.6.0/plugins/dialog/src/commands.rs), blob `f02863252402d0473c4931591c08d088b14ea56c`, lines 291 onward; [dialog result models](https://github.com/tauri-apps/plugins-workspace/blob/dialog-v2.6.0/plugins/dialog/src/models.rs), blob `330388f8e98cdb379f6312b3b10ca3eea39ac770`, lines 50 onward | `message` accepts `YesNoCancelCustom` and returns a `MessageDialogResult`. `Custom(String)` serializes as the label itself. The caller accepts the explicit save or discard result and treats other results as cancellation. Both npm and Cargo use 2.6.0. |

The installed dialog TypeScript declaration also exposes `buttons: { yes, no, cancel }`. The boolean `confirm` API cannot distinguish cancelling a file-close dialog from choosing its negative button. Credential-close confirmation remains binary because its negative result always keeps the window open.

## Rejected approaches

- Treating all keyring read failures as missing accounts would authorize a clear without observing the saved revision.
- Deleting the whole vault account would erase the generation that rejects stale writes after restart. A clear therefore retains a non-secret record.
- A per-window saved-value cache cannot validate another window's mutation. The native coordinator validates every write and destination.
- A fixed delay after Save All does not acknowledge disk writes. The close path waits for promises and checks dirty state again.
- A Don't save branch must not clear recovery before checking whether approval still covers the current editor state. Native dirty-state changes also need rollback when the close is abandoned.
- Test consumers must not assign hook results to module globals during render. The editor-buffer test captures its hook result in an effect instead.

## Remaining evidence

Native compilation, application serialization tests, real OS-keychain failure scenarios and platform dialog behavior remain required. The local Rust 1.88 formatter runs. Offline Cargo dependency resolution stops at the missing `base64` crate. A bounded online `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` attempt also failed while retrieving the crates.io index configuration, with SSL connect error 35. The environment also lacks `pkg-config`. These are execution blockers, not native test passes.
