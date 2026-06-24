---
name: routes-manager
description: |
  Gerencia rotas de mensagens do Otto. Use quando o usuário quiser:
  - Criar, listar ou remover rotas
  - Direcionar contatos/grupos/threads para agents específicos
  - Configurar prioridade, policy e dmScope de rotas
  - Ver qual agent atende qual padrão
---

# Routes Manager

Rotas direcionam mensagens para agents baseado em padrões. São sempre gerenciadas via `otto instances routes <name>` — rotas pertencem a uma instância.

## Comandos

### Listar rotas
```bash
otto instances routes list <name>
```

### Ver detalhes
```bash
otto instances routes show <name> <pattern>
```

### Adicionar rota
```bash
otto instances routes add <name> <pattern> <agent>
otto instances routes add vendas "5511*" vendas-agent --priority 10
otto instances routes add vendas "group:123456" suporte --policy closed
otto instances routes add vendas "*" main --channel whatsapp   # só pra um canal
```

Exemplos de padrões:
- `5511*` - Todos com DDD 11
- `*999*` - Números contendo 999
- `group:123456` - Grupo específico do WhatsApp
- `thread:abc123` - Thread específica dentro de um grupo
- `*` - Catch-all (fallback)

### Remover rota (soft-delete, recuperável)
```bash
otto instances routes remove <name> <pattern>
otto instances routes restore <name> <pattern>   # recuperar
otto instances routes deleted [name]             # ver deletadas
```

### Configurar propriedades
```bash
otto instances routes set <name> <pattern> <key> <value>
```

Keys disponíveis:
- `agent` - Agent ID alvo
- `priority` - Prioridade (maior = mais prioritário)
- `dmScope` - Escopo de DM (main, per-peer, per-channel-peer, per-account-channel-peer)
- `session` - Nome fixo de sessão (bypassa auto-geração)
- `policy` - Policy override (open, pairing, closed, allowlist)
- `channel` - Limitar a canal específico (whatsapp, telegram, etc). `-` pra limpar.

## Prioridade de Resolução

1. Rota `thread:ID` (mais específica — thread dentro de grupo)
2. Rota `group:ID` ou padrão de grupo
3. Rota por telefone/padrão
4. Mapeamento agent da instância (`otto instances set <name> agent <agent>`)
5. Agent default

Dentro do mesmo nível: rotas com `channel` específico ganham de rotas sem channel, depois desempata por `priority` DESC.

## Herança de Policy

```
route.policy → instance.dmPolicy/groupPolicy → "open"
```

## Exemplos

Rotear grupo para agent especializado:
```bash
otto instances routes add main "group:120363123456789" projeto-x
```

Rotear thread específica dentro de um grupo:
```bash
otto instances routes add main "thread:msg-abc123" suporte-vip
```

Rotear todos de SP para agent:
```bash
otto instances routes add main "5511*" vendas
```

Definir política restrita em rota específica:
```bash
otto instances routes set main "group:123456" policy closed
```

Definir fallback:
```bash
otto instances routes add main "*" main
```

Para gerenciar contacts: use a skill `otto-system:contacts`
