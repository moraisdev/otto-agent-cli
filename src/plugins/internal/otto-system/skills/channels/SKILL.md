---
name: channels-manager
description: |
  Gerencia canais de comunicação do Otto via omni. Use quando o usuário quiser:
  - Ver status das instâncias WhatsApp, Discord, Telegram
  - Conectar ou desconectar contas
  - Configurar policies de DM e grupo por instância
  - Verificar QR code de pareamento
  - Troubleshoot problemas de conexão
---

# Channels Manager

Canais são gerenciados pelo omni API server (processo filho do daemon). Cada conta conectada é uma **instância** — a entidade central de configuração do Otto.

## Instâncias (central config)

### Listar instâncias
```bash
otto instances list
otto instances show <name>
```

### Conectar nova conta (WhatsApp)
```bash
otto instances connect <name>                         # cria instância + conecta (mostra QR)
otto instances connect vendas --agent vendas-agent
```

### Configurar instância
```bash
otto instances set <name> agent <agent-id>
otto instances set <name> dmPolicy pairing        # open | pairing | closed
otto instances set <name> groupPolicy allowlist   # open | allowlist | closed
otto instances set <name> dmScope per-peer
```

### Desconectar
```bash
otto instances disconnect <name>
```

### Ver status omni
```bash
otto instances status <name>
```

## Modos de Operação

- `active` - Agent responde automaticamente
- `sentinel` - Agent observa silenciosamente, responde só quando instruído

## Policies por Instância

Cada instância pode ter política independente de acesso:

| Policy | Contexto | Comportamento |
|--------|----------|---------------|
| `dmPolicy=open` | DMs | Aceita qualquer DM |
| `dmPolicy=pairing` | DMs | Só aceita contatos aprovados |
| `dmPolicy=closed` | DMs | Rejeita todos os DMs |
| `groupPolicy=open` | Grupos | Aceita qualquer grupo |
| `groupPolicy=allowlist` | Grupos | Só aceita grupos com rota explícita |
| `groupPolicy=closed` | Grupos | Rejeita todos os grupos |

```bash
otto instances set main dmPolicy pairing
otto instances set vendas groupPolicy allowlist
```

## Multi-Instância

```bash
otto instances connect vendas --agent vendas-agent
otto instances connect suporte --agent suporte-agent
otto instances set vendas dmPolicy open
otto instances set suporte groupPolicy allowlist
```

## Troubleshooting

### WhatsApp não conecta
```bash
otto instances status main    # Ver estado da instância
otto instances connect main   # Reconectar (mostra QR se necessário)
otto daemon logs              # Ver logs do daemon e omni
```

### Daemon não inicia
```bash
otto daemon logs              # Ver erros de startup
# Verificar OMNI_DIR em ~/.otto/.env
```
