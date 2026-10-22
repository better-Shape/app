# OpenSpec CLI telemetry opt-out

## Decision

Set `OPENSPEC_TELEMETRY=0` for every OpenSpec CLI invocation. Validation is local and must not emit usage telemetry.

## Evidence

- Checked package: `@fission-ai/openspec@1.14.3`.
- `openspec validate add-openui-chat-surfaces --strict --no-interactive` passed, but the CLI disclosed that it collects anonymous usage statistics and named `OPENSPEC_TELEMETRY=0` as the opt-out.
- That invocation did not set the opt-out. Whether telemetry was delivered is unknown; no telemetry contents are recorded here.

## Prevention

For future invocations, prefix the command with `OPENSPEC_TELEMETRY=0`. Do not infer from a successful validation that telemetry was disabled.
