---
name: agents-manager
description: |
  Gerencia agents do sistema Otto. Use quando o usuário quiser:
  - Criar, configurar ou deletar agents
  - Gerenciar permissões de tools (whitelist/bypass)
  - Configurar permissões de Bash (allowlist/denylist)
  - Ver ou resetar sessões de agents
  - Configurar debounce de mensagens
  - Entender como rotear mensagens pra um agent
---

# Agents Manager

Agents são identidades operacionais do Otto com configurações específicas: diretório, runtime provider, modelo, permissões, sessões e rotas. Cada agent tem seu workspace, sessões independentes e pode atender canais/contatos diferentes.

**Importante:** Criar ou modificar agents **não requer restart** do daemon. Tudo atualiza em tempo real.

## Fluxo Completo: Criar um Agent e Colocar pra Funcionar

### 1. Criar o agent

```bash
otto agents create <id> <cwd> [--provider <provider>]
```

O `cwd` é o diretório onde fica o `AGENTS.md` do agent (suas instruções canônicas). Crie o diretório e o `AGENTS.md` antes. O Otto materializa um `CLAUDE.md` de compatibilidade quando necessário.

## Runtimes Disponíveis

`provider` define qual runtime executa as sessões do agent. `model` é interpretado pelo provider configurado.

Providers built-in atuais:

| Provider | Uso esperado | Modelo |
|----------|--------------|--------|
| `claude` | Runtime default e mais completo para agents com hooks, plugins, MCP e remote spawn. | Selector nativo do provider, ou default quando vazio. |
| `codex` | Runtime por subprocess/RPC com CLI Otto via shell/contexto e controle de runtime. | Ex: `gpt-5.5`, `gpt-5.4`, `gpt-4.1-mini`. |
| `pi` | Runtime por Pi coding agent em RPC, bom para agentes rápidos/dev e providers externos. | Use `provider/model`, ex: `kimi-coding/kimi-for-coding` ou `openai/gpt-4.1-mini`. |

Comandos comuns:

```bash
# Criar já usando runtime específico
otto agents create familia-sp ~/otto/familia-sp --provider pi

# Trocar runtime do agent
otto agents set familia-sp provider pi

# Setar modelo do provider atual
otto agents set familia-sp model kimi-coding/kimi-for-coding

# Voltar para outro runtime
otto agents set familia-sp provider codex
otto agents set familia-sp model gpt-5.5
```

Notas operacionais:

- Mudar `provider` ou `model` não requer restart do daemon.
- Sessões já ativas não mudam retroativamente no meio de um turno; a troca vale para o próximo start/turn compatível.
- Provider ids são abertos em config, mas só providers registrados no daemon executam. Se salvar um provider inexistente, a falha aparece no start da sessão.
- `pi` exige selector de modelo completo quando o valor também é um provider do Pi. `kimi-coding` sozinho é inválido; use `kimi-coding/<model-id>`.
- `pi` usa ferramentas nativas do provider no MVP. Se o agent precisa executar tools/comandos, configure permissões coerentes antes de colocar em rota live.

### 2. Rotear mensagens pro agent

Existem duas formas de rotear:

**Por rota (padrão de grupo/contato):**
```bash
otto instances routes add <instance> <pattern> <agent>
```

Patterns suportados:
- `group:120363425628305127` — grupo específico
- `lid:178035101794451` — contato específico (por lid)
- `5511*` — todos com DDD 11
- `*` — catch-all

**Por contato (assignment direto):**
```bash
otto contacts approve <phone> <agent>
# ou
otto contacts set <phone> agent <agent>
```

### 3. Ativar em grupo WhatsApp

Grupos novos precisam ser **aprovados** antes de funcionar.

**Instrua o usuário a:**
1. Criar um grupo no WhatsApp e adicionar o bot
2. Mandar uma mensagem qualquer no grupo (isso faz o grupo aparecer como **pending**)

**Depois, VOCÊ (o agent) deve executar:**
```bash
otto contacts pending                            # Checar pendentes — o grupo aparece aqui
otto contacts approve <group-id> <agent>                       # Aprovar e associar ao agent
otto instances routes add main <group-id> <agent>              # Criar rota pro grupo
```

**IMPORTANTE:** Não peça o ID do grupo pro usuário. Rode `otto contacts pending` pra descobrir o ID automaticamente. O usuário já mandou a mensagem — o grupo já está lá.

Tudo atualiza em tempo real. **Não precisa reiniciar o daemon.**

### Como novos contatos/grupos aparecem?

Quando alguém novo manda mensagem (ou o bot é adicionado a um grupo novo), o contato/grupo aparece como **pending** automaticamente. Nenhuma mensagem é processada até ser aprovado.

```bash
otto contacts pending     # Ver contatos/grupos pendentes
```

Pra aprovar e rotear:
```bash
otto contacts approve <phone> <agent>   # Aprova e associa ao agent
otto contacts approve <phone>           # Aprova sem associar (usa rota ou default)
otto contacts block <phone>             # Bloqueia
```

### Prioridade de roteamento

Quando uma mensagem chega, o sistema resolve o agent nesta ordem:

1. **Contato tem agent?** → usa o agent do contato
2. **Tem rota que casa?** → usa o agent da rota (prioridade maior primeiro)
3. **Account ID casa com agent?** → usa (Matrix multi-account)
4. **Nenhum match** → usa o agent default (geralmente `main`)

## Comandos Disponíveis

### Listar agents
```bash
otto agents list
```

### Ver detalhes
```bash
otto agents show <id>
```

### Criar agent
```bash
otto agents create <id> <cwd>
```

### Sincronizar instruções legadas
```bash
otto agents sync-instructions
otto agents sync-instructions --agent <id>
otto agents sync-instructions --materialize-missing
```

### Deletar agent
```bash
otto agents delete <id>
```

### Configurar propriedades
```bash
otto agents set <id> <key> <value>
```

Keys:
- `name` — Nome do agent
- `cwd` — Diretório de trabalho
- `provider` — Runtime provider (`claude`, `codex`, `pi`, ou outro provider registrado)
- `model` — Modelo/selector interpretado pelo provider atual
- `dmScope` — Escopo de sessão DM:
  - `main` — Todas as DMs numa sessão só
  - `per-peer` — Uma sessão por contato (default)
  - `per-channel-peer` — Por canal + contato
  - `per-account-channel-peer` — Isolamento total
- `systemPromptAppend` — Texto adicional no system prompt
- `matrixAccount` — Conta Matrix associada

## Permissões (REBAC)

Permissões de tools e executáveis são gerenciadas via REBAC:

```bash
# Ver permissões de um agent
otto permissions list --subject agent:<id>

# Configurar permissões
otto permissions init agent:<id> full-access     # Tudo liberado
otto permissions init agent:<id> sdk-tools       # SDK tools padrão
otto permissions init agent:<id> safe-executables # Executáveis seguros

# Grants individuais
otto permissions grant agent:<id> use tool:Bash
otto permissions grant agent:<id> execute executable:git
```

Ver skill `permissions-manager` para documentação completa.

## Debounce de Mensagens

Agrupa mensagens rápidas antes de processar:

```bash
otto agents debounce <id> <ms>   # Definir (ex: 2000 = 2s)
otto agents debounce <id> 0      # Desabilitar
otto agents debounce <id>        # Ver atual
```

## Sessões

### Ver sessões
```bash
otto agents session <id>
```

### Resetar sessão
```bash
otto agents reset <id>              # Sessão principal
otto agents reset <id> <sessionKey> # Sessão específica
otto agents reset <id> all          # Todas as sessões
```

## Interação

### Enviar prompt
```bash
otto agents run <id> "prompt"
```

### Chat interativo
```bash
otto agents chat <id>
```

## Receita Completa: Agent Pessoal com Grupo WhatsApp

Agents pessoais são agents dedicados a um aspecto da vida do usuário (comunicação, journaling, estratégia, etc). Cada um tem seu grupo WhatsApp exclusivo.

**Conceito importante:** O agent já nasce dentro do WhatsApp. Ele não precisa de nenhuma tool pra enviar mensagens — toda resposta dele já chega automaticamente no WhatsApp. Ele deve saber disso no `AGENTS.md`.

### Passo a passo

#### 1. Criar diretório e AGENTS.md

```bash
mkdir -p ~/otto/<agent-id>
```

Escreva o `AGENTS.md` com a identidade e instruções do agent. Estrutura recomendada:

```markdown
# <Nome do Agent>

## Quem Você É
- Papel, personalidade, tom de voz
- O que você faz e o que NÃO faz

## Contexto
- Você já está conversando pelo WhatsApp com o usuário
- Toda mensagem que você envia chega diretamente no WhatsApp
- Você NÃO precisa de nenhuma tool pra enviar mensagens

## Como Funciona
- Metodologia, frameworks, abordagem
- Exemplos de interação

## Regras
- Limites, boundaries, o que evitar
```

**Dicas pro AGENTS.md:**
- Dê personalidade — agents genéricos são chatos
- Seja específico sobre o que o agent faz e não faz
- Inclua que ele já está no WhatsApp (não precisa de tool pra mensagem)
- Adapte o tom pro contexto (coach é diferente de diário é diferente de estrategista)

#### 2. Criar o agent no sistema

```bash
otto agents create <agent-id> ~/otto/<agent-id>
```

#### 3. Criar grupo WhatsApp dedicado

O usuário cria um grupo no WhatsApp (ex: "Vida - Comunicação") e adiciona o bot. Ao enviar a primeira mensagem no grupo, o contato aparece automaticamente como **pending**.

#### 4. Aprovar e rotear o grupo

**Não peça o ID do grupo pro usuário.** Rode o CLI pra descobrir:

```bash
# Ver grupos/contatos pendentes
otto contacts pending

# Aprovar o grupo
otto contacts approve <group-id>

# Criar rota pro agent
otto instances routes add main <group-id> <agent-id>
```

O `group-id` tem formato `group:120363406060070449`.

#### 5. Pronto!

O agent já está respondendo no grupo. Não precisa reiniciar o daemon.

### Exemplo real: Agent de comunicação

```bash
# 1. Criar diretório
mkdir -p ~/otto/comm

# 2. Escrever AGENTS.md (com identidade de coach de comunicação)

# 3. Criar agent
otto agents create comm ~/otto/comm

# 4. Usuário cria grupo "Vida - Comunicação" no WhatsApp e manda msg

# 5. Aprovar e rotear
otto contacts pending                          # Encontra group:120363406060070449
otto contacts approve group:120363406060070449  # Aprova
otto instances routes add main group:120363406060070449 comm   # Roteia pro comm
```

## Exemplos Práticos

### Criar agent pra atendimento

```bash
# 1. Criar diretório e AGENTS.md
mkdir -p ~/otto/atendimento
# (crie o AGENTS.md com as instruções do agent)

# 2. Criar agent
otto agents create atendimento ~/otto/atendimento

# 3. Rotear grupo pro agent
otto instances routes add main group:120363425628305127 atendimento

# 4. Configurar permissões (via REBAC)
otto permissions init agent:atendimento sdk-tools       # SDK tools padrão
otto permissions init agent:atendimento safe-executables # Executáveis seguros
otto permissions grant agent:atendimento use tool:Bash   # Liberar Bash
```

### Aprovar contato e associar a agent

```bash
# Ver pendentes
otto contacts pending

# Aprovar e associar
otto contacts approve 5511999999999 atendimento

# Ou aprovar com modo "mention" (só responde quando mencionado)
otto contacts approve 5511999999999 atendimento mention
```

### Configurar rota com prioridade

```bash
# Rota específica (prioridade alta)
otto instances routes add main group:123456789 vendas
otto instances routes set main group:123456789 priority 10

# Rota catch-all (prioridade baixa)
otto instances routes add main "*" main
```
