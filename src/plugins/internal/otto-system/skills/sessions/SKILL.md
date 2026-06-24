---
name: sessions
description: |
  Gerencia sessões do sistema Otto. Use quando o usuário quiser:
  - Listar, ver detalhes ou renomear sessões
  - Resetar ou deletar sessões
  - Configurar modelo ou thinking level por sessão
  - Limpar sessões inativas com dry-run e filtros explícitos
  - Criar sessões efêmeras com TTL
  - Estender, manter ou excluir sessões efêmeras
  - Enviar prompts, perguntas ou comandos entre sessões
  - Ler histórico de mensagens de uma sessão
  - Inspecionar trace SQLite de uma sessão para incidentes de runtime/canal
---

# Sessions Manager

Sessões são conversas persistentes entre agents e usuários. Cada sessão tem um nome único, um agent associado, e pode ter canal de saída (WhatsApp, Matrix, etc).

Sessões são a superfície de comunicação do Otto. Não são o task runtime. Se o trabalho precisa de dono, progresso e estado terminal, use `otto tasks ...`. Se a pergunta é medir regressão ou comparar comportamento, use `otto eval ...`.

## Tipos de Sessão

- **Permanent** (padrão): Sessão normal, sem expiração.
- **Ephemeral**: Sessão com TTL (time-to-live). Expira automaticamente após o tempo definido. 10 minutos antes de expirar, o agent recebe um aviso com comandos CLI para estender, manter ou excluir.

## Comandos

### Listagem e Info

```bash
# Listar todas as sessões (mostra tipo e data de expiração)
otto sessions list

# Filtrar por agent
otto sessions list --agent <id>

# Listar só efêmeras
otto sessions list --ephemeral

# Ver detalhes de uma sessão
otto sessions info <name>

# Ler histórico durável da sessão (normalizado, sem tool calls; atravessa restarts/resets de provider)
otto sessions read <name> [-n count]

# Inspecionar timeline operacional persistida em SQLite
otto sessions trace <name> --since 2h --explain
```

### Gerenciamento

```bash
# Renomear o nome canonico da sessao (sessions.name)
otto sessions rename <name> <novo-nome-canonico>

# Definir label humano/display-only
otto sessions set-display <name> "Novo Nome Humano"

# Definir modelo override
otto sessions set-model <name> <model>

# Definir thinking level
otto sessions set-thinking <name> <level>

# Resetar sessão (limpa conversa, mantém config)
otto sessions reset <name>

# Deletar sessão permanentemente (abort + delete)
otto sessions delete <name>

# Preview de limpeza por inatividade (não apaga nada)
otto sessions prune --inactive-for 2d --json

# Deletar sessões inativas há mais de 2 dias
otto sessions prune --inactive-for 2d --execute
```

`prune` usa `updated_at`/última atividade da sessão, não `created_at`.
Isso evita apagar uma sessão antiga que teve atividade recente.

Filtros úteis:

```bash
otto sessions prune --inactive-for 1d --agent dev
otto sessions prune --inactive-for 2d --name-prefix task-
otto sessions prune --inactive-for 12h --ephemeral
```

Sem `--execute`, `prune` é sempre dry-run. Use o dry-run antes de apagar em lote.

### Sessões Efêmeras

```bash
# Tornar sessão efêmera com TTL (ex: 5h, 30m, 1d)
otto sessions set-ttl <name> <duration>

# Estender TTL de uma sessão efêmera (+5h default)
otto sessions extend <name> [duration]

# Tornar sessão efêmera em permanente
otto sessions keep <name>
```

**Fluxo automático:**
1. Sessão criada com `set-ttl` recebe TTL
2. 10 min antes de expirar, o agent recebe aviso via `[System] Inform:` com os comandos CLI
3. O agent pode executar `extend`, `keep`, ou `delete`
4. Sem ação → sessão é automaticamente deletada pelo runner

### Comunicação Inter-Sessão

```bash
# Enviar prompt/contexto
otto sessions send <name> "mensagem" [-w] [-a agent] [-i]
# -w: espera e streama a resposta
# -a: cria sessão com esse agent se não existir
# -i: modo interativo (loop)

# Perguntar algo (fire-and-forget, agent pergunta no chat se não souber)
otto sessions ask <name> "pergunta" [sender]

# Responder uma pergunta de outra sessão (agent NUNCA silencia)
otto sessions answer <name> "resposta" [sender]

# Executar comando (fire-and-forget, agent executa sem responder)
otto sessions execute <name> "tarefa"

# Informar algo (fire-and-forget, agent pode silenciar se irrelevante)
otto sessions inform <name> "info"
```

### Session Trace

Use `otto sessions trace` quando precisar entender uma sessão real ponta a ponta:
inbound de canal, routing, prompt publish, decisões de dispatch, request final
do adapter, tools, resposta, delivery e falhas.

SQLite (`otto.db`) é a fonte canônica do trace. NATS/logs são apoio para debug
ao vivo, não a fonte primária para reconstruir incidente.

```bash
# Golden path de incidente
otto sessions trace <name> --since 2h --explain

# Filtros úteis
otto sessions trace <name> --turn <turn_id> --explain
otto sessions trace <name> --run <run_id>
otto sessions trace <name> --message <source_message_id> --explain
otto sessions trace <name> --correlation <correlation_id> --raw --explain

# Cortes de leitura
otto sessions trace <name> --only adapter
otto sessions trace <name> --only tools
otto sessions trace <name> --only delivery
otto sessions trace <name> --only dispatch
otto sessions trace <name> --only turn
otto sessions trace <name> --since 30m --limit 40
otto sessions trace <name> --json

# Payloads grandes só quando necessário
otto sessions trace <name> --show-system-prompt
otto sessions trace <name> --turn <turn_id> --show-user-prompt
otto sessions trace <name> --turn <turn_id> --raw
```

`--show-system-prompt` resolve o system prompt mais recente da sessão e não
depende do `turn` estar visível no recorte/limit. User prompt e raw request
continuam escopados a turn/request.

Leitura rápida:

- `channel.message.received` = inbound chegou no Otto.
- `route.resolved` = rota escolheu sessão e agent.
- `prompt.published` = prompt entrou no stream da sessão.
- `dispatch.*` = cold start, push em sessão viva, queue, interrupt, restart ou task barrier.
- `runtime.start` = runtime começou ou falhou antes do provider.
- `adapter.request` = Otto montou a request final para o provider. Se existe, chegou no handoff.
- `tool.start` / `tool.end` = atividade de tool do provider.
- `assistant.message` = texto do assistant recebido do provider.
- `response.emitted` = Otto emitiu resposta para o gateway.
- `delivery.*` = gateway observou delivered, failed, dropped ou outro status.
- `turn.complete` / `turn.failed` / `turn.interrupted` = estado terminal do turno.
- `session.stalled` = evento legado do watchdog de runtime; hoje deve aparecer só em traces históricos. Código novo deve fechar o turno via evento terminal do provider.

Achados comuns do `--explain`:

- `prompt-without-adapter-request`: prompt nao chegou no handoff do provider; olhar dispatch, debounce, task barrier ou runtime startup.
- `adapter-request-without-terminal-turn`: request foi criada, mas nao houve terminal turn; olhar provider/runtime apos handoff.
- `response-without-delivery`: resposta saiu do runtime mas nao teve delivery observado.
- `delivery-failed` / `delivery-dropped`: falha ou drop no outbound; olhar payload de delivery e target.
- `interruption-or-abort`: houve interrupt/abort; ler `abortReason`, `session.abort` e `dispatch.interrupt_requested`.
- `runtime-stalled`: trace historico contem `session.stalled` do watchdog removido; verificar se foi produzido por daemon antigo.
- `timeout`: timeout interrompeu a sessao/turno.
- `resume-disabled-with-provider-session`: havia provider session id mas `resume=false`; investigar reset/delete/fork/troca de provider ou modelo.
- `tool-start-without-end`: tool iniciou e nao completou no trace.
- `system-prompt-changed`: hashes de system prompt mudaram entre turns.

Golden path SDE para "agent viu a mensagem mas nao respondeu":

1. `otto sessions trace <name> --since 2h --explain`
2. `otto sessions trace <name> --message <source_message_id> --explain`
3. `otto sessions trace <name> --turn <turn_id> --explain`

Classifique pela ultima linha confiavel:

- sem `channel.message.received`: inbound nao chegou ou janela/sessao errada.
- `channel.message.received` sem `route.resolved`: routing/contact resolution.
- `route.resolved` sem `prompt.published`: publish no stream da sessao.
- `prompt.published` sem `adapter.request`: dispatch, task barrier, debounce, concorrencia ou runtime startup.
- `adapter.request` sem terminal turn: provider/runtime apos handoff.
- `session.stalled`: trace histórico do watchdog removido; se aparecer em evento novo, há daemon antigo rodando.
- `assistant.message` sem `response.emitted`: resposta silenciosa, suppressao ou interrupcao.
- `response.emitted` sem `delivery.*`: gateway/outbound observation.
- `delivery.failed` / `delivery.dropped`: entrega final no canal.

Para abort/context loss, procure `session.abort`, `session.timeout`,
`turn.interrupted`, `provider_session_id_before`, `provider_session_id_after` e
hash de system prompt. `resume=false` com provider session id existente e
suspeito, exceto se reset/delete/fork/troca de provider/modelo/capability
explicar.

Use placeholders em runbooks e issues (`<name>`, `<turn_id>`, `<message_id>`).
Nao cole telefones reais, ids de grupo/chat, prompts de cliente, context keys,
tokens ou provider session ids em documentacao compartilhada.

## Notas

- **Reset vs Delete**: `reset` limpa a conversa mas mantém nome/routing/config. `delete` remove a sessão inteira.
- **Session names**: nomes canonicos unicos usados em routing, historico e topicos NATS. Use um token sem espacos, pontos (`.`), `*` ou `>`. `sessions rename` muda esse nome canonico e atualiza rotas que apontavam para o nome antigo.
- **Display labels**: labels humanos vivem em `display_name`. Use `sessions set-display` para nomes com espaco, acentos ou contexto visual; isso nao altera routing nem historico.
- **Source automático**: Todos os comandos de comunicação incluem source (channel/chatId) automaticamente — o agent sabe onde responder.
- **`send` vs `inform`**: `send` é a opção mais geral e pode esperar resposta com `-w`; `inform` é fogo-e-esqueça explícito para contexto.
- **Isolamento de contexto**: `sessions read` deve recuperar apenas a sessão atual. Nunca use histórico de outro grupo/DM como fallback para responder uma sessão fria.
