---
name: specs
description: |
  Gerencia a memória versionada de regras/specs do Otto. Use quando precisar:
  - Criar ou consultar regras por domain/capability/feature
  - Recuperar contexto normativo antes de editar código
  - Linkar specs a Projects como contexto ou auditoria futura
  - Reindexar `.otto/specs` no SQLite
---

# Specs

`otto specs` é a memória durável de regras do Otto.

Use specs para registrar invariantes, decisões, runbooks e checks que agents devem consultar antes de mexer em uma área.

## Workflow

1. Antes de alterar uma área com regras conhecidas, consulte a spec explícita:

```bash
otto specs get <domain>/<capability>/<feature> --mode rules --json
```

2. Se precisar entender decisão, operação ou validação, use o modo específico:

```bash
otto specs get <spec-id> --mode why --json
otto specs get <spec-id> --mode runbook --json
otto specs get <spec-id> --mode checks --json
```

3. Depois de corrigir bug ou descobrir uma regra nova, atualize a spec afetada ou crie uma nova.

4. Reindexe quando precisar validar a árvore toda:

```bash
otto specs sync --json
```

Regra prática: se a regra vai prevenir regressão futura, ela pertence a uma spec, não só ao chat.

## Estrutura

Source of truth:

```text
.otto/specs/
  <domain>/SPEC.md
  <domain>/<capability>/SPEC.md
  <domain>/<capability>/<feature>/SPEC.md
```

Arquivos opcionais por nó:

- `SPEC.md` — regras, invariantes, boundaries, acceptance criteria
- `WHY.md` — decisões, tradeoffs, alternativas descartadas
- `RUNBOOK.md` — debug/operação
- `CHECKS.md` — validações, regressões, queries

## Linguagem Normativa

Dentro de `SPEC.md`, prefira:

- `MUST` para regra obrigatória
- `MUST NOT` para comportamento proibido
- `SHOULD` para default esperado
- `MAY` para comportamento opcional

## Consultar

```bash
otto specs list
otto specs list --domain channels --kind feature
otto specs get channels/presence/lifecycle
otto specs get channels/presence/lifecycle --mode full
otto specs get channels/presence/lifecycle --mode checks
```

Modos:

- `rules` — herança de `SPEC.md` do domain até feature. Default.
- `full` — inclui `SPEC.md`, `WHY.md`, `RUNBOOK.md`, `CHECKS.md`.
- `checks` — só `CHECKS.md`.
- `why` — só `WHY.md`.
- `runbook` — só `RUNBOOK.md`.

Sempre use `--json` quando a saída for consumida por outro agente ou script:

```bash
otto specs get channels/presence/lifecycle --json
```

## Criar

```bash
otto specs new channels --title "Channels" --kind domain
otto specs new channels/presence --title "Presence" --kind capability
otto specs new channels/presence/lifecycle --title "Presence Lifecycle" --kind feature --full
```

`--full` cria `WHY.md`, `RUNBOOK.md` e `CHECKS.md` junto do `SPEC.md`.

## Reindexar

```bash
otto specs sync
otto specs sync --json
```

O índice SQLite é rebuildável. Markdown continua sendo source of truth.

## Linkar a Projects

```bash
otto projects link spec otto-core channels/presence/lifecycle \
  --role context \
  --meta '{"context":true,"audit":true}'
```

Projects não são donos da spec; eles apenas apontam quais regras importam para aquele workstream.
