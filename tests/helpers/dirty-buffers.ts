import { clearDirtyBuffer, flushDirtyBuffers, listDirtyBuffers } from "@/lib/workspace/dirty-buffers";

/** Reset both session-owned recovery and durable fixtures between independent tests. */
export function resetDirtyBufferRecovery(): void {
    for (const buffer of listDirtyBuffers()) clearDirtyBuffer(buffer.path);
    if (!flushDirtyBuffers()) throw new Error("Recovery fixture cleanup could not persist pending removals");
    localStorage.clear();
}
