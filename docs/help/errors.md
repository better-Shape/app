---
title: Error codes
description: What each BetterShape error code means and how to fix it.
order: 5
---

BetterShape shows a short error with a numeric code. Search this page for the code.

Codes `1xxx` and `3xxx` (account, billing, build trust) no longer exist: this
build has no BetterShape account, no credits, and no hosted service.

## 2000 — AI request failed

Your provider returned an error. Check the model id you picked, your provider
account limits, and your key in **Settings → Providers**.

## 2001 — Could not reach the model provider

The request never reached the provider. Check your connection, any local proxy,
and the base URL on the provider card.

## 2100 — Provider rate limit reached

The provider is throttling your key (HTTP 429). Wait a moment, lower the
concurrency of subagents, or switch to another model.

## 2200 — No API key for this provider

Add a key for that provider in **Settings → Providers**, or choose a model from
a provider you already configured.

## 4000 — Workspace is not available

BetterShape could not read or write the project folder. Check the path and your file
permissions, then reopen the project.

## 4100 — Git command failed

The git operation did not finish. Read the output in the Git panel; a dirty tree
or a missing upstream is the usual cause.

## 4200 — Language server problem

A language server crashed or could not start. Restart it from the status bar;
diagnostics may be incomplete until then.

## 4300 — Codebase search failed

BetterShape could not search the project index. Re-index the project from
**Settings → Agents → Context**.

## 4400 — Terminal error

The terminal session reported an error. Restart the session if it stops
responding.

## 4500 — Update check failed

This build has no update feed. Download the newest installer from
[Releases](https://github.com/Owie6789/BetterShape/releases) and run it.

## 4600 — Semantic index unavailable

Embeddings need an OpenAI-compatible key (OpenAI, OpenRouter, or a custom base
URL) in **Settings → Providers**. Keyword search keeps working without one.

## 4700 — Plugin request failed

Composio rejected the request. Check your Composio API key and the connected
accounts in **Settings → Plugins**.

## 9000 — Something went wrong

An unexpected error. Try the action again, then check the app logs.
