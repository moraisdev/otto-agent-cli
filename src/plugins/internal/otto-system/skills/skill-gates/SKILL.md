---
name: skill-gates
description: |
  Gerencia os skill gates do Otto. Use quando precisar:
  - Entender por que uma tool carrega uma skill automaticamente
  - Listar regras default e overrides de skill gates
  - Criar novas regras para tools, grupos ou comandos shell
  - Sobrescrever, desativar ou resetar gates existentes
  - Usar o CLI `otto skill-gates`
---

# Skill Gates

Skill gates fazem uma chamada de tool falhar de forma controlada quando a sessão ainda não carregou a skill necessária. A falha entrega o conteúdo da skill, marca a skill como carregada na sessão e pede retry da tool original.

## CLI

Use `otto skill-gates` para gerenciar regras. Não edite JSON em settings.

```bash
otto skill-gates list
otto skill-gates show image
otto skill-gates set image otto-system-image
otto skill-gates disable image
otto skill-gates reset image
```

## Regras

Existem dois níveis:

- Defaults em código: cobrem grupos Otto conhecidos, como `image`, `tasks`, `sessions`, `skill-gates`.
- Overrides no DB: tabela `skill_gate_rules`, usada para criar regras novas, sobrescrever defaults ou desativar defaults.

Um override com o mesmo `id` de um default muda esse default. Exemplo:

```bash
otto skill-gates set image minha-skill-image
```

Para desativar um default:

```bash
otto skill-gates disable image
```

Para remover o override e voltar ao default:

```bash
otto skill-gates reset image
```

## Criar Regra Customizada

Regras customizadas precisam de matcher explícito.

```bash
otto skill-gates set linear linear-skill --pattern '^linear(?:[._]|$)'
otto skill-gates set lookup lookup-skill --tool external_lookup
otto skill-gates set github github --command-prefix 'gh issue'
```

Matchers disponíveis:

- `--pattern <regex>`: regex contra grupo/tool normalizado.
- `--group-regex <regex>`: alias semântico de `--pattern`.
- `--tool <name>`: nome exato da runtime tool.
- `--tool-prefix <prefix>`: prefixo de runtime tool.
- `--tool-regex <regex>`: regex contra runtime tool.
- `--command <command>`: comando shell exato.
- `--command-prefix <prefix>`: prefixo de comando shell.
- `--command-regex <regex>`: regex contra comando shell bruto.

## Comportamento no Runtime

O runtime consulta a tabela `skill_gate_rules` a cada resolução de gate e combina com os defaults em código. Ordem prática:

1. Regras configuradas com matcher direto podem forçar ou desativar um gate.
2. Overrides por `id` alteram ou desativam defaults.
3. Se nada configurado casar, os defaults em código continuam valendo.

Comandos de introspecção e carregamento de skills ficam isentos para evitar deadlock, como `otto skills show`, `otto tools list` e `otto sessions visibility`.
