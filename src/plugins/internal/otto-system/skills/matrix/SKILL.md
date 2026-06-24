---
name: matrix-manager
description: |
  DEPRECATED. Matrix-specific management is not a supported Otto CLI surface.
  Use this only to redirect away from legacy `otto matrix ...`, `agents.matrix_account`,
  and `matrix_accounts` flows toward Otto channel, instance, contact, chat, and route
  abstractions.
---

# Matrix Manager

This skill is retired.

Otto does not currently expose a supported `otto matrix ...` user-facing CLI surface.
Do not suggest Matrix-specific account, room, DM, invite, or send commands.

## Canonical Surfaces

Use the current Otto abstractions instead:

```bash
otto channels
otto instances
otto routes
otto contacts
otto sessions
```

Channel accounts are managed as instances. Product and agent-facing workflows should
use Otto concepts such as `contact`, `platform_identity`, `chat`, `session`, `actor`,
`message`, `route`, and `policy`.

## Deprecated Legacy

Do not build new guidance around:

- `otto matrix ...`
- `agents.matrix_account`
- `matrix_accounts`
- direct Matrix room/account ids as the product model

Those legacy surfaces are not target architecture. They may remain temporarily only
as compatibility or migration data until removed or reintroduced through the Otto
channel abstraction.

## If Matrix Is Reintroduced

Future Matrix support should be modeled as a channel/instance integration backed by
Omni and Otto semantic data:

- channel capabilities come from Omni through a Otto boundary
- accounts are instances or agent-owned platform identities
- rooms are chats, not contacts
- participants resolve through `platform_identity` into contacts or agents
- messages and events preserve actor metadata and raw provider ids as provenance

Only add a new Matrix-specific user-facing skill after the CLI and source of truth
exist in the repo.
