---
name: daemon-manager
description: |
  Controla o daemon do Otto. Use quando o usuário quiser:
  - Ver status do daemon
  - Reiniciar o daemon
  - Ver logs
  - Instalar/desinstalar serviço do sistema
---

# Daemon Manager

O daemon é o processo principal que roda o bot e os gateways.

## Comandos

### Status
```bash
otto daemon status
```

### Iniciar
```bash
otto daemon start
```

### Parar
```bash
otto daemon stop
```

### Reiniciar
```bash
otto daemon restart --message "Motivo do restart"
```

### Logs
```bash
otto daemon logs              # Últimas linhas
otto daemon logs --tail 50    # Últimas 50 linhas
otto daemon logs --follow     # Acompanhar em tempo real
otto daemon logs --clear      # Limpar logs
otto daemon logs --path       # Mostrar caminho do arquivo
```

### Modo Dev
```bash
otto daemon dev   # Rebuild automático ao editar código
```

### Serviço do Sistema

Instalar como serviço (inicia no boot):
```bash
otto daemon install
```

Desinstalar:
```bash
otto daemon uninstall
```

## Arquivos

- **Logs**: `~/.otto/logs/daemon.log`
- **PID**: gerenciado pelo launchd/systemd
- **Env**: `~/.otto/.env`

## Editar variáveis de ambiente
```bash
otto daemon env
```
