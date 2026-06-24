<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg" />
    <img alt="Otto" src="docs/logo-light.svg" width="200" />
  </picture>
</p>

<p align="center">
  <strong>The first multimodal, multi-model AI coding agent for your terminal.</strong><br />
  Pair <strong>Claude + Codex</strong> on every turn, then carry the <em>same</em> session from your terminal to <strong>WhatsApp</strong> or <strong>Telegram</strong>. Local-first. Open source.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/otto-agent-cli"><img src="https://img.shields.io/npm/v/otto-agent-cli?color=cb3837&logo=npm" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6" alt="Bun" />
  <img src="https://img.shields.io/badge/lang-TypeScript-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/models-Claude%20%2B%20Codex-7c3aed" alt="Claude + Codex" />
  <img src="https://img.shields.io/badge/channels-WhatsApp%20%7C%20Telegram-25D366" alt="WhatsApp | Telegram" />
</p>

---

## TL;DR

**Otto is an open-source AI coding agent CLI that runs two frontier models at once** — Anthropic's **Claude** and OpenAI's **Codex (GPT)** — as a fused pair: one leads and writes code, the other reviews it read-only, in real time, on every turn. You can **swap which model leads**, and if one hits its rate limit Otto **fails over automatically** to the other so your session never stalls.

Unlike a terminal-only tool, an Otto session is **omnipresent**: start coding in your terminal and keep the exact same session going from **WhatsApp** or **Telegram** on your phone. It's **local-first** (runs entirely on your machine) and **multimodal** (it understands images, voice notes, video, and documents that arrive from your chats).

```bash
git clone https://github.com/moraisdev/otto-agent-cli.git
cd otto-agent-cli && bun install && bun run build && bun link
otto setup        # installs the local channel runtime (omni) + nats, creates your agent
otto              # launches the terminal UI — start coding
```

---

## Why Otto

Most AI coding tools give you **one model in one place**: a single provider, locked to your terminal, that stalls when it hits a rate limit and forgets you the moment you walk away from your desk.

Otto is built around three ideas that nothing else combines:

- **Two models are better than one.** Frontier models disagree, and that's the point. Otto runs Claude and Codex together so every substantive change gets a second senior opinion *before* it ships — not after.
- **A coding session shouldn't be trapped in a terminal.** Your session is a durable, living thing. Take it with you to WhatsApp or Telegram and keep the thread going from your phone.
- **It should all run on your machine.** No mandatory cloud, no proprietary backend. Local-first by default, MIT-licensed, yours to fork.

## Features

- 🔀 **Fusion — Claude + Codex on every turn.** One model is the *principal* (it leads and edits); the other is a live, read-only *reviewer* that reads the real `git diff`, runs tests/lint/build, and pushes back before code lands. Pick either model as the principal.
- ⚡ **Automatic provider failover.** When the leading model hits its CLI quota, Otto hands the wheel to the peer for the next turns and resumes the original automatically once the quota resets. Your work never blocks on one provider.
- 📱 **Omnipresent sessions.** Start in the terminal, then bind the session to a WhatsApp or Telegram chat and continue from your phone. Replies fan out to your channels, so a terminal-driven turn also reaches you on the go.
- 🖼️ **Multimodal in.** Images, voice notes (auto-transcribed), video, and documents that arrive from your chats become part of the conversation — not just text.
- 🧠 **Swappable models & runtimes.** Claude (Anthropic) and Codex (OpenAI GPT) via their official CLIs, switchable per agent from a model picker in the TUI.
- 🏠 **Local-first.** Embedded NATS JetStream + a local channel runtime + SQLite. Your code, sessions, and keys stay on your machine.
- 🤖 **Always-on automation.** Cron jobs, event triggers, and a proactive heartbeat let an agent keep working — checking tasks, reacting to events — even when you're not watching.
- 🔐 **Capability-scoped permissions (REBAC).** Fine-grained, closed-by-default access control for tools and shell executables, so the read-only reviewer truly can't edit.
- 🎛️ **A clean terminal UI.** A focused TUI with a quiet activity tree (see what each model did), live token/elapsed meters, slash commands, and message queuing.

## Install

**Requirements:** [Bun](https://bun.sh) ≥ 1.0, the **Claude** CLI and/or the **Codex** CLI authenticated on your machine (Otto drives them under the hood), and macOS or Linux.

Install the CLI globally — no clone needed:

```bash
bun add -g otto-agent-cli      # or: npm install -g otto-agent-cli
```

Then run the setup wizard. It installs the bundled channel runtime (the `omni` messaging server and `nats-server`) for you and creates your first agent:

```bash
otto setup
otto daemon start     # starts nats + omni + the Otto bot
otto daemon status
```

> Otto drives the official Claude and Codex CLIs locally. Make sure at least one is installed and authenticated — e.g. `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` for Claude, and `~/.codex` for Codex. Optional: `OPENAI_API_KEY` for voice-note transcription and `GEMINI_API_KEY` for video understanding.

<details>
<summary><strong>Install from source</strong> (for contributors)</summary>

```bash
git clone https://github.com/moraisdev/otto-agent-cli.git
cd otto-agent-cli
bun install
bun run build
bun link              # makes the `otto` command available globally
```

</details>

## Quick Start

**Code in the terminal UI:**

```bash
otto                  # full-screen TUI for your main session
otto --resume         # pick a past conversation to resume
otto code             # lightweight inline REPL, scoped to the current project
```

Just type what you want. Fusion is always on: Claude and Codex work the turn together, and the final answer renders inline while the activity tree shows what each model did. In the TUI status bar you can:

- click the **model** segment to choose the principal model,
- toggle **fusion** on/off (off = run just the principal solo),
- click **remoto** to connect a **WhatsApp** or **Telegram** channel.

**Take the session to your phone:**

```bash
otto setup            # connect a channel during setup, or:
# in the TUI: click "remoto" → pick WhatsApp (scan the QR) or Telegram
```

Once connected, message the agent from WhatsApp or Telegram and it continues the same session — with full context, the same working directory, and the same Claude + Codex pairing.

## How Fusion Works

Every eligible turn is a pairing of two senior engineers:

```text
your prompt
  ├─ principal (e.g. Claude)  →  implements, edits files, runs the work
  └─ peer      (e.g. Codex)   →  reads the real diff, runs tests/lint/build,
                                 reviews, and pushes back — read-only, never edits
  →  one final answer, with the peer's key insights folded in
```

- **Swap the principal.** Make either Claude or Codex the lead from the model picker. Whoever leads edits; the other becomes the read-only reviewer. Symmetric both ways.
- **Failover.** If the principal hits its provider quota, the peer takes over editing for the next turns and the principal rejoins automatically when its quota resets.
- **Solo when you want it.** Turn fusion off to run just the principal alone.

## Continue from your phone — terminal ↔ WhatsApp / Telegram

This is the part nothing else does: **your coding session isn't trapped in the terminal.**
The session lives in a local daemon — your terminal and your phone are just *windows* into the
**same live session**: same context, same working directory, same Claude + Codex pairing.

A typical flow:

```text
🖥️  terminal                          📱 WhatsApp / Telegram
────────────                          ─────────────────────
otto code  ──┐                        "did the tests pass? ship it"
  coding…    │   same live session     ──┐
             ├───────────────────────────┤   ← continues the SAME session:
  step away ─┘                          ──┘     full context, same repo,
                                                same Claude + Codex pair
```

1. You're coding in the terminal (`otto` or `otto code`) on a feature.
2. You need to step out — in the TUI, click **remoto → WhatsApp** (scan the QR) or **Telegram** to bind the session to a chat.
3. From your phone you message the agent in that chat ("did the tests pass? then commit") and it **continues the exact same session** — it remembers everything, edits the same repo, and keeps Claude + Codex paired.
4. Replies fan out back to the chat, so you stay in the loop from anywhere. Start at your desk, finish from your phone — or the other way around.

Under the hood:

- **Project-scoped** — `otto code` roots a session in your current directory, so the agent works in the right repo.
- **Group = session** — bind a WhatsApp/Telegram chat to a session; inbound messages land in that same session and working directory.
- **Fan-out** — a reply is mirrored to bound channels, so a terminal-driven turn also reaches your phone.

## Architecture

```text
otto daemon
  ├── nats-server (embedded JetStream event bus)
  ├── omni        (local channel runtime: WhatsApp / Telegram / Discord)
  └── otto agent
        ├── Fusion engine        (Claude + Codex pairing, failover)
        ├── Runtime providers    (Claude CLI, Codex CLI — swappable)
        ├── Sessions + routing   (durable, project-scoped, channel-bound)
        └── Runners              (cron, triggers, heartbeat)
```

Built on **Bun**, **TypeScript**, **SQLite**, and **NATS JetStream**.

## Otto vs. single-model coding CLIs

| | **Otto** | Typical single-model CLI |
|---|---|---|
| Models per turn | **Two (Claude + Codex), fused** | One |
| Built-in code review | **Yes — a second model reviews every turn** | No |
| Rate-limit failover | **Automatic, model-to-model** | Stalls |
| Continue on WhatsApp / Telegram | **Yes** | No |
| Multimodal input from chats | **Images, voice, video, docs** | Text |
| Runs locally / open source | **Yes / MIT** | Varies |

## FAQ

**What is Otto?**
Otto is an open-source, multimodal AI coding agent CLI that pairs two frontier models — Anthropic's Claude and OpenAI's Codex — on every turn, and lets you carry the same coding session from your terminal to WhatsApp or Telegram.

**What makes it different from Claude Code or the Codex CLI?**
Otto runs *both* of them at once as a fused pair (one leads, one reviews), fails over between them on rate limits, and is reachable from your phone over WhatsApp and Telegram — none of which a single-model, terminal-only CLI does.

**Can I use Claude and Codex (GPT) together?**
Yes. That's the core of Otto. You can also pick which model leads and turn the pairing off to run one model solo.

**How do I run an AI coding agent on WhatsApp or Telegram?**
Run `otto setup` (or click "remoto" in the TUI), connect WhatsApp (scan the QR) or Telegram, and message your agent — it continues the same session from your phone.

**Is it free and open source?**
Yes — MIT licensed and local-first. You bring your own model accounts (Claude and/or Codex CLIs).

**Which platforms are supported?**
macOS and Linux, on the Bun runtime.

## Contributing

Issues and pull requests are welcome. To work on Otto locally:

```bash
bun install
bun run dev        # watch mode
bun test           # run the test suite
make quality       # lint + typecheck
```

## License

[MIT](LICENSE) © Pedro Morais
