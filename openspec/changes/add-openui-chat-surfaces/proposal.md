# Change: Add streaming generative UI to chat

## Why

BetterShape already parses agent-specific XML blocks, but it has no constrained language for model-generated, composable UI. OpenUI Lang provides a streaming parser and a typed component-library contract that can add read-only visual answers without replacing BetterShape's agent lifecycle.

## What Changes

- Add OpenUI Lang rendering for fenced `openui-lang` responses in assistant messages.
- Register a bounded, local-first component library for summaries, metrics, signed bar charts, progress, callouts, and tables using BetterShape design tokens; it exposes no arbitrary code execution, network queries, or actions.
- Preserve readable text when users copy a message containing visual output, and give a non-technical fallback when a program cannot render.
- Add Ask-mode instructions for using visual output only when it helps answer the user's request.
- Disable OpenUI telemetry, including the package install hook and renderer observability.

## Impact

- Affected capabilities: chat streaming and assistant message rendering.
- Affected code: `features/chat/ui/md/renderer.tsx`, new OpenUI UI components, `src-tauri/src/agent/commands/send_chat.rs`, prompts, npm dependencies, install workflows, and tests.
- OpenUI-generated output is additive. Existing markdown, BetterShape blocks, tools, and non-Ask modes keep their current behavior.
