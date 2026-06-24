# @otto-os/sdk

Type-safe TypeScript SDK for controlling a Otto runtime through the authenticated
SDK gateway.

Otto is not just a model wrapper. It is a local-first runtime for long-lived
agents: sessions, tasks, contacts, artifacts, routes, events, permissions, and
audit all live behind one command registry. `@otto-os/sdk` turns that registry
into a typed client you can use from apps, dashboards, browser extensions,
workers, tests, and internal tools.

```ts
import { OttoClient, createHttpTransport } from "@otto-os/sdk";

const otto = new OttoClient(
  createHttpTransport({
    baseUrl: "http://127.0.0.1:7777",
    contextKey: process.env.OTTO_CONTEXT_KEY!,
  }),
);

const sessions = await otto.sessions.list({ live: true, limit: "20" });
const reply = await otto.sessions.send("main", "Summarize the current work.", {
  wait: true,
});
```

## Why This Exists

Use the SDK when you need a programmatic control plane for Otto:

- Build a dashboard that reads sessions, tasks, contacts, and runtime events.
- Let a browser extension talk to the local Otto daemon without shelling out.
- Drive agents from tests or internal automation.
- Stream live task/session/event updates into another UI.
- Write a custom app while keeping auth, permissions, validation, and audit in
  Otto instead of duplicating them.

The package is generated from Otto's decorated CLI registry. If a command exists
in the registry, the SDK gets the same shape, names, args, options, and return
typing.

## Install

```bash
bun add @otto-os/sdk
```

The package is ESM-only and works anywhere `fetch` is available: Bun, Node 18+,
modern browsers, Deno, and edge runtimes.

## Start The Otto Gateway

The SDK talks to Otto's HTTP gateway. Enable it on the daemon host:

```bash
OTTO_HTTP_PORT=7777
OTTO_HTTP_HOST=127.0.0.1
otto daemon start
```

The gateway is mounted under:

```text
http://127.0.0.1:7777/api/v1/*
```

By default Otto is local-only. If you bind the gateway to a non-loopback host,
Otto requires:

```bash
OTTO_GATEWAY_NETWORK_AUTHORIZED=1
```

To keep the HTTP server available for webhooks while disabling SDK routes:

```bash
OTTO_SDK_GATEWAY_DISABLE=1
```

## Create A Context Key

Most SDK routes require a runtime context key (`rctx_*`) in the bearer auth
header. Bootstrap the first admin key on the daemon machine:

```bash
otto daemon init-admin-key
```

For apps, issue a narrow child key instead of shipping the admin key:

```bash
otto context issue dashboard \
  --ttl 2h \
  --allow view:system:events,view:system:tasks,access:session:main \
  --json
```

`createHttpTransport` sends the key as `Authorization: Bearer <rctx_key>`.

## Create A Client

```ts
import { OttoClient, createHttpTransport } from "@otto-os/sdk";

export function createOttoClient() {
  return new OttoClient(
    createHttpTransport({
      baseUrl: process.env.OTTO_BASE_URL ?? "http://127.0.0.1:7777",
      contextKey: process.env.OTTO_CONTEXT_KEY!,
      timeoutMs: 10_000,
    }),
  );
}
```

Deep imports are available when you want smaller bundles:

```ts
import { OttoClient } from "@otto-os/sdk/client";
import { createHttpTransport } from "@otto-os/sdk/transport/http";
```

## Examples

### Read Runtime State

```ts
const otto = createOttoClient();

const agents = await otto.agents.list({ limit: "50" });
const sessions = await otto.sessions.list({ live: true, limit: "25" });
const recentTasks = await otto.tasks.list({
  status: "running",
  limit: "10",
});
```

### Manage Agents

```ts
// List all agents
const agents = await otto.agents.list({ limit: "50" });

// Create a new agent rooted at a workspace directory
await otto.agents.create("support", "/home/pedro/otto/support");

// Inspect and tune
await otto.agents.show("support");
await otto.agents.set("support", "model", "claude-opus-4-7");
await otto.agents.debounce("support", "3000"); // ms

// Inspect or reset the agent's primary session
await otto.agents.session("support");
await otto.agents.reset("support");

// Remove an agent permanently
await otto.agents.delete("support");
```

### Drive Sessions

```ts
// List sessions for one agent, with live runtime snapshot
await otto.sessions.list({ agent: "support", live: true, limit: "20" });

// Send a prompt and wait for the structured response
const result = await otto.sessions.send("support", "Resumo do dia.", {
  wait: true,
});

// Walk the message history
const history = await otto.sessions.read("support", { count: "10" });

// Hand off between sessions (fire-and-forget). Sessions can ask, inform,
// and answer one another — the runtime delivers as system messages.
await otto.sessions.ask("support", "Conseguiu rodar o build?", "agent:main");
await otto.sessions.inform("support", "Daemon reiniciado às 11:20.");
await otto.sessions.answer("support", "Build OK em 12s.", "agent:main");

// Steer / interrupt / rollback the active runtime turn
await otto.sessions.runtime.interrupt("support");
await otto.sessions.runtime.steer("support", "Mais conciso, por favor.");
await otto.sessions.runtime.rollback("support", "1"); // undo last turn

// Lifecycle
await otto.sessions.reset("support");
await otto.sessions.delete("support");
```

`wait: true` maps to the CLI's `--wait`. Without it, `send` returns immediately
and the session processes the prompt in the background.

### Stream Session Events

```ts
import { createStreamClient } from "@otto-os/sdk/streaming";

const stream = createStreamClient({
  baseUrl: "http://127.0.0.1:7777",
  contextKey: process.env.OTTO_CONTEXT_KEY!,
});

for await (const event of stream.session("main", { timeout: 60 })) {
  console.log(event.event, event.data);
}
```

### Stream System Events

```ts
for await (const event of stream.events({
  subject: "otto.session.>",
  noClaude: true,
  noHeartbeat: true,
})) {
  console.log(event.data.topic, event.data.type);
}
```

Available stream helpers:

- `stream.events(...)` -> `GET /api/v1/_stream/events`
- `stream.tasks(...)` -> `GET /api/v1/_stream/tasks`
- `stream.session(name, ...)` -> `GET /api/v1/_stream/sessions/<name>`
- `stream.audit(...)` -> `GET /api/v1/_stream/audit`

Streams always require a valid context key and the matching scope, such as
`view:system:events`, `view:system:tasks`, `access:session:<name>`, or
`view:system:audit`.

### Manage Contacts

```ts
// Approval queue: incoming DMs land here until you allow them
const pending = await otto.contacts.pending();
await otto.contacts.approve("contact_5511…", "auto", { agent: "support" });

// Or add a contact manually (also acts as allow)
await otto.contacts.add("+5511999999999", "Alice", {
  kind: "person",
  agent: "support",
});

// Browse and drill into a contact
const list = await otto.contacts.list({ status: "approved", limit: "50" });
const card = await otto.contacts.profile("contact_123", { includeCrm: true });
const recent = await otto.contacts.messages("contact_123", { limit: "20" });

// Tag, untag, find by tag
await otto.contacts.tag("contact_123", "lifecycle:active");
await otto.contacts.untag("contact_123", "lifecycle:new");
const matches = await otto.contacts.find("lifecycle:active", { tag: true });

// Scoped custom metadata (one row per source)
await otto.contacts.metadata.set("contact_123", "billing_id", "cus_42", {
  scope: "stripe",
  source: "dashboard",
});

// Append a note to the contact timeline
await otto.contacts.note("contact_123", "Cliente pediu desconto em call.", {
  source: "crm",
});

// Moderation
await otto.contacts.block("contact_spam");
```

CRM-specific helpers (accounts, opportunities, lifecycle facts) live under
`otto.crm.*`:

```ts
const crmCards = await otto.crm.contacts({ limit: "20" });
const nextActions = await otto.crm.next({ owner: "agent:main", limit: "10" });

await otto.crm.contact.set("contact_123", "lifecycle", "active", {
  source: "dashboard",
});
```

### Tag Anything

Otto tags are first-class. The same tag slug can bind contacts, sessions,
agents, projects, tasks, chats, instances, artifacts, and more — Otto
maintains the inverse index so you can query the graph from either end.

```ts
// Define the tag once
await otto.tags.create("priority:high", {
  label: "High priority",
  kind: "user",
});

// Attach to any target type — the option key picks the binding
await otto.tags.attach("priority:high", { contact: "contact_123" });
await otto.tags.attach("priority:high", { session: "support" });
await otto.tags.attach("priority:high", { chat: "5511999@s.whatsapp.net" });
await otto.tags.attach("priority:high", { task: "task_42" });

// Search bindings — pivot from tag to all assets, or from one asset to its tags
const tagged = await otto.tags.search({ tag: "priority:high", limit: "100" });
const onContact = await otto.tags.search({ contact: "contact_123" });

// Browse the catalog
await otto.tags.list({ kind: "user", query: "lifecycle" });
await otto.tags.show("priority:high");

// Detach (mirror of attach)
await otto.tags.detach("priority:high", { contact: "contact_123" });
```

### Create And Version Artifacts

```ts
const artifact = await otto.artifacts.create({
  title: "Weekly summary",
  output: "# Summary\n\nDone.",
  mime: "text/markdown",
  session: "main",
  tags: "summary,weekly",
});

await otto.artifacts.snapshot("art_123", {
  label: "v1",
  message: "First published summary",
});
```

Binary artifact commands return the raw `Response` on success:

```ts
const response = await otto.artifacts.blob("art_123");
const bytes = await response.arrayBuffer();
```

### Use A Custom Transport In Tests

The generated client only depends on the `Transport` interface. You can mock it
without starting a daemon:

```ts
import { OttoClient, type Transport } from "@otto-os/sdk";

const calls: unknown[] = [];

const mockTransport: Transport = {
  async call(input) {
    calls.push(input);
    return { ok: true };
  },
};

const otto = new OttoClient(mockTransport);
await otto.sessions.send("main", "hello");
```

## Method Naming

Generated method names mirror the CLI:

- `otto daemon init-admin-key` -> `otto.daemon.initAdminKey()`
- `otto sessions send main "hello" --wait` -> `otto.sessions.send("main", "hello", { wait: true })`
- `otto crm contact set <contact> lifecycle active` -> `otto.crm.contact.set(contact, "lifecycle", "active")`
- `otto sdk client check` -> `otto.sdk.client.check()`

Positional args become positional method parameters. CLI options become the final
`options` object. Most string-like CLI flags stay typed as strings because the
registry mirrors the CLI parser; boolean flags are booleans.

## Wire Contract

Every command call becomes:

```text
POST /api/v1/<group-segments>/<command>
```

The request body is flat JSON. Positional args and options are merged at the top
level:

```json
{
  "name": "main",
  "pattern": "group:120363428558776322",
  "agent": "otto-web",
  "channel": "whatsapp",
  "session": "otto-web"
}
```

Do not wrap input as `{ "args": ..., "options": ... }`.

The HTTP transport adds:

- `Authorization: Bearer <rctx_key>`
- `x-otto-sdk-version`
- `x-otto-registry-hash`

## Errors

All transports throw the same error hierarchy:

- `OttoAuthError` - 401, missing/invalid/expired/revoked context key
- `OttoPermissionError` - 403, scope denied
- `OttoValidationError` - 4xx validation failure, exposes `issues[]`
- `OttoInternalError` - 5xx from the gateway or command handler
- `OttoTransportError` - network failure, timeout, or unexpected transport error

```ts
import { OttoError, OttoValidationError } from "@otto-os/sdk/errors";

try {
  await otto.artifacts.show("missing");
} catch (error) {
  if (error instanceof OttoValidationError) {
    console.error(error.issues);
  } else if (error instanceof OttoError) {
    console.error(error.status, error.command, error.message);
  }
}
```

## Codegen And Drift

Generated files are committed as the canonical package surface:

- `src/client.ts`
- `src/schemas.ts`
- `src/types.ts`
- `src/version.ts`

Regenerate and check drift from the Otto repo root:

```bash
bun run sdk:generate
bun run sdk:check
```

OpenAPI and Swift SDK snapshots are generated from the same registry:

```bash
bun run docs:openapi
bun src/cli/index.ts sdk swift generate
```

The source of truth is `src/cli/registry-snapshot.ts`, not the OpenAPI file.

## Published Exports

```ts
import { OttoClient } from "@otto-os/sdk";
import { OttoClient as DeepClient } from "@otto-os/sdk/client";
import { createHttpTransport } from "@otto-os/sdk/transport/http";
import { createStreamClient } from "@otto-os/sdk/streaming";
import { OttoError } from "@otto-os/sdk/errors";
import type { SessionsListReturn } from "@otto-os/sdk/types";
```

Published exports:

- `@otto-os/sdk`
- `@otto-os/sdk/client`
- `@otto-os/sdk/transport/http`
- `@otto-os/sdk/streaming`
- `@otto-os/sdk/errors`
- `@otto-os/sdk/types`
- `@otto-os/sdk/schemas`

`packages/otto-os-sdk/src/transport/in-process.ts` is monorepo-internal and is
not exported by the published package.
