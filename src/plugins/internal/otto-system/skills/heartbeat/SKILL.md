---
name: heartbeat-manager
description: |
  Gerencia heartbeat dos agents. Use quando o usuário quiser:
  - Configurar check-ins periódicos para agents
  - Ativar/desativar heartbeat
  - Definir intervalo e horários ativos
  - Disparar heartbeat manualmente
---

# Heartbeat Manager

Heartbeat são check-ins periódicos que um agent faz. O agent lê o arquivo HEARTBEAT.md do seu workspace e executa as instruções.

## Como Funciona

1. Agent tem heartbeat habilitado com intervalo (ex: 30min)
2. A cada intervalo, o daemon envia prompt pro agent
3. Agent lê HEARTBEAT.md e executa (ex: verificar pendências, enviar resumo)

## Comandos

### Ver status de todos
```bash
otto heartbeat status
```

### Ver config de um agent
```bash
otto heartbeat show <agent>
```

### Habilitar heartbeat
```bash
otto heartbeat enable <agent>
otto heartbeat enable <agent> 30m    # Com intervalo
```

### Desabilitar heartbeat
```bash
otto heartbeat disable <agent>
```

### Configurar propriedades
```bash
otto heartbeat set <agent> interval 1h          # Intervalo
otto heartbeat set <agent> model haiku          # Modelo (economia)
otto heartbeat set <agent> active-hours 09:00-22:00  # Horário ativo
otto heartbeat set <agent> active-hours always  # Sempre ativo
```

### Disparar manualmente
```bash
otto heartbeat trigger <agent>
```

## Arquivo HEARTBEAT.md

Cada agent precisa ter um `HEARTBEAT.md` no seu workspace com instruções do que fazer no check-in.

Exemplo:
```markdown
# Heartbeat - Check-in Periódico

## O Que Verificar
- Tarefas pendentes
- Erros recentes nos logs
- Mensagens não respondidas

## Quando Notificar
- Se algo importante ficou pendente
- Se um processo crashou
- Se há muito tempo sem interação

## Como Notificar
Use sessions inform para enviar mensagem:
otto sessions inform <session-name> "mensagem"
```

## Exemplos

Configurar heartbeat básico:
```bash
otto heartbeat enable main 30m
```

Heartbeat só em horário comercial:
```bash
otto heartbeat enable main 1h
otto heartbeat set main active-hours 09:00-18:00
```

Usar modelo mais barato:
```bash
otto heartbeat set main model haiku
```

Testar configuração:
```bash
otto heartbeat trigger main
otto daemon logs -f
```
