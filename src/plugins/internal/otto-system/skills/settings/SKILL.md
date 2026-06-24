---
name: settings-manager
description: |
  Gerencia configurações globais do Otto. Use quando o usuário quiser:
  - Ver ou alterar configurações do sistema
  - Definir agent default
  - Configurar DM scope padrão
  - Ver todas as settings disponíveis
---

# Settings Manager

Configurações globais do sistema Otto.

## Comandos

### Listar todas
```bash
otto settings list
otto settings list --legacy
```

### Ver valor
```bash
otto settings get <key>
```

### Definir valor
```bash
otto settings set <key> <value>
```

### Remover
```bash
otto settings delete <key>
```

## Settings Disponíveis

| Key | Descrição | Valores |
|-----|-----------|---------|
| `defaultAgent` | Agent padrão quando nenhuma rota casa | ID do agent |
| `defaultDmScope` | Escopo padrão de DMs | main, per-peer, per-channel-peer, per-account-channel-peer |
| `defaultTimezone` | Fuso horário padrão | America/Sao_Paulo, etc |
| `tasks.sessionTtl` | TTL padrão para sessões de trabalho de tasks | duração como 1d, 12h, ou off |
| `tasks.sessionTtl.knowledgeEngineer` | TTL para sessões de task de `knowledge-engineer-*` | duração como 5m, 1h, ou off |

## ⚠️ Settings Depreciadas (use `otto instances`)

As settings `account.*` foram migradas para a tabela `instances`. **Não use mais estas keys:**

| Key depreciada | Substituta |
|----------------|-----------|
| `account.<name>.agent` | `otto instances set <name> agent <agent>` |
| `account.<name>.instanceId` | `otto instances set <name> instanceId <id>` |
| `account.<name>.dmPolicy` | `otto instances set <name> dmPolicy <policy>` |
| `account.<name>.groupPolicy` | `otto instances set <name> groupPolicy <policy>` |

A migração acontece automaticamente na primeira inicialização do daemon.
Por default, `otto settings list` esconde essas keys; use `--legacy` só para inspecionar ou limpar restos antigos.

## Exemplos

Definir agent default:
```bash
otto settings set defaultAgent main
```

Configurar timezone:
```bash
otto settings set defaultTimezone America/Sao_Paulo
```

Configurar retenção de sessões de tasks:
```bash
otto settings get tasks.sessionTtl
otto settings set tasks.sessionTtl 1d
otto settings set tasks.sessionTtl off
otto settings get tasks.sessionTtl.knowledgeEngineer
otto settings set tasks.sessionTtl.knowledgeEngineer 5m
```

Configurar policy por instância (forma correta):
```bash
otto instances set main dmPolicy pairing
otto instances set vendas groupPolicy allowlist
```
