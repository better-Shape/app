<p align="center">
  <a href="https://useshape.org">
    <img src="./public/hero.png" alt="Chat next to the open folder" width="880">
  </a>
</p>

<p align="center">
  <a href="https://github.com/Owie6789/Shape/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/Owie6789/Shape?style=flat-square"></a>
  <a href="https://github.com/Owie6789/Shape/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Owie6789/Shape/ci.yml?style=flat-square&branch=main&label=ci"></a>
</p>

<p align="center">
  <a href="https://useshape.org">Website</a> ·
  <a href="https://useshape.org/docs">Docs</a> ·
  <a href="https://useshape.org/download">Download</a> ·
  <a href="https://discord.gg/MMCEDVZKYf">Discord</a>
</p>

BetterShape is a Windows desktop agent. You open a folder you work in. Chat sits beside the files, Git, and a terminal. You describe the change. BetterShape reads the project, answers in the thread, and edits files when you ask. BetterShape shows a diff for each edit. You commit when you want a commit.

It runs on your own model keys. There is no account, no plan, and no server of ours in the path.

If you're using version 1.0.0, 1.0.1, or 1.0.2, we recommend manually updating to 1.0.3.

## Work from the composer

Pick a mode before you send.

- **Code** edits files and can run commands.
- **Ask** reads the project and leaves files alone.
- **Plan** writes the approach and waits.
- **Visual** works on UI. Pair it with the in-app browser to see the screen.
- **Review** looks for a bug and proposes a small fix.

Type `@` to attach a file or folder. Type `/` to run a saved prompt.

[Agent](https://useshape.org/docs/agent/overview)

## Models

Bring your own key. OpenAI, Anthropic, and Google are spoken natively, and any OpenAI-compatible endpoint (OpenRouter, xAI, DeepSeek, Groq, Mistral, LM Studio, Ollama) works through the same path. Add keys under Settings then Providers. Chat, embeddings, and search use your key and nothing else. `auto` follows the default model you pick.

![Claude, GPT, Gemini, Grok, DeepSeek, Qwen](./docs/images/readme/models.svg)

[Models](https://useshape.org/docs/get-started/models)

## Plugins

Connect GitHub, Figma, Linear, Slack, Notion, Stripe, Supabase, Vercel, and other accounts through your own Composio key. Add the key under Settings then Plugins, connect the accounts there, then ask in the thread: open a pull request, list Linear bugs, post a diff summary to Slack.

![GitHub, Figma, Linear, Slack, Notion, Stripe, Supabase, Vercel](./docs/images/readme/plugins.svg)

A plugin is a connected account. A tool that runs on your machine is [MCP](https://useshape.org/docs/customize/mcp).

[Plugins](https://useshape.org/docs/customize/plugins)

## Install

Windows 10 or 11, 64-bit. [Installer](https://useshape.org/download). Older builds: [Releases](https://github.com/useshape/Shape/releases).

Stable is the tested channel. On nightly you get the newest installer, and that installer can break.

## Build from source

Node.js 18+, Rust, and [Tauri 2](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri:dev
```

[CONTRIBUTING.md](./CONTRIBUTING.md) and [local development](https://useshape.org/docs/developing/local-development).

```bash
npm run test          # Vitest
npm run test:rust     # Cargo
npm run test:all      # Both
```

TypeScript, React, Next.js App Router, Tauri 2, Rust.

## License

[Business Source License 1.1](./LICENSE). Code you send is under the same license.

Copyright © 2026 BetterShape. Based on Shape (BUSL-1.1).
