---
name: instances-manager
description: |
  Gerencia instâncias de canais do Otto. Use quando o usuário quiser:
  - Criar, listar ou configurar instâncias (contas omni)
  - Conectar/desconectar contas WhatsApp, Matrix, etc
  - Definir policies de DM e grupo por instância
  - Configurar contact intake automático por instância
  - Gerenciar rotas de uma instância específica
  - Aprovar ou rejeitar pendências de acesso
---

# Instances Manager

Instâncias são a entidade central de configuração do Otto. Cada instância representa uma conta conectada (WhatsApp, Matrix, etc) com seu próprio agent, policies e rotas.

## Inspeção Cruzada

Instância isolada não conta a história toda. Ao diagnosticar o estado, combine instância com o que ela produz:

```bash
otto instances list --json                    # canais conectados, intake mode, default tags
otto instances show <name> --json             # detalhes + rotas + omni status
otto contacts list --json                     # quantos contatos cada instância gerou
otto chats list --json                        # quantos chats por instância
```

⚠️ **Instância sem `contactIntakeMode=discovered|pending`** = mensagens chegam mas não viram contato canônico. Cheque sempre.

⚠️ **Instância conectada mas sem agent** = mensagens caem na fila default ou em pending. Pode ser intencional (catch-all manual) ou esquecimento.

⚠️ **`defaultContactTags` vazia** + intake ligado = contatos criam sem etiqueta inicial. Sem etiqueta inicial, regras de classificação não têm gatilho.

## Comandos Principais

### Listar instâncias
```bash
otto instances list
```

### Ver detalhes
```bash
otto instances show <name>
```

### Criar instância
```bash
otto instances create <name>
otto instances create vendas --agent vendas-agent --channel whatsapp
```

### Configurar propriedades
```bash
otto instances set <name> <key> <value>
```

Keys disponíveis:
- `agent` - Agent ID padrão desta instância
- `dmPolicy` - Política para DMs: `open` | `pairing` | `closed`
- `groupPolicy` - Política para grupos: `open` | `allowlist` | `closed`
- `dmScope` - Escopo de sessões DM: `main` | `per-peer` | `per-channel-peer` | `per-account-channel-peer`
- `contactIntakeMode` - Criação/link automático de contatos em DMs: `off` | `discovered` | `pending`
- `instanceId` - UUID omni (normalmente auto-preenchido no connect)
- `channel` - Canal: `whatsapp` | `matrix` | etc

### Remover instância
```bash
otto instances delete <name>
```

## Conexão de Canal

### Conectar WhatsApp
```bash
otto instances connect <name>
otto instances connect vendas --agent vendas-agent
```

### Ver status omni
```bash
otto instances status <name>
```

### Desconectar
```bash
otto instances disconnect <name>
```

## Policies

Policies controlam quem pode iniciar conversa com o bot desta instância:

| Policy | Contexto | Comportamento |
|--------|----------|---------------|
| `dmPolicy=open` | DMs | Aceita qualquer DM |
| `dmPolicy=pairing` | DMs | Só aceita contatos previamente aprovados |
| `dmPolicy=closed` | DMs | Rejeita todos os DMs |
| `groupPolicy=open` | Grupos | Aceita qualquer grupo |
| `groupPolicy=allowlist` | Grupos | Só grupos com rota explícita (`otto instances routes add`) |
| `groupPolicy=closed` | Grupos | Rejeita todos os grupos |

```bash
otto instances set main dmPolicy pairing
otto instances set vendas groupPolicy allowlist
```

## Contact Intake

`contactIntakeMode` controla se DMs recebidas criam/linkam contatos canônicos automaticamente.

```bash
otto instances show main --json
otto instances set main contactIntakeMode discovered
```

Modos:
- `off`: não cria/linka contato automaticamente.
- `discovered`: cria/linka contato como descoberto, sem marcar como pendente operacional.
- `pending`: cria/linka contato como pendente.

Isso vale para mensagens novas. Para chats antigos já capturados, use:

```bash
otto contacts backfill --instance main --mode discovered --dry-run --json
otto contacts backfill --instance main --mode discovered --create-list crm-analysis-pending --apply --json
```

Contact intake não aprova rotas, não responde por si só e não grava análise CRM. Ele só garante identidade canônica, platform identity e vínculo com o ledger de chats.

## Rotas por Instância

```bash
otto instances routes list <name>
otto instances routes show <name> <pattern>
otto instances routes add <name> <pattern> <agent>
otto instances routes remove <name> <pattern>
otto instances routes set <name> <pattern> <key> <value>
```

Padrões suportados:
- `5511*` - Prefixo de telefone
- `group:123456` - Grupo específico
- `thread:abc123` - Thread dentro de grupo (maior prioridade)
- `*` - Catch-all

## Pendências

Quando `dmPolicy=pairing` ou `groupPolicy=allowlist`, contatos/grupos desconhecidos ficam pendentes:

```bash
otto instances pending list <name>
otto instances pending approve <name> <id>    # aprova + cria rota
otto instances pending reject <name> <id>     # rejeita
```

## Exemplos de Setup

### Bot público (responde tudo)
```bash
otto instances create main --agent main --channel whatsapp
otto instances set main dmPolicy open
otto instances set main groupPolicy open
otto instances connect main
```

### Bot controlado (só contatos aprovados)
```bash
otto instances create suporte --agent suporte-agent
otto instances set suporte dmPolicy pairing
otto instances set suporte groupPolicy allowlist
otto instances connect suporte
# Quando alguém envia mensagem → aparece em `pending list`
otto instances pending list suporte
otto instances pending approve suporte 5511999999999
```

### Multi-instância
```bash
otto instances create vendas --agent vendas-agent
otto instances create suporte --agent suporte-agent
otto instances set vendas dmPolicy open
otto instances set suporte dmPolicy pairing
otto instances connect vendas
otto instances connect suporte
```
