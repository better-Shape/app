"use client";

/**
 * Keychain availability, probed once per mounted settings view.
 *
 * Returns:
 *  - `true`  → keys are being encrypted at rest in the OS keychain.
 *  - `false` → no keychain was detected (Linux without libsecret/KWallet, …).
 *              Keys fall back to the on-disk settings file; the UI warns about this.
 *  - `null`  → still probing.
 */
import React from "react";
import { areSecretsVaulted } from "@/lib/settings";
import { vaultAvailable } from "@/lib/ai/vault";

export function useVaultStatus(): boolean | null {
    const [available, setAvailable] = React.useState<boolean | null>(
        typeof window === "undefined" ? null : areSecretsVaulted() ? true : null,
    );
    React.useEffect(() => {
        if (available !== null) return;
        let cancelled = false;
        void vaultAvailable().then((supported) => {
            if (!cancelled) setAvailable(supported);
        });
        return () => {
            cancelled = true;
        };
    }, [available]);
    return available;
}
