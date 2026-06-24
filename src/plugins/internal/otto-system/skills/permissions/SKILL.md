---
name: permissions-manager
description: |
  Gerencia permissões REBAC do sistema Otto. Use quando o usuário quiser:
  - Ver, conceder ou revocar permissões de agents
  - Verificar se um agent tem permissão pra algo
  - Sincronizar permissões com configs dos agents
  - Entender o modelo de permissões
---

# Permissions Manager (REBAC)

Permissões no Otto são relações: **(sujeito) tem (relação) sobre (objeto)**.

Exemplo: `(agent:dev) access (session:dev-*)` — o agent dev pode acessar sessões que começam com "dev-".

## IMPORTANTE: Object Types

O object type no grant DEVE corresponder ao que o engine checa. Se errar o type, a permissão não funciona.

**Regra:** Comandos CLI usam `group:<nome-do-grupo>`. Sessões usam `session:<pattern>`. Sistema usa `system:*`.

## Referência Rápida de Grants

### Acesso a grupos de comandos CLI (scope: admin)

O scope `admin` no decorator `@Group` checa `execute` no object type `group`:

```bash
# Formato: otto permissions grant agent:<id> execute group:<grupo>

# Daemon (restart, status, logs)
otto permissions grant agent:dev execute group:daemon

# Agents (create, delete, set, tools, bash)
otto permissions grant agent:dev execute group:agents

# Sessions (list, send, ask, read, reset, delete...)
otto permissions grant agent:dev execute group:sessions

# Contacts (list, add, approve, block, tags)
otto permissions grant agent:dev execute group:contacts

# Routes (add, remove, set, list)
otto permissions grant agent:dev execute group:routes

# Settings (list, get, set)
otto permissions grant agent:dev execute group:settings

# Channels (status, start, stop, restart)
otto permissions grant agent:dev execute group:channels

# Heartbeat (set, enable, disable, trigger)
otto permissions grant agent:dev execute group:heartbeat

# Matrix (add, remove, send, rooms)
otto permissions grant agent:dev execute group:matrix

# WhatsApp groups (create, members, invite)
otto permissions grant agent:dev execute group:whatsapp.group

# Service (install, uninstall, start, stop)
otto permissions grant agent:dev execute group:service
```

**Subcomando específico** — dá acesso a só um comando dentro do grupo:
```bash
# Só restart, não status/logs
otto permissions grant agent:dev execute group:daemon_restart

# Só list, não create/delete
otto permissions grant agent:dev execute group:agents_list
```

### Superadmin (scope: superadmin)

```bash
# Acesso total — permissions, e todos os outros grupos
otto permissions grant agent:dev admin system:*
```

### Sessões (inline scope checks)

```bash
# Acessar sessões (ler, enviar)
otto permissions grant agent:dev access session:dev-*

# Modificar sessões (reset, delete, rename, set-model)
otto permissions grant agent:dev modify session:dev-*
```

### Contatos (scope: writeContacts)

```bash
# Criar/aprovar/bloquear contatos
otto permissions grant agent:dev write_contacts system:*

# Ler contatos das próprias sessões
otto permissions grant agent:dev read_own_contacts system:*

# Ler contatos com tag específica
otto permissions grant agent:dev read_tagged_contacts system:leads
```

### Grupos que NÃO precisam de grant (scope: open/resource)

Estes funcionam pra qualquer agent sem grant:
- `sessions` (open) — mas comandos de modificação checam session scope inline
- `media` (open)
- `react` (open)
- `stickers` (open)
- `tools` (open)
- `transcribe` (open)
- `video` (open)
- `whatsapp.dm` (open)
- `cron` (resource) — checa ownership do recurso
- `triggers` (resource) — checa ownership do recurso

## ERROS COMUNS

❌ **ERRADO** — usar `system:daemon` pra liberar o grupo daemon:
```bash
otto permissions grant agent:dev execute system:daemon
```
Isso não funciona! O engine checa `group:daemon`, não `system:daemon`.

✅ **CERTO:**
```bash
otto permissions grant agent:dev execute group:daemon
```

❌ **ERRADO** — usar `admin` pra dar acesso a um grupo específico:
```bash
otto permissions grant agent:dev admin group:daemon
```
`admin` só funciona com `system:*` (superadmin total).

✅ **CERTO** — usar `execute`:
```bash
otto permissions grant agent:dev execute group:daemon
```

❌ **ERRADO** — confundir `group` com `executable`:
```bash
otto permissions grant agent:dev execute group:*   # libera comandos CLI, NÃO executáveis
```

✅ **CERTO** — object types separados:
```bash
otto permissions grant agent:dev execute group:*        # comandos CLI
otto permissions grant agent:dev execute executable:*   # executáveis do sistema
```

❌ **ERRADO** — relação errada pra executáveis:
```bash
otto permissions grant agent:dev use executable:git   # "use" é pra SDK tools
```

✅ **CERTO:**
```bash
otto permissions grant agent:dev execute executable:git  # executáveis usam "execute"
otto permissions grant agent:dev use tool:Bash           # SDK tools usam "use"
```

### SDK Tools (use tool:*)

Controla quais SDK tools um agent pode usar:

```bash
# Permitir tool específica
otto permissions grant agent:dev use tool:Bash
otto permissions grant agent:dev use tool:Read

# Permitir TODAS as tools (bypass)
otto permissions grant agent:dev use tool:*

# Verificar
otto permissions check agent:dev use tool:Bash
```

SDK tools disponíveis: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `TaskOutput`, `TaskStop`, `TodoWrite`, `NotebookEdit`, `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `EnterWorktree`, `Skill`, `TeamCreate`, `TeamDelete`, `SendMessage`, `LSP`, `ToolSearch`.

### Tool Groups (use toolgroup:*)

Em vez de dar grant tool por tool, use **tool groups** pra conceder acesso a um conjunto de tools de uma vez:

```bash
# Conceder um grupo
otto permissions grant agent:dev use toolgroup:read-only

# Conceder todos os grupos
otto permissions init agent:dev tool-groups

# Revocar um grupo
otto permissions revoke agent:dev use toolgroup:read-only

# Verificar — o check resolve transparentemente
otto permissions check agent:dev use tool:Read   # ✓ se tem toolgroup:read-only
```

**Grupos disponíveis:**

| Grupo | Tools |
|---|---|
| `read-only` | Read, Glob, Grep, WebFetch, WebSearch, LSP, ToolSearch |
| `write` | Edit, Write, NotebookEdit |
| `execute` | Bash, Task, TaskOutput, TaskStop |
| `plan` | EnterPlanMode, ExitPlanMode, AskUserQuestion, TodoWrite |
| `teams` | TeamCreate, TeamDelete, SendMessage |
| `navigate` | EnterWorktree, Skill |

**Como funciona:** Quando o engine checa `can(agent:X, use, tool, Read)`, se não encontra grant direto pra `tool:Read`, verifica se o agent tem algum `toolgroup` que inclui `Read`. Se sim, permite.

**Combina com grants individuais:** Um agent pode ter `toolgroup:read-only` + `tool:Bash` — os dois se somam.

### Executáveis do sistema (execute executable:*)

Controla quais binários do sistema um agent pode rodar via Bash:

```bash
# Permitir executável específico
otto permissions grant agent:dev execute executable:git
otto permissions grant agent:dev execute executable:node
otto permissions grant agent:dev execute executable:otto

# Permitir TODOS os executáveis (bypass)
otto permissions grant agent:dev execute executable:*

# Verificar
otto permissions check agent:dev execute executable:git
```

### Templates (atalhos)

```bash
# SDK tools padrão (uma relação por tool)
otto permissions init agent:dev sdk-tools

# Todas as SDK tools (wildcard)
otto permissions init agent:dev all-tools

# Todos os tool groups (read-only, write, execute, plan, teams, navigate)
otto permissions init agent:dev tool-groups

# Executáveis seguros (git, node, bun, otto, etc.)
otto permissions init agent:dev safe-executables

# Cobertura completa: wildcards em TODOS os object types reconhecidos pelo engine
# (tool, executable, toolgroup, agent, contact, cron, group, session, system, team, trigger).
# Use quando o agent precisa operar livremente em todas as superfícies (sessions, contatos,
# triggers, crons, agents, system admin), não só rodar tools SDK + binários do sistema.
otto permissions init agent:dev full-access
```

> **Nota histórica:** antes deste PR, `full-access` aplicava apenas `use tool:*` + `execute executable:*` (2 grants) — o nome prometia "tudo" mas deixava de fora as superfícies in-process do REBAC (sessions, contacts, agents, etc), forçando o operador a aplicar 24 wildcards adicionais via `permissions grant`. Agora `full-access` cobre os 27 pares (relation, objectType) válidos em um único comando.

## Comandos

### Listar permissões
```bash
# Todas
otto permissions list

# De um agent específico
otto permissions list --subject agent:dev

# De um tipo de objeto
otto permissions list --object group:contacts

# Por relação
otto permissions list --relation access

# Por source
otto permissions list --source manual
```

### Conceder permissão
```bash
otto permissions grant <sujeito> <relação> <objeto>
```

### Revocar permissão
```bash
otto permissions revoke <sujeito> <relação> <objeto>
```

### Verificar permissão
```bash
otto permissions check <sujeito> <permissão> <objeto>
```

Verifica se a permissão é resolvida (incluindo wildcards e admin).

```bash
# Dev pode restartar o daemon?
otto permissions check agent:dev execute group:daemon

# Dev pode acessar sessão dev-grupo1?
otto permissions check agent:dev access session:dev-grupo1

# Main é superadmin?
otto permissions check agent:main admin system:*
```

### Sincronizar com configs
```bash
otto permissions sync
```

Re-lê as configs dos agents e regenera as relações `source=config`. Relações manuais não são afetadas.

### Limpar permissões
```bash
# Limpar só manuais
otto permissions clear

# Limpar TUDO (inclusive config — rode sync depois)
otto permissions clear --all
```

## Wildcards

Wildcards só funcionam no final do object ID:
- `*` — tudo
- `dev-*` — tudo que começa com "dev-"
- ❌ `*-dev` ou `a*b` — inválidos

## Sources

- `config` — Geradas automaticamente a partir da config dos agents (re-sync no boot)
- `manual` — Criadas via CLI, persistem entre restarts

## Como Funciona a Resolução

Quando o engine verifica `can(agent:dev, execute, group:daemon)`:

1. Agent é superadmin? → checa `(agent:dev, admin, system:*)` → sim = allowed
2. Relação direta? → checa `(agent:dev, execute, group:daemon)` → sim = allowed
3. Wildcard? → checa `(agent:dev, execute, group:*)` → sim = allowed
4. Pattern match? → checa patterns como `group:dae*` → match = allowed
5. **Tool group?** → se objectType é `tool`, checa se o agent tem algum `toolgroup` que contém essa tool → sim = allowed
6. Nenhum match → denied
