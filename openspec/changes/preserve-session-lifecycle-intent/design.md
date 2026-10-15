# Design

Credential synchronization owns a hydration-complete flag. A failed probe or incomplete read leaves it false. Explicit retry re-probes and queues hydration before persistence; ordinary settings changes do not repeatedly hydrate inaccessible entries. Value, destination and removed-descriptor edits remain tracked until hydration completes.

Shelf intent moves from aggregate writes to one localStorage record per encoded chat id under `bettershape-sidebar-dispositions:v2:`. The old aggregate map remains a read-only migration seed. A null per-chat record suppresses a legacy value. Independent chat writes do not touch each other's records; writes to the same chat are last-writer-wins. Failed writes remain session-local. Old application versions do not participate in the new protocol.

The preview run owns all listener registrations before invoking spawn, bounded provisional event maps, and a generation fence. It selects events only for the returned PTY id, rejects early exit/overflow, and kills a late spawned process after Stop. Cleanup consumes async unlisten failures as well as synchronous throws.

DesignStudio keeps the native registration/probe serialized, but only deduplicates requests for the same current authorization. Replacement readiness waits for the previous attempt and revalidates before reconnecting. Reconnection clears stale selection/layer state and uses the existing reload/navigation path to replace the frame.

Opening history does not resume a dormant chat. The explicit Resume and shelf-drop actions remain the authority for that change. Main-close consent happens before peer closures, with a final generation/revision check and dirty rollback afterward. The peer timeout stays bounded and fail-closed; no atomic multi-window transaction is claimed.

Detailed evidence and native limitations are recorded in `.dump/app/audits/lifecycle-ownership.md`.
