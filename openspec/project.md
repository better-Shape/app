# Project context

This file is the OpenSpec project context for BetterShape. It was checked against the tree at the port commit. When a path here disagrees with the tree, the tree wins, and the change that finds the mismatch corrects this file in the same commit.

## Purpose

**BetterShape** is a desktop agent workspace built on Tauri 2 with a Next.js renderer. Users work on local projects, run AI agents with tools (files, shell, git, browser, MCP servers), and watch the agent's work as it happens. The app is dark only, and it is local-first: projects, chats and secrets stay on the machine unless the user asks otherwise.

## Tech stack

| Layer | Tech (version from `package.json` and `src-tauri/Cargo.toml`) |
|-------|------|
| Desktop shell | Tauri 2.11.1 (`src-tauri/`), `tauri-build` 2.5.4 |
| Renderer | Next.js ^16.4.0 (dev uses webpack, `npm run dev:webpack`), React 19.2.3 |
| Styling | Tailwind CSS ^4, tokens in `app/globals.css` |
| Language | TypeScript ^6.0.3, Rust `rust-version` 1.88.0, edition 2021 |
| Lint | ESLint ^9 (`eslint.config.cjs`), `--max-warnings=0` in `lint:strict` |
| Tests | Vitest ^4.1.11 (`npm run test`), `cargo test` (`npm run test:rust`) |
| Package manager | npm, with `package-lock.json`. CI runs `npm ci`. `bun.lock` also exists in the tree |

## Project conventions

### Code style

- Files are kebab-case. Symbols carry the casing that suits them.
- Components are PascalCase exports in kebab-case files.
- Keep changes small and direct. Prefer the existing helper over a new abstraction.

### Architecture patterns

- **Shell boundary**: the renderer reaches the OS through Tauri commands and plugins only. Commands are registered in `src-tauri/src/lib.rs`, and capability scopes live in `src-tauri/capabilities/`.
- **Rust backend** (`src-tauri/src/`): `agent/` (runner, tools, security, prompts, models), `commands/` (filesystem, git, PTY, browser, GitHub auth, BYOK keys, preview, lint, testing), `mcp/` (client, OAuth, credentials), `core/` and `domain/`.
- **Renderer** (`app/`, `components/`, `features/`, `lib/`, `core/`): feature folders under `features/` hold UI, and `lib/` holds logic that is not tied to a component.
- **Secrets**: provider keys and MCP tokens are stored in the OS keyring through the `keyring` crate. They are never written to a settings file.
- **Agent**: the agent's tools and their path and command checks are in `src-tauri/src/agent/tools` and `src-tauri/src/agent/security`.

### Testing strategy

| Runner | Command | Covers |
|--------|---------|--------|
| Vitest | `npm run test` (builds the runtime first, then `vitest run`) | `tests/` and colocated TypeScript tests |
| cargo | `npm run test:rust` | Rust unit tests under `src-tauri` |
| Both | `npm run test:all` | `npm run test` followed by `npm run test:rust` |

`test:all` needs a Rust toolchain. A machine without cargo can run the TypeScript gates only, and the PR must say that the Rust gate did not run. A machine whose network blocks `crates.io` is a different case: the orphan branch `vendor/sandbox-toolchain` carries the toolchain, the crate registry and the Tauri sysroot, so the Rust gate does run offline. See `engineering/rust-toolchain.md` for the two flags it needs there.

### Git workflow

- Base branch: `draft/mega-absorb-all` for this port. The default branch is `main`.
- One branch per change. Pull requests for review. No direct pushes to shared branches.
- PR titles are linted by `pr.yml`.

## Domain context

- **Projects**: a local folder that the user opens.
- **Chats**: an agent conversation. A chat can have tools and a provider binding.
- **Workspace rules and skills**: `.bettershape/rules.md` and `.bettershape/rules/` hold per-project rules (`lib/workspace/rules.ts`). Skill folders are scanned from `.claude/skills`, `.agents/skills`, `.github/skills` and `.bettershape/skills` (`lib/chat/skill-roots.ts`).
- **Terminal, editor, git, preview**: each has a feature folder and Rust commands behind it.

## Important constraints

- Local-first. Data stays on the machine unless the user starts an outbound request.
- Secrets live in the OS keyring. Nothing secret goes into a log, a PR or `.dump`.
- The renderer must not gain new filesystem or shell reach without a capability and a Rust-side check.
- Dark only. See `DESIGN.md`.
- Vendored skills under `.agents/` are content, not code the app runs. The app does read `.agents/skills` as a project skill root, so changing a skill body changes what the agent sees.

## External dependencies

- **AI providers**: called from the Rust side (`src-tauri/src/commands/ai_byok.rs` and `src-tauri/src/agent`).
- **GitHub**: sign-in is implemented in `src-tauri/src/commands/github_auth`.
- **MCP servers**: stdio and HTTP clients under `src-tauri/src/mcp`.
- **Updater**: `src-tauri/tauri.conf.json` sets `bundle.createUpdaterArtifacts`, while `plugins.updater` is empty. Treat any endpoint change as a security review.
