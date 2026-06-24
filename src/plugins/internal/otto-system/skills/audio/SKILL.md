---
name: audio
description: |
  Gera áudio (TTS) via ElevenLabs. Use quando o usuário quiser:
  - Converter texto em fala
  - Gerar áudio narrado
  - Enviar mensagem de voz gerada
  - Criar podcast/narração
---

# Audio Generation (TTS)

Gera áudio a partir de texto usando ElevenLabs Text-to-Speech.

## Como usar

### Gerar áudio simples
```bash
otto audio generate "Olá, eu sou o Otto!"
```

### Com voz específica
```bash
otto audio generate "Hello world" --voice JBFqnCBsd6RMkjVDRZzb
```

### Com velocidade alterada
```bash
otto audio generate "Texto rápido" --speed 1.5
```

### Com idioma forçado
```bash
otto audio generate "Bom dia a todos" --lang pt
```

### Gerar e enviar direto no chat
```bash
otto audio generate "Mensagem de voz" --send
```

### Com caption custom ao enviar
```bash
otto audio generate "Conteúdo importante" --send --caption "Escuta isso"
```

### Modelo turbo (mais rápido, menos expressivo)
```bash
otto audio generate "Quick response" --model eleven_turbo_v2_5
```

### Salvar em diretório específico
```bash
otto audio generate "Narração" -o /tmp/audios
```

## Opções

| Flag | Descrição | Default |
|------|-----------|---------|
| `--voice <id>` | Voice ID do ElevenLabs | env `ELEVENLABS_VOICE_ID` ou default |
| `--model <model>` | `eleven_multilingual_v2`, `eleven_turbo_v2_5` | `eleven_multilingual_v2` |
| `--speed <speed>` | Velocidade 0.5-2.0 | `1.0` |
| `--lang <code>` | Idioma ISO 639-1 (`pt`, `en`, `es`) | auto-detect |
| `--format <fmt>` | `mp3_44100_128`, `mp3_22050_32`, `pcm_16000` | `mp3_44100_128` |
| `-o, --output <dir>` | Diretório de saída | `/tmp` |
| `--send` | Envia pro chat automaticamente | `false` |
| `--caption <text>` | Caption ao enviar (com `--send`) | início do texto |

## Retorno

O comando retorna o path do áudio gerado + o comando pra enviar:
```
✓ Audio saved: /tmp/otto-audio-1234567890.mp3
  Send to chat: otto media send "/tmp/otto-audio-1234567890.mp3"
```

Se usar `--send`, o Otto entrega direto via `omni send` em vez de só publicar um evento interno. O retorno passa a refletir ack/erro real da entrega e preserva thread/topic quando existir no contexto.

## Fluxo recomendado

1. Rode `otto audio generate "texto"` — gera o MP3
2. Se precisa enviar pro chat, use `--send` ou copie o comando `otto media send` do output
3. Pra português, use `--lang pt` pra melhor pronúncia

## Limitações

- Requer `ELEVENLABS_API_KEY` no `~/.otto/.env`
- Textos muito longos podem demorar
- Voices customizadas precisam do voice ID específico

## Configuração

- `ELEVENLABS_API_KEY` — obrigatória, no `~/.otto/.env`
- `ELEVENLABS_VOICE_ID` — voice padrão (opcional)
