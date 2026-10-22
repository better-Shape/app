## Context

The assistant renderer already parses BetterShape's own block syntax, but arbitrary generated markup is not an acceptable rendering surface. The app also permits overlapping conversations; status and approval chrome must therefore be tied to the producing turn rather than whichever conversation is visible when an event arrives. The workspace can become narrower than its editor and explorer were originally designed for.

## Goals / Non-Goals

- Goals: progressively render useful visual answers with a small local component allowlist; preserve prose, copy behavior, accessibility, and responsive workspace navigation; prevent unrelated turns from changing each other's activity state; disable OpenUI telemetry.
- Non-goals: model-authored executable code, tool/query/action components, changing stored transcript formats, redesigning chat lifecycle, or claiming a manually reproduced multi-window race.

## Decisions

- Recognize only top-level Markdown fences labeled `openui-lang`; leave nested examples and unrecognized/excess fences in ordinary Markdown. The fence scanner shares the legacy message parser's structural-tag inventory and skips those opaque payloads, so hidden tool or data blocks cannot promote their embedded examples into visual components. Bound each source block, the number of blocks, child counts, and component nesting.
- Use OpenUI Lang's parser with eight local components validated by Zod. Components render text/data only; there are no registered actions or query providers. Clamp chart/progress values and cap table/chart output at the component boundary.
- Disable the package postinstall telemetry through npm's Node preload, set the runtime telemetry opt-out before importing the renderer, disable renderer observability, and prevent the package's development inspector from auto-mounting.
- Attach `turnId` and `conversationId` to transient status and approval events. Update the renderer and Rust in-flight activity only for the exact live conversation/turn pair; reject missing, stale, completed, and foreign identities.
- Use a named inline-size container query for the workspace. Hide only the side explorer when its editor container is constrained; keep the Files tab available as a full-pane route and keyboard operable.

## Alternatives considered

- Rendering generated HTML/JS or enabling arbitrary OpenUI actions was rejected because model output is untrusted and the feature only needs static presentation.
- Viewport media queries were rejected because the workspace is an independently resizable pane; its own inline size is the relevant constraint.
- Routing status to the visible turn or inferring a sole active turn was rejected because concurrent chats make those fallbacks ambiguous.
- Committing UI-capture artifacts was rejected; recordings and review evidence stay under the ignored `.qa-artifacts/` directory.

## Risks / Trade-offs

- The upstream package includes a development inspector dependency. The auto-mount guard and observability opt-out are verified against the installed package entry point; telemetry is also disabled during installation.
- The Rust event additions are additive, and old serialized approval records omit the optional identity fields. The renderer intentionally ignores such unscoped events rather than guessing an owner.
- Local tests and the inspected UI capture cover the intended interactions, but no new real multi-window runtime race reproduction is claimed.

## Migration Plan

No transcript or persisted-history migration is required. Existing assistant Markdown and BetterShape blocks retain their current parser. Optional event identity fields are additive; newly emitted status and approval events always include their owning identity where available.

## Open Questions

None for this change. Future components require a separate security, accessibility, and resource-bound review before entering the allowlist.
