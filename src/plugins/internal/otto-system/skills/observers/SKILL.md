---
name: observers
description: |
  Gerencia o Observation Plane do Otto. Use quando precisar:
  - Listar, explicar ou atualizar observer bindings
  - Criar regras de observer por global/agent/session/task/profile/tag
  - Criar, validar ou pré-visualizar observer profiles Markdown
  - Configurar task observers como `observed-task` + profile `tasks`
---

# Observers

Observers são sessões sidecar que recebem eventos canônicos de uma sessão fonte.
Eles são assíncronos e isolados: não contaminam o prompt, permissões ou runtime
da sessão observada.

## Modelo Mental

- `source session`: sessão observada.
- `observer session`: sessão Otto comum que recebe o prompt de observação.
- `rule`: decide quando criar o observer.
- `binding`: relação durável entre source e observer.
- `profile`: decide como eventos viram Markdown para o observer.

Rules escolhem **quando** observar. Profiles escolhem **como** formatar.

## Inspeção Cruzada

Observers vivem em cima do resto do CRM. Antes de criar ou debugar, inspecione o ecossistema todo:

```bash
otto observers rules list --json                 # quais regras observam o quê
otto observers list --json                       # bindings ativos
otto tag-rules list --json                       # quem produz as tags que observers consomem
otto contacts list --json                        # base sob observação
otto chats lists list --json                     # filas de leitura (se observers usam reading lists)
```

⚠️ **Observer rule sem source matching** = dorme pra sempre. Use `otto observers rules explain --session <session>` pra ver porque uma rule específica não disparou.

⚠️ **Observer rule por tag de contato** depende de `session_participants` ter o contato linkado. Confirme via `otto observers rules explain` que `source.contactIds` está preenchido.

## Comandos

```bash
otto observers list
otto observers show <binding-id>
otto observers refresh <session>

otto observers rules list
otto observers rules show <rule-id>
otto observers rules set <rule-id> <observer-agent> [--scope profile] [--source-profile observed-task] [--profile tasks]
otto observers rules validate
otto observers rules explain --session <session>

otto observers profiles list
otto observers profiles show <profile-id>
otto observers profiles preview <profile-id> --event message.assistant
otto observers profiles validate [profile-id]
otto observers profiles init <profile-id>
```

## Profiles

Observer profiles são bundles Markdown:

```text
.otto/observers/profiles/<id>/
  PROFILE.md
  delivery/end-of-turn.md
  delivery/realtime.md
  delivery/debounce.md
  events/message-user.md
  events/message-assistant.md
  events/turn-complete.md
  events/turn-failed.md
  events/turn-interrupt.md
  events/default.md
```

Não use manifest JSON/YAML separado. O frontmatter fica no `PROFILE.md`.

System profiles atuais:

- `default`: renderer genérico.
- `tasks`: renderer para observers que atualizam status de tasks.

## Observed Task

Use `observed-task` quando o worker deve executar sem carregar o protocolo de
status da task no prompt principal.

Setup típico:

```bash
otto observers rules set observed-task-status <observer-agent> \
  --scope profile \
  --source-profile observed-task \
  --role task-status \
  --mode report \
  --profile tasks \
  --delivery end_of_turn \
  --permissions tasks.report,tasks.block,tasks.done,tasks.fail
```

`--permissions` aceita atalhos como `tasks.report` ou capability completa como
`use:tool:tasks_report`. Esses grants entram apenas no runtime context do
observer, não na sessão fonte.

Depois:

```bash
otto tasks create "..." --profile observed-task
otto tasks dispatch <task-id> --agent <worker-agent>
```

O worker faz o trabalho e deixa sinais claros. O observer recebe Markdown do
profile `tasks` e decide se chama `otto tasks report|block|done|fail`.

## Tag-Driven Observers em Contatos

Rules com `--scope tag --tag-target contact --tag <slug>` agora veem tags ligadas a contatos vinculados à sessão fonte. A resolução acontece via `session_participants` (owner_type=`contact`).

Casos típicos:

- Instância configurada com `defaultContactTags` aplica tag em contatos novos. Rule observer com a mesma tag dispara automaticamente.
- Para mudar de observer, mude a tag do contato (`otto contacts tag/untag`). Novas bindings serão criadas na próxima avaliação.
- DM-per-peer é o cenário ideal: 1 contato por sessão. Em sessões com vários contatos (group/main), todas as tags presentes são consideradas.

Detalhes operacionais e exemplos completos estão na skill `otto-system:contacts` no playbook *Tag → Observer por Contato*.

## Invariantes

- Não crie rules por padrão em sistemas novos.
- Não injete conteúdo do observer na sessão fonte.
- Não use dumps JSON como formato primário para o observer.
- Não use modo `observe` com permissões mutáveis.
- Não reinicie daemon para validar profile; use `profiles preview|validate`.
- Não confie em remoção automática de bindings quando a tag de contato muda. Faça housekeeping manual quando preciso (`otto observers ...`).
