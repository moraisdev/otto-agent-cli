---
name: whatsapp-manager
description: |
  Gerencia funcionalidades do WhatsApp via Baileys. Use quando o usuário quiser:
  - Criar, gerenciar ou sair de grupos
  - Adicionar/remover membros de grupos
  - Gerar ou revogar links de convite
  - Renomear grupos ou mudar descrição
  - Alterar configurações de grupo (anúncio, locked)
  - Entrar em grupo via link de convite
  - Listar todos os grupos que o bot participa
---

# WhatsApp Manager

Funcionalidades do WhatsApp expostas via Baileys. Permite gerenciar grupos, membros, convites e configurações diretamente pelo CLI.

**Importante:** Todos os comandos precisam que o daemon esteja rodando com WhatsApp conectado. Os comandos se comunicam com o daemon via NATS (request/reply).

**Gerenciamento de contas/instâncias:** use `otto instances` (conectar, desconectar, status, policies).

## Gerenciamento de Grupos

### Listar grupos
```bash
otto whatsapp group list
```

### Ver info de um grupo
```bash
otto whatsapp group info <groupId>
```

O `groupId` aceita:
- JID completo: `120363425628305127@g.us`
- Formato normalizado: `group:120363425628305127`

### Criar grupo
```bash
otto whatsapp group create "Nome do Grupo" "5511999999999,5511888888888"
```

Participantes separados por vírgula. Aceita números de telefone ou JIDs.

**Com agent (recomendado):** Auto-aprova o contato e cria a rota pro agent num comando só:
```bash
otto whatsapp group create "Vida - Health" "5511999999999" --agent health
```

Saída:
```
✓ Group created: Vida - Health
  ID:           120363405113391144@g.us
  Participants: 2
  Contact:      approved
  Route:        health
```

### Sair de um grupo
```bash
otto whatsapp group leave <groupId>
```

## Membros

### Adicionar participantes
```bash
otto whatsapp group add <groupId> "5511999999999,5511888888888"
```

### Remover participantes
```bash
otto whatsapp group remove <groupId> "5511999999999"
```

### Promover a admin
```bash
otto whatsapp group promote <groupId> "5511999999999"
```

### Remover admin
```bash
otto whatsapp group demote <groupId> "5511999999999"
```

## Convites

### Gerar link de convite
```bash
otto whatsapp group invite <groupId>
```

Retorna o link `https://chat.whatsapp.com/...`

### Revogar link (gera novo)
```bash
otto whatsapp group revoke-invite <groupId>
```

### Entrar via link
```bash
otto whatsapp group join "https://chat.whatsapp.com/ABC123"
# ou só o código:
otto whatsapp group join ABC123
```

## Configurações

### Renomear grupo
```bash
otto whatsapp group rename <groupId> "Novo Nome"
```

### Mudar descrição
```bash
otto whatsapp group description <groupId> "Nova descrição do grupo"
```

### Alterar settings
```bash
otto whatsapp group settings <groupId> <setting>
```

Settings disponíveis:
- `announcement` — só admins enviam mensagens
- `not_announcement` — todos enviam mensagens
- `locked` — só admins editam info do grupo
- `unlocked` — todos editam info do grupo

## Multi-account

Todos os comandos aceitam `--account <id>` pra especificar qual conta WhatsApp usar. Default: primeira instância.

```bash
otto whatsapp group list --account business
otto whatsapp group create "Equipe" "5511999" --account business
```

## Exemplos Práticos

### Criar grupo pra um agent
```bash
# Tudo num comando só:
otto whatsapp group create "Vida - Finanças" "5511999999999" --agent financas
```

Sem `--agent`, precisa rotear manualmente:
```bash
otto whatsapp group create "Grupo Avulso" "5511999999999"
otto instances routes add main "group:<id>" meu-agent
```

### Gerenciar membros de equipe
```bash
# Ver quem tá no grupo
otto whatsapp group info group:120363425628305127

# Adicionar novo membro
otto whatsapp group add group:120363425628305127 "5511777777777"

# Promover a admin
otto whatsapp group promote group:120363425628305127 "5511777777777"
```

### Gerar convite temporário
```bash
# Gerar link
otto whatsapp group invite group:120363425628305127
# → https://chat.whatsapp.com/ABC123

# Depois de todos entrarem, revogar
otto whatsapp group revoke-invite group:120363425628305127
```
