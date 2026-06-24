# Otto Bot

The daemon that gives Claude a life. Multi-channel messaging (WhatsApp, Telegram, Discord) via omni-v2, running entirely locally with embedded NATS JetStream and omni API server as child processes.

## Architecture

```
otto daemon start
  ├── nats-server :4222 (JetStream)
  ├── omni API    :8882 (child process bun)
  │     ├── WhatsApp (Baileys)
  │     ├── Telegram
  │     └── Discord
  └── otto bot
        ├── OmniConsumer  → JetStream pull consumer (message.received.>)
        ├── Claude Agent SDK (sessions, tools)
        ├── OmniSender    → HTTP POST /api/v2/messages/send
        └── Runners (cron, heartbeat, triggers)
```

**Infrastructure:** nats-server (JetStream enabled) and omni API server start automatically as child processes. The omni API key is bootstrapped on first run and stored in `~/.otto/omni-api-key`. Configure omni in `~/.otto/.env` via `OMNI_DIR`, `DATABASE_URL`, `OMNI_API_PORT`.

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Run setup wizard (downloads nats-server, configures auth, creates agent)
otto setup

# 3. Configure omni in ~/.otto/.env:
# OMNI_DIR=/path/to/omni-v2
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/omni

# 4. Start daemon (nats-server + omni + bot + gateway)
otto daemon start

# 5. Connect WhatsApp
otto whatsapp connect

# 6. Check status
otto daemon status
otto daemon logs
```

## Topics

For full topic reference with payloads, see the **events** skill (`src/plugins/internal/otto-system/skills/events/SKILL.md`).

**omni NATS subjects (JetStream stream: MESSAGE):**
- `message.received.{channelType}.{instanceId}` — inbound message
- `reaction.received.{channelType}.{instanceId}` — inbound reaction
- `instance.connected.{channelType}.{instanceId}` — account connected
- `instance.qr_code.{channelType}.{instanceId}` — QR code for pairing

## Session Keys

```
agent:main:main                       # Shared session (all DMs + CLI)
agent:main:dm:5511999999999           # Per-peer DM session
agent:jarvis:main                     # Different agent
agent:main:whatsapp:group:123456      # WhatsApp group session
agent:main:trigger:a1b2c3d4           # Event trigger session (isolated)
agent:main:cron:abc123                # Cron job session (isolated)
```

## Message Queue

When a new message arrives while a session is active:

- **Tool running**: Message queued, waits for tool to finish, then interrupts
- **No tool**: Interrupts immediately

Multiple messages from different users can queue up. After interrupt, all queued messages are processed in order.

## Debounce

Group messages arriving within a time window:

```bash
otto agents debounce main 2000   # 2 second window
otto agents debounce main 0      # Disable
```

Messages within the window are combined with `\n\n` before processing.

## Fusion (always-on Claude + Codex pair)

**Every** eligible turn is a pairing of two senior devs — always on, no opt-in.
**Claude is the sole editor** (writes all code); **Codex is the always-on read-only peer**
that reads the same tree, runs non-destructive analysis (tests/lint/build/grep/git-read),
reviews each of Claude's turns, and consults — it never edits. Source: `src/fusion/`
(self-contained: companion, REBAC profile, playbooks, limit detection, failover).

It fires automatically from every interactive entry point — WhatsApp/omni
(`src/omni/consumer.ts`), `otto code` REPL (`src/repl/client.ts`), and the TUI
(`src/tui/hooks/useNats.ts`). It is skipped for the companion's own session, observer
(`obs:*`) sessions, isolated automation (`:cron:` / `:trigger:`) sessions, and non-Claude-led
agents (see `src/fusion/policy.ts`).

What happens each normal turn (all on Otto primitives — agents, REBAC, sessions, observers):
1. A read-only Codex companion (`codex-companion-<leadId>`, `provider: codex`, same cwd) is
   ensured and granted a read-only tool set; warmed once with a consultant brief.
2. An Observation-Plane rule (`fusion-obs-<leadId>`, `report`/`debounce`) is registered so
   Codex reviews Claude's completed turns and can proactively `otto sessions inform`.
3. The lead turn is prefixed with the fusion playbook; Claude implements and may consult the
   companion synchronously: `otto sessions send agent:codex-companion-<leadId>:main "..." -w`.

### Failover (provider quota)

When a CLI hits its rate/usage limit, `turn.failed` is classified in `host-event-loop.ts`
and recorded per-agent in the `fusion_state` table (`src/fusion/state.ts`), with a TTL
(Retry-After hint or 15 min default). A successful turn clears the flag.

- **Claude exhausted →** the session runs under **Codex** as the sole editor for the next
  turns (the prompt carries `_runtimeProviderId: "codex"` + `_fusion`, honored by
  `src/runtime/session-resolver.ts`). Codex finishes the work; Claude resumes when its quota
  resets. No companion/observer (Claude is idle).
- **Codex exhausted →** Claude works **solo** (the reviewer is paused) until Codex returns.

**Read-only status (normal mode):** the companion's REBAC profile grants read/analysis tools
(no Write/Edit) and the brief reinforces "never edit". The *hard* non-edit guarantee — running
the companion's Codex with `sandbox: read-only` instead of the default `danger-full-access`
(`src/runtime/codex-provider.ts`) — is still the remaining hardening step; until then non-edit
relies on REBAC + the brief. (During Claude-exhausted failover, Codex edits deliberately as the
lead agent.) Design: `docs/superpowers/specs/2026-06-23-fusion-dual-engine-design.md`.

## `otto code` — clean REPL coding client (omnipresent sessions)

A clean inline REPL (readline + ANSI, Claude-Code-style — NOT the opentui TUI),
the terminal window into an omnipresent coding session. Thin client: execution
stays in the daemon (claude/codex CLIs).

```bash
otto code                 # project-scoped session for the current dir (proj-<name>-<hash>)
otto code <session>       # attach to a specific session
# inside: type a request (fusion is always on: Claude edits, Codex reviews); /exit to quit
```

How the omnipresent session works (the daemon owns it; terminal + WhatsApp are windows):

- **Project-scoped:** `otto code` roots a session in the current dir (carries `_projectCwd`);
  the provider CLI runs there, not the agent's fixed cwd. Source: `src/repl/`,
  `src/router/project-session.ts`, `src/runtime/session-resolver.ts`.
- **Universal fusion:** always-on Claude+Codex pairing works from the terminal exactly as on
  WhatsApp (shared `ensureFusionForTurn`, `src/fusion/activate.ts`).
- **Group = session:** the agent can take a session "to WhatsApp" by creating a group and
  running `otto whatsapp.group bind-session <groupId> <session>` — inbound group messages then
  land in the same session/cwd (route `session` redirect).
- **Fan-out:** a reply is mirrored to bound WhatsApp groups, so a terminal-driven turn also
  reaches your phone (`gateway.ts` fanoutToSessionGroups). Best-effort; never affects primary
  delivery.

Full blueprint: `docs/superpowers/specs/2026-06-19-otto-universal-agent-architecture.md`.

## Heartbeat

Proactive agent runs that check pending tasks in `HEARTBEAT.md`:

```bash
# Enable heartbeat (runs every 30 minutes)
otto heartbeat enable main 30m

# Disable
otto heartbeat disable main

# Configure
otto heartbeat set main interval 1h           # Change interval
otto heartbeat set main model haiku           # Use cheaper model
otto heartbeat set main active-hours 09:00-22:00  # Only run during these hours

# Manual trigger
otto heartbeat trigger main

# Status
otto heartbeat status   # All agents
otto heartbeat show main
```

**How it works:**
1. Timer fires at configured interval
2. Reads `~/otto/{agent}/HEARTBEAT.md`
3. Sends prompt to agent session
4. If agent responds with only `HEARTBEAT_OK`, message is suppressed
5. Otherwise, response is routed to the channel

**HEARTBEAT.md example:**
```markdown
# Tarefas Pendentes

- Lembre o Pedro sobre a reunião às 15h
- Verifique o status do deploy
```

**Triggers:**
- `interval` - Timer-based (configurable)
- `tool-complete` - After agent finishes using a tool (with 30s cooldown)
- `manual` - Via `otto heartbeat trigger`

## Cron Jobs

Scheduled jobs that send prompts to agents at specified times:

```bash
# List all jobs
otto cron list

# Add job with cron expression (runs daily at 9am)
otto cron add "Daily Report" --cron "0 9 * * *" --message "Generate daily summary"

# Add job with interval (runs every 30 minutes)
otto cron add "Check emails" --every 30m --message "Check for new emails"

# Add one-shot job (runs once at specific time)
otto cron add "Reminder" --at "2025-02-01T15:00" --message "Meeting in 10 min"

# Show job details
otto cron show <id>

# Enable/disable
otto cron enable <id>
otto cron disable <id>

# Edit job properties
otto cron set <id> name "New Name"
otto cron set <id> message "New message"
otto cron set <id> cron "0 10 * * *"
otto cron set <id> every 1h
otto cron set <id> tz America/Sao_Paulo
otto cron set <id> agent jarvis
otto cron set <id> session isolated
otto cron set <id> delete-after true

# Manual run (ignores schedule)
otto cron run <id>

# Delete
otto cron rm <id>
```

**Schedule Types:**
- `--cron "0 9 * * *"` - Standard cron expression (with optional `--tz` for timezone)
- `--every 30m` - Interval (supports: `30s`, `5m`, `1h`, `2d`)
- `--at "2025-02-01T15:00"` - One-shot at specific ISO datetime

**Options:**
- `--message <text>` - Prompt to send (required)
- `--agent <id>` - Target agent (default: default agent)
- `--isolated` - Run in isolated session instead of main
- `--delete-after` - Delete job after first successful run
- `--description <text>` - Job description
- `--tz <timezone>` - Timezone for cron expressions (default: from settings)

**Session Targets:**
- `main` - Shared session (default)
- `isolated` - Dedicated session per job (`agent:{agentId}:cron:{jobId}`)

**How it works:**
1. Daemon arms a timer for the next due job
2. When timer fires, job's message is emitted to the agent session
3. For isolated sessions, agent can use `cross_send` to deliver responses
4. Next run time is calculated (with anti-drift for intervals)
5. One-shot jobs (`--at`) are deleted after execution

## Event Triggers

Event-driven triggers that subscribe to any NATS topic and fire agent prompts when events occur:

```bash
# List all triggers
otto triggers list

# Add trigger: notify when contacts change
otto triggers add "Contato alterado" \
  --topic "otto.*.cli.contacts.*" \
  --message "Um contato foi alterado. Notifica o grupo do Slack e atualiza o CRM." \
  --agent main \
  --cooldown 30s

# Add trigger: alert on agent tool errors
otto triggers add "Agent Error Alert" \
  --topic "otto.*.tool" \
  --message "Um tool deu erro. Analise o que aconteceu e me avise se precisa de ação." \
  --agent main \
  --cooldown 1m

# Add trigger: log all contact changes
otto triggers add "Contact Audit" \
  --topic "otto.*.cli.contacts.*" \
  --message "Um contato foi modificado. Registre a mudança no log de auditoria." \
  --agent main \
  --session isolated

# Show trigger details
otto triggers show <id>

# Enable/disable
otto triggers enable <id>
otto triggers disable <id>

# Update properties
otto triggers set <id> name "New Name"
otto triggers set <id> message "Nova instrução"
otto triggers set <id> topic "otto.*.cli.contacts.*"
otto triggers set <id> agent jarvis
otto triggers set <id> session main          # main or isolated
otto triggers set <id> cooldown 30s          # supports: 5s, 30s, 1m, 5m, 1h

# Test trigger (fires with fake event data)
otto triggers test <id>

# Delete
otto triggers rm <id>
```

**Available Topics:**
- `otto.*.cli.{group}.{command}` - CLI tool executions (e.g., `otto.*.cli.contacts.add`)
- `otto.*.tool` - SDK tool executions (Bash, Read, etc.)
- `message.received.{channelType}.{instanceId}` - Inbound channel messages (from omni)

**Blocked Topics (anti-loop):**
- `otto.*.prompt` - Would create trigger→prompt→trigger loops
- `otto.*.response` - Would create trigger→response self-fire loops
- `otto.*.claude` - Internal SDK events, same risk

**Options:**
- `--topic <pattern>` - NATS topic pattern to subscribe to (required)
- `--message <text>` - Prompt to send when event fires (required)
- `--agent <id>` - Target agent (default: default agent)
- `--cooldown <duration>` - Minimum time between fires (default: 5s)
- `--session <type>` - `main` or `isolated` (default: isolated)

**Prompt Format (injected into agent):**
```
[Trigger: Contato alterado]
Topic: otto.agent:main:main.cli.contacts.add
Data: {
  "event": "end",
  "tool": "contacts_add",
  "output": "✓ Contact added: abc123"
}

Um contato foi alterado. Notifica o grupo do Slack e atualiza o CRM.
```

**Session Keys:**
- `isolated` (default): `agent:{agentId}:trigger:{triggerId}`
- `main`: `agent:{agentId}:main`

**Anti-Loop Protection:**
1. Blocked topics: `.prompt`, `.response`, `.claude` topics are rejected at subscription time
2. Session filter: events from trigger sessions (`:trigger:` in topic) are skipped
3. Data flag: events with `_trigger: true` are skipped
4. Cooldown: per-trigger cooldown (default 5s) prevents rapid re-firing

**How it works:**
1. Daemon starts TriggerRunner, which subscribes to all enabled trigger topics
2. When an event fires on a matching topic, runner builds a prompt with event data
3. Prompt is emitted to `otto.{sessionKey}.prompt`
4. Agent processes normally (can use `cross_send`, CLI tools, etc.)
5. CLI mutations emit `otto.triggers.refresh` to hot-reload subscriptions

All CLI commands are available as tools (`triggers_list`, `triggers_add`, etc.), so agents can self-configure triggers via conversation.

## Router (`~/.otto/otto.db`)

Configuration is stored in SQLite and managed via CLI:

```bash
# Agents
otto agents list
otto agents set main dmScope main
otto agents debounce main 2000

# Routes
otto routes list
otto routes add "+5511*" main

# Settings
otto settings set defaultAgent main
otto settings set defaultDmScope per-peer
otto settings set defaultTimezone America/Sao_Paulo
```

**Agent Config:**
- `cwd` - Working directory (`AGENTS.md`, tools, optional `CLAUDE.md` compatibility bridge)
- `model` - Model override (default: sonnet)
- `mode` - Operating mode: `active` (responds) or `sentinel` (observes silently)
- `dmScope` - Session grouping for DMs
- `debounceMs` - Message grouping window
- `contactScope` - Contact visibility: `own`, `tagged:<tag>`, `all`

**DM Scopes:**
- `main` - All DMs share one session
- `per-peer` - Isolated by contact
- `per-channel-peer` - Isolated by channel+contact
- `per-account-channel-peer` - Full isolation

**REBAC Permissions:**

Fine-grained relation-based access control for agents:

```bash
otto permissions grant agent:dev use tool:Bash
otto permissions grant agent:dev execute executable:git
otto permissions grant agent:dev execute group:contacts
otto permissions grant agent:dev access session:dev-*
otto permissions revoke agent:dev use tool:Bash
otto permissions check agent:dev execute group:contacts
otto permissions list --subject agent:dev
otto permissions init agent:dev full-access      # Template: all tools + executables
otto permissions init agent:dev sdk-tools        # Template: SDK tools only
otto permissions init agent:dev safe-executables # Template: safe CLIs only
otto permissions sync                            # Re-sync from config
otto permissions clear                           # Clear manual relations
```

**Relations:** `admin`, `use` (tools), `execute` (executables/CLI groups), `access`/`modify` (sessions), `write_contacts`, `read_own_contacts`, `read_tagged_contacts`, `read_contact`

**Entity types:** `agent`, `system`, `group`, `session`, `contact`, `tool`, `executable`, `cron`, `trigger`, `team`

**Enforcement:** New agents are closed-by-default (no permissions). Denied actions emit audit events to `otto.audit.denied`.

**Global Settings:**
- `defaultAgent` - Default agent when no route matches
- `defaultDmScope` - Default DM scope for new agents
- `defaultTimezone` - Default timezone for cron jobs (e.g., `America/Sao_Paulo`)
- `whatsapp.groupPolicy` - Group policy: `open`, `allowlist`, `closed`
- `whatsapp.dmPolicy` - DM policy: `open`, `pairing`, `closed`

**Agent Resolution:**

Messages are routed to agents in this priority order:
1. Account-agent mapping (from `account.<id>.agent` setting)
2. Route match (from routes table, scoped to account)
3. Default agent (only for default account)

The account-agent mapping is set via `otto whatsapp connect --agent <id>` or `otto whatsapp set --account <id> --agent <id>`.

**Multi-Account:**

Connect multiple accounts (WhatsApp, Telegram), each mapped to a different agent:

```bash
otto whatsapp connect --account vendas --agent vendas --mode active
otto whatsapp connect --account suporte --agent suporte --mode sentinel
```

**Sentinel Mode:** Agents in sentinel mode observe messages silently without auto-replying. Useful for monitoring accounts where an agent only acts when instructed.

**Contact Fields:**
- `phone` - Normalized phone number (primary key)
- `name` - Contact name
- `email` - Email address
- `status` - allowed, pending, blocked, discovered
- `agent_id` - Assigned agent
- `reply_mode` - auto (default) or mention
- `tags` - JSON array of tags (e.g., `["lead", "vip"]`)
- `notes` - JSON object for custom data (e.g., `{"company": "Acme"}`)
- `opt_out` - Whether contact opted out
- `interaction_count` - Total interactions
- `last_inbound_at` - Last message received
- `last_outbound_at` - Last message sent

## Storage

```
~/otto/
└── main/            # Agent CWD
    ├── AGENTS.md    # Canonical agent instructions
    ├── CLAUDE.md    # Claude compatibility bridge (when needed)
    ├── HEARTBEAT.md # Pending tasks for heartbeat (optional)
    └── SPEC_INSTRUCTIONS.md  # Custom spec mode instructions (optional)

~/.otto/
├── otto.db          # Config and sessions (SQLite)
├── .env             # Environment variables (loaded by daemon)
├── omni-api-key     # Auto-generated omni API key
├── jetstream/       # NATS JetStream storage
├── bin/
│   └── nats-server  # nats-server binary (auto-downloaded)
└── logs/
    └── daemon.log   # Daemon logs
```

## CLI

### CLI Runtime Hierarchy

The CLI is only trustworthy when it is targeting the same runtime and database as the live daemon.

- **Authority order:** live daemon/runtime > repo wrapper (`bin/otto`) > stale/global PATH wrappers
- **Canonical wrapper:** prefer `./bin/otto` from this repo when mutating `agents`, `instances`, `routes`, or `sessions`
- **Mutations must make target explicit:**
  - which CLI bundle is running
  - which SQLite DB is being changed
  - which instance is being targeted
  - whether that instance affects the live `main`
- **Live routing beats apparent success:** if a route mutation succeeds but the live resolver still picks a different winner, the operation is not done
- **Fail closed on runtime split:** when the CLI bundle differs from the daemon bundle, mutating commands should refuse by default unless the caller explicitly overrides the mismatch

Recommended inspection flow before/after route mutations:

```bash
./bin/otto instances target main --pattern group:120363426276457547
./bin/otto instances routes add main group:120363426276457547 energia-video-dev
./bin/otto instances target main --pattern group:120363426276457547
```

This keeps three truths aligned:

1. the runtime/db you mutated
2. the instance you think you changed
3. the live routing winner the daemon will actually use

```bash
# Setup
otto setup             # Interactive setup wizard

# Daemon (recommended)
otto daemon start      # Start nats + omni + bot + gateway
otto daemon stop       # Stop daemon
otto daemon restart    # Restart daemon
otto daemon status     # Show status
otto daemon logs       # Show last 50 lines
otto daemon logs -f    # Follow mode (tail -f)
otto daemon logs -t 100  # Show last 100 lines
otto daemon logs --clear # Clear log file
otto daemon env        # Edit ~/.otto/.env

# WhatsApp
otto whatsapp connect                # Connect account (QR code)
otto whatsapp connect --account <id> --agent <id> --mode sentinel
otto whatsapp status                 # Show connection status
otto whatsapp set --account <id> --agent <id>
otto whatsapp disconnect             # Disconnect account

# Agents
otto agents list                    # List agents
otto agents show <id>               # Show agent details
otto agents create <id> <cwd>       # Create agent
otto agents set <id> <key> <value>  # Set property
otto agents debounce <id> <ms>      # Set debounce
otto agents run <id> "prompt"       # Send prompt and stream response
otto agents chat <id>               # Interactive chat mode (/reset, /session, /exit)
otto agents session <id>            # Check session status
otto agents reset <id>              # Reset main session
otto agents reset <id> <sessionKey> # Reset specific session
otto agents reset <id> all          # Reset ALL sessions for agent

# Contacts
otto contacts list                   # List contacts
otto contacts add <phone> [name]     # Add/allow a contact
otto contacts pending                # Pending approvals
otto contacts check <phone>          # Show contact details
otto contacts tag <phone> <tag>      # Add tag
otto contacts untag <phone> <tag>    # Remove tag
otto contacts find <query>           # Search by name/phone
otto contacts find <tag> --tag       # Find by tag
otto contacts set <phone> email <email>
otto contacts set <phone> tags '["lead","vip"]'
otto contacts set <phone> notes '{"company":"Acme"}'
otto contacts set <phone> opt-out true

# Cross-session messaging
otto sessions send <session> "prompt"   # Send context/prompt to session (fire-and-forget)
otto sessions send <session> "prompt" -w # Wait and stream response
otto sessions send <session> -i         # Interactive mode
otto sessions execute <session> "task"  # Execute task
otto sessions ask <session> "question"  # Ask another session
otto sessions answer <session> "reply"  # Reply to a previous ask
otto sessions inform <session> "info"   # Send context info

# Tasks
otto tasks create "Title" --instructions "..."  # Create tracked work
otto tasks dispatch <task-id> --agent <id>      # Dispatch to an agent/session
otto tasks watch [task-id]                      # Watch live task events
otto tasks report <task-id>                     # Read progress + progress_note from TASK.md
otto tasks report <task-id> --progress 30 --message "..."  # Report concrete progress
otto tasks done <task-id> --summary "..."      # Mark task done
otto tasks block <task-id> --reason "..."      # Mark task blocked
otto tasks fail <task-id> --reason "..."       # Mark task failed

# Eval
otto eval run <spec.json>        # Run reproducible eval
otto eval run <spec.json> --json # Emit machine-readable result

# Heartbeat
otto heartbeat status                # Show all agents
otto heartbeat show <id>             # Show config
otto heartbeat enable <id> [interval]  # Enable (e.g., 30m, 1h)
otto heartbeat disable <id>          # Disable
otto heartbeat set <id> <key> <value>  # Set property
otto heartbeat trigger <id>          # Manual trigger

# Cron jobs
otto cron list                       # List all jobs
otto cron show <id>                  # Show job details
otto cron add <name> [options]       # Add new job
otto cron enable <id>                # Enable job
otto cron disable <id>               # Disable job
otto cron set <id> <key> <value>     # Set property
otto cron run <id>                   # Manual trigger
otto cron rm <id>                    # Delete job

# Event triggers
otto triggers list                   # List all triggers
otto triggers add <name> [options]   # Add new trigger
otto triggers show <id>              # Show trigger details
otto triggers enable <id>            # Enable trigger
otto triggers disable <id>           # Disable trigger
otto triggers set <id> <key> <value> # Set property
otto triggers test <id>              # Test with fake event
otto triggers rm <id>                # Delete trigger

# Permissions (REBAC)
otto permissions grant <subject> <relation> <object>
otto permissions revoke <subject> <relation> <object>
otto permissions check <subject> <permission> <object>
otto permissions list                # List all relations
otto permissions init <subject> <template>  # Apply template
otto permissions sync                # Re-sync from config
otto permissions clear               # Clear manual relations

# Reactions
otto react send <messageId> <emoji>  # Send emoji reaction
```

## Testing Agents

Use the CLI to interact with agents directly (daemon must be running):

```bash
# Send a single prompt
otto agents run main "lista os agentes"
otto agents run main "oi, tudo bem?"

# Interactive chat mode
otto agents chat main
# Commands: /reset, /session, /exit

# Check session status
otto agents session main

# Reset session (clear context)
otto agents reset main                    # Reset main session
otto agents reset main <sessionKey>       # Reset specific session
otto agents reset main all                # Reset ALL sessions for agent
```

### CLI Tools

Agents can use CLI commands as tools via Bash. Tool naming convention:

```
agents_list      # otto agents list
agents_show      # otto agents show <id>
contacts_list    # otto contacts list
```

Tool and executable access is controlled via REBAC permissions:

```bash
otto permissions grant agent:main use tool:Bash          # Allow SDK tool
otto permissions grant agent:main execute executable:git  # Allow CLI executable
otto permissions grant agent:main execute group:contacts  # Allow CLI command group
otto permissions init agent:main full-access              # All tools + executables
```

## Emoji Reactions

Agents can send emoji reactions to messages. Message envelopes include `[mid:ID]` tags:

```
[+5511999 mid:ABC123XYZ 30/01/2026, 14:30] João: Bom dia!
```

From CLI or agent tools:

```bash
otto react send ABC123XYZ 👍
```

## Message Formatting

### Reply Context

When a message replies to another, the quoted message is included:

```
[Replying to João id:ABC123]
Texto da mensagem original
[/Replying]

[Grupo id:123@g.us 30/01/2026, 14:30] Maria: Minha resposta
```

### Audio Transcription

Voice messages and audio files are automatically transcribed using OpenAI Whisper:

```
[+5511999 30/01/2026, 14:30]
[Audio]
Transcript:
O texto transcrito do áudio aparece aqui
```

Requires `OPENAI_API_KEY` in environment.

### Media Downloads

Images, videos, documents, and stickers are downloaded to `/tmp/otto-media/` and the local path is included in the prompt:

```
[+5511999 30/01/2026, 14:30]
[Image: /tmp/otto-media/1706619000000-ABC123.jpg]
```

- Max file size: 20MB (larger files are skipped with a note)
- Supported types: images, videos, PDFs, documents, stickers
- Files are named: `{timestamp}-{messageId}.{ext}`

## Environment (~/.otto/.env)

```bash
# Required (one of these)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# Omni (required for channel support)
OMNI_DIR=/path/to/omni-v2
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/omni
OMNI_API_PORT=8882          # Default

# Optional
OPENAI_API_KEY=sk-xxx       # For audio transcription
GEMINI_API_KEY=AIza...      # For video analysis
OTTO_MODEL=sonnet
OTTO_LOG_LEVEL=info         # debug | info | warn | error
NATS_PORT=4222              # Default
```

## Operational Triangle

Use the three surfaces for different jobs:

- `otto sessions ...` = communication between sessions. Ask, inform, answer, or send lightweight prompts/context.
- `otto tasks ...` = tracked execution. Clear owner, dedicated work session, progress, blocked/done/failed.
- `otto eval ...` = measurement. Reproducible runs, artifacts, diff, and rubric for regression/benchmark.

Rule of thumb:

- If it only needs message passing or short coordination, use `sessions`.
- If it needs `watch/report/done/block/fail`, use `tasks`.
- If you changed behavior and need evidence, use `eval` after the change.

### Cross-Session Messaging

Agents can send typed messages to other sessions using CLI tools. This is the communication layer, not the task runtime:

```bash
otto sessions send agent:main:dm:5511999 "Lembrete: reunião em 10 minutos"
```

**Message Types:**

| CLI | Injected prompt | Intended use |
|-----|-----------------|--------------|
| `otto sessions send` | `[System] Inform: [from: <origin>] ...` | Default fire-and-forget send. Use `-w` to wait for a response or `-i` for interactive mode. |
| `otto sessions inform` | `[System] Inform: ...` | Fire-and-forget context with no tracked work item. |
| `otto sessions execute` | `[System] Execute: ...` | Ask another session to execute something operationally. |
| `otto sessions ask` | `[System] Ask: [from: <session>] ...` | Structured question that can be relayed back over time. |
| `otto sessions answer` | `[System] Answer: [from: <session>] ...` | Deliver an answer back to the origin session. |

There is no separate `[System] Send:` or `contextualize` contract in the current CLI surface.

**Ask/Answer flow:**
1. Agent A: `otto sessions ask sessionB "qual o status do deploy?"`
2. Agent B receives `[System] Ask: [from: sessionA] qual o status do deploy?`
3. Agent B: `otto sessions answer sessionA "deploy concluído com sucesso"`
4. Agent A receives `[System] Answer: [from: sessionB] deploy concluído com sucesso` and can keep working normally

## NATS JetStream Debugging

NATS runs on `:4222`. Use the `nats` CLI (`brew install nats-io/nats-tools/nats`) to inspect streams and replay messages.

### Connection shortcut

```bash
alias nats-local='nats --server nats://127.0.0.1:4222'
```

### Streams overview

```bash
nats stream ls --server nats://127.0.0.1:4222
```

Omni streams: `MESSAGE`, `INSTANCE`, `REACTION`, `MEDIA`, `ACCESS`, `IDENTITY`, `CUSTOM`, `SYSTEM`.

### Inspect a stream

```bash
nats stream info MESSAGE --server nats://127.0.0.1:4222
# Shows: subjects, retention, message count, consumer count, first/last seq
```

### Read messages from stream

```bash
# Last message on a subject pattern
nats stream get MESSAGE --server nats://127.0.0.1:4222 --last-for "message.received.>"

# Specific sequence number
nats stream get MESSAGE --server nats://127.0.0.1:4222 --seq 5

# Pretty-print the JSON payload
nats stream get MESSAGE --server nats://127.0.0.1:4222 --seq 5 | python3 -c "
import sys, json
raw = sys.stdin.read()
start = raw.find('{')
if start >= 0:
    d = json.loads(raw[start:])
    print('METADATA:', json.dumps(d.get('metadata', {}), indent=2))
    print('PAYLOAD:', json.dumps(d.get('payload', {}), indent=2))
"
```

### List / inspect consumers

```bash
# All consumers with their positions (ack floor = last processed seq)
nats consumer report MESSAGE --server nats://127.0.0.1:4222

# Otto consumers
nats consumer report MESSAGE --server nats://127.0.0.1:4222 | grep otto
nats consumer report INSTANCE --server nats://127.0.0.1:4222 | grep otto
```

**Otto consumer names:** `otto-messages` (MESSAGE stream), `otto-instances` (INSTANCE stream).

### Replay messages to otto (debug)

Create a **temporary ephemeral consumer** that delivers from a specific sequence — useful to re-inject a message into the stream and watch otto process it:

```bash
# Subscribe and receive all messages from seq 20 onwards (prints to terminal)
nats consumer sub MESSAGE \
  --server nats://127.0.0.1:4222 \
  --filter "message.received.>" \
  --deliver-start-sequence 20 \
  --ack

# Or deliver all messages from beginning
nats consumer sub MESSAGE \
  --server nats://127.0.0.1:4222 \
  --filter "message.received.>" \
  --deliver-all \
  --ack
```

To force otto to **reprocess** a specific message, bump the otto consumer's ack floor back:

```bash
# Delete otto-messages consumer (otto recreates it with DeliverPolicy.New on restart)
# WARNING: otto won't get new messages until daemon restarts
nats consumer rm MESSAGE otto-messages --server nats://127.0.0.1:4222
otto daemon restart
```

### Live subscribe (plain pub/sub — no JetStream)

Watch events in real time as they arrive from omni:

```bash
# All message events
nats sub "message.received.>" --server nats://127.0.0.1:4222

# Specific instance
nats sub "message.received.whatsapp-baileys.d1458eb9-eec8-49b2-a7ad-d5f2ced8a280" \
  --server nats://127.0.0.1:4222

# Instance events (connect, disconnect, qr_code)
nats sub "instance.>" --server nats://127.0.0.1:4222
```

### Check if ingestMode is set correctly

After the history-sync fix, new messages should have `ingestMode: "realtime"` in metadata. History-sync messages get `ingestMode: "history-sync"` and are skipped by otto.

```bash
# Inspect metadata of last received message
nats stream get MESSAGE --server nats://127.0.0.1:4222 --last-for "message.received.>" | \
  python3 -c "import sys,json; raw=sys.stdin.read(); d=json.loads(raw[raw.find('{'):]); print(d['metadata'].get('ingestMode','NOT SET'))"
```

## Development

```bash
bun run build     # Compile TypeScript
bun run dev       # Watch mode
bun link          # Make `otto` available globally
make quality      # Run lint + typecheck
```

### When to restart the daemon

- **Restart required**: After `bun run build` (code changes need the new bundle)
