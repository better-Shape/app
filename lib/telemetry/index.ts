"use client";

/**
 * Local-only diagnostics.
 *
 * BetterShape no longer phones home: there is no telemetry endpoint, no device id and
 * no third-party crash reporter. These helpers stay as no-ops so call sites
 * keep their structure, and everything users need lives in the local logs.
 */

export function captureTelemetry(_event: string, _properties?: Record<string, unknown>): void {
  /* local-only build: nothing is sent anywhere */
}

export function captureTelemetryError(
  _error: unknown,
  _properties?: Record<string, unknown>,
): void {
  /* errors surface in the app's own console/log output */
}

export async function initTelemetry(): Promise<void> {
  /* no-op */
}

export async function applyTelemetryPreference(_enabled: boolean): Promise<void> {
  /* no-op — there is no server-side preference to sync */
}

export function identifyTelemetryUser(_id: string | null): void {
  /* no-op */
}
