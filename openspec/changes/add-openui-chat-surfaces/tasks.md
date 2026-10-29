## 1. OpenUI runtime and privacy
- [x] 1.1 Add the OpenUI React runtime and Zod dependencies with telemetry disabled during install.
- [x] 1.2 Disable OpenUI renderer observability and ensure contributor/CI installs set `DO_NOT_TRACK=1`.

## 2. Streaming integration
- [x] 2.1 Define a constrained BetterShape component library with no tool/action/query execution.
- [x] 2.2 Parse fenced OpenUI Lang blocks as assistant message chunks during streaming and after reload.
- [x] 2.3 Render OpenUI chunks with the curated library and BetterShape design tokens.
- [x] 2.4 Add Ask-mode prompting for data visualization and structured summaries only when useful.
- [x] 2.5 Add bounded, accessible callout/progress/table components and preserve visual text in copy actions.

## 3. Verification
- [x] 3.1 Cover streaming parsing, closed fences, mixed prose, and malformed inputs with tests.
- [x] 3.2 Run lint, typecheck, chat tests, and applicable Rust checks.
- [x] 3.3 Review for telemetry, accessibility, and untrusted model-output risks.
- [x] 3.4 Test nested/alternate fences, parser limits, render fallback, copy text, signed charts, and table bounds.
