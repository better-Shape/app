# OpenUI install telemetry guard

## Context

The OpenUI chat integration is required to disable telemetry. Runtime rendering already sets `OPENUI_TELEMETRY_DISABLED=1`, disables observability publishing, and prevents the development inspector from auto-mounting. Manual review of the transitive dependency found that `@openuidev/lang-core@1.0.1` also runs an install-time telemetry script.

## Evidence

- The installed `@openuidev/lang-core/README.md` documents install telemetry and the `OPENUI_TELEMETRY_DISABLED=1` opt-out.
- `node_modules/@openuidev/lang-core/dist/postinstall.cjs` calls its sender unless `isTelemetryDisabled(process.env)` is true, then catches send errors without exposing whether delivery succeeded.
- `node_modules/@openuidev/lang-core/dist/shared-BuVpfVsg.cjs` confirms that `OPENUI_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` disables telemetry.
- Before this guard was added, the install state file existed with `langCorePostinstallNoticeShown=true`. This proves the postinstall script ran, not whether its network request reached the service. Delivery status is unknown.

## Correction

Added the project `.npmrc` Node `--import` preload to set `OPENUI_TELEMETRY_DISABLED=1` for Node processes spawned by npm. Verified `npm config get node-options`, confirmed `npm exec` children observe the flag, and ran the package postinstall through `npm exec`; the existing telemetry-state file hash did not change. No install identifier or telemetry payload is recorded here.

Keep the OpenUI dependency pinned through the lockfile and re-check its lifecycle scripts when upgrading it. Do not infer that the earlier postinstall request was or was not delivered.
