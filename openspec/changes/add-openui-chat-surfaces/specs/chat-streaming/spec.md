## ADDED Requirements
### Requirement: Render constrained generative UI in assistant messages
The system SHALL render fenced OpenUI Lang programs in assistant messages progressively using only the application's registered component library. The renderer SHALL treat model output as untrusted data and SHALL NOT evaluate arbitrary JavaScript, run model-selected tools, make network queries, or execute actions from the generated program.

#### Scenario: Assistant streams a visual answer
- **WHEN** an assistant message streams a fenced `openui-lang` program
- **THEN** the chat renders the recognized components progressively and preserves surrounding assistant prose

#### Scenario: Invalid or incomplete generated program
- **WHEN** a streamed program is incomplete or contains an unknown component
- **THEN** the chat keeps surrounding prose available, shows a generic render fallback for invalid output, and does not execute unknown content

#### Scenario: Oversized, repeated, or deeply nested visual output
- **WHEN** a message contains an oversized program, more visual blocks than the renderer budget allows, or pathological component nesting
- **THEN** rendering stays bounded, excess source remains visible as code, deeply nested content receives a readable fallback, and the chat remains responsive

#### Scenario: Copy a visual answer
- **WHEN** the user copies an assistant message containing rendered OpenUI output without selecting a range
- **THEN** the clipboard contains the rendered visual text rather than OpenUI source syntax

#### Scenario: Existing assistant content
- **WHEN** an assistant message contains ordinary markdown or BetterShape's existing block syntax
- **THEN** it continues to render through the existing renderer without requiring OpenUI

### Requirement: OpenUI telemetry is disabled
The system SHALL disable OpenUI package-install telemetry and renderer observability in BetterShape builds.

#### Scenario: Dependency installation
- **WHEN** dependencies are installed by contributors or CI using documented repository commands
- **THEN** OpenUI's postinstall telemetry is disabled

#### Scenario: Runtime rendering
- **WHEN** OpenUI Lang renders a message
- **THEN** it does not publish renderer observability events or send telemetry
