# Preview readiness reconciliation

## Contract and failure

Readiness events are hints, not durable state. A renderer can attach after a native PTY has already announced its URL, or lose its announcement when unrelated early events fill the bounded buffer. Enlarging the buffer does not solve either case.

Native session metadata now retains the URL scraped from that session's output and a monotonic revision. Port probes never populate this authority. `pty_read_output` includes the retained URL only while the process is running. A failed process-status read returns an error rather than substituting cached `running = true`.

After `pty_spawn_run` returns, the renderer always reconciles the selected session against the native snapshot before activation. Its event buffers remain bounded. It rejects unavailable, malformed and wrong-session snapshots and honors exit events received during the read. Retained readiness allows a reused native session to reattach without emitting its banner again.

Events and snapshots can arrive in either order. Revisions select the newer output-owned URL. A later port-probe event cannot displace output-owned evidence. An older output event cannot regress an already active session. For older payloads without revisions, a newly received output event wins over an overlapping read; the new native producer supplies revisions on output events and snapshots.

## Native ordering

The PTY reader records readiness before emitting it. Marking a session for preview scraping also checks already buffered output, since a fast process can print before spawn returns. That fallback writes only an initial record and cannot replace a URL the reader has already recorded.

The retained record is mutex-protected. Its ordinal never exceeds JavaScript's largest exact integer. Exhaustion clears retained authority and suppresses publication rather than reusing or rounding an ordinal. The session ID still identifies the native process; this change does not redesign the existing ID allocator or terminal shutdown ownership.

## Verification and limits

Seven frontend regressions fail against the original background-run source. They cover more than 32 early readiness events, reattachment without an event, a newer event during a snapshot read, an exited retained process, probe/output priority, and both native event/snapshot revision orders. The existing overflow, cancellation, listener cleanup and project-boundary tests remain unchanged apart from making the native snapshot fixture return the requested session ID.

Two tests compile and run the actual dependency-free `preview_readiness.rs` implementation under Rust 1.88. Isolated Clippy with warnings denied also passes. They check retained URL/revision progression and the exact-JSON-number boundary.

Three additional tests in the full PTY module cover wire serialization and exited-session revocation, unrelated URL mentions, and unavailable child state. They have not executed because the full native dependency graph remains blocked by the missing cached `base64` crate. Rust formatting and isolated helper tests do not establish Tauri compilation, packaged WebView behavior or platform installer support.
