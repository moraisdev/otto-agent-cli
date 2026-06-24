---
name: cross-manager
description: |
  DEPRECADO — use os comandos de sessions:
  - otto sessions send <session> "mensagem"
  - otto sessions ask <session> "pergunta" "sender"
  - otto sessions answer <session> "resposta" "sender"
  - otto sessions execute <session> "tarefa"
  - otto sessions inform <session> "info"
---

# Cross Manager (DEPRECADO)

Os comandos `otto cross send` e `otto cross list` foram migrados para `otto sessions`.

## Migração

| Antes | Agora |
|-------|-------|
| `otto cross send <target> relay "msg"` | `otto sessions send <session> "msg"` |
| `otto cross send <target> inform "msg"` | `otto sessions inform <session> "msg"` |
| `otto cross send <target> execute "msg"` | `otto sessions execute <session> "msg"` |
| `otto cross send <target> ask "msg" "sender"` | `otto sessions ask <session> "msg" "sender"` |
| `otto cross send <target> answer "msg" "sender"` | `otto sessions answer <session> "msg" "sender"` |
| `otto cross list` | `otto sessions list` |

## Notas

- Targets agora usam **session names** (ex: `main`, `e2-alice-e2`) em vez de session keys
- Source/context são resolvidos automaticamente da sessão
- Use `--channel` e `--to` para override explícito de routing
