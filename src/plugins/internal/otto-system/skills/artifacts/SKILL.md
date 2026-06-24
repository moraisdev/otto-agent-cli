---
name: artifacts
description: |
  Gerencia o ledger genérico de artifacts do Otto. Use quando precisar:
  - Registrar outputs reutilizáveis de qualquer parte do Otto
  - Encontrar de onde um artifact veio e quais metadados e métricas ele carregou
  - Editar metadata, anexar artifacts a tasks/sessões/projetos ou arquivar artifacts
  - Auditar lineage de imagens, reports, traces, documentos, tool outputs e mensagens
---

# Otto Artifacts

`otto artifacts` é o ledger genérico de artefatos do Otto.

Ele registra o arquivo bruto, metadata, métricas, lineage e relações com sessão/task/canal para que um artifact possa ser auditado, encontrado e reutilizado depois.

## Criar Artifact

```bash
otto artifacts create \
  --title "Diagrama Otto Artifacts" \
  --path /tmp/diagram.png \
  --kind image \
  --provider openai \
  --model gpt-image-2 \
  --duration-ms 32000 \
  --total-tokens 1722 \
  --metadata '{"quality":"auto","format":"png"}' \
  --lineage '{"source":"otto image generate"}'
```

## Listar

```bash
otto artifacts list
otto artifacts list --kind image
otto artifacts list --session dev --limit 50 --offset 0
otto artifacts list --task task-123 --json
otto artifacts list --rich --json --limit 50 --offset 0
```

Listagens seguem o contrato padrao de paginacao do Otto:

- `total`: total filtrado no ledger, nao apenas a pagina atual
- `pagination.limit`: tamanho da pagina aplicada
- `pagination.offset`: posicao inicial da pagina
- `pagination.returned`: itens retornados nesta pagina
- `pagination.hasMore`: se existe proxima pagina
- `pagination.nextCommand`: comando pronto para a proxima pagina quando existir
- `items`: lista canonica para agentes consumirem
- `artifacts`: alias de compatibilidade

Para agentes: nunca assuma que `items.length` e o universo completo. Use
`pagination.total`/`pagination.hasMore` e execute `pagination.nextCommand`
quando precisar continuar.

## Ver Detalhes

```bash
otto artifacts show art_xxx --json
```

Mostra:
- artifact principal
- links com tasks/sessões/mensagens/projetos
- eventos de criação/edição/anexo/archive

## Timeline / Lifecycle

Artifacts também podem representar geração assíncrona em andamento.

Estados principais:
- `pending`
- `running`
- `completed`
- `failed`
- `archived`

Ver timeline ordenada:

```bash
otto artifacts events art_xxx --json
```

Adicionar evento manual/recovery:

```bash
otto artifacts event art_xxx failed \
  --status failed \
  --message "provider timeout" \
  --source "manual-recovery" \
  --payload '{"reason":"timeout"}'
```

## Editar Metadata

```bash
otto artifacts update art_xxx \
  --summary "Versão aprovada pelo Luís" \
  --metadata '{"approved":true,"reviewedBy":"pedro"}'
```

`--metadata`, `--metrics` e `--lineage` fazem merge com os dados existentes.

## Anexar a Outro Objeto

```bash
otto artifacts attach art_xxx task task-123 --relation evidence
otto artifacts attach art_xxx session dev --relation generated-in
```

## Arquivar

```bash
otto artifacts archive art_xxx
```

Archive é soft-delete: o artifact sai da listagem padrão, mas continua consultável com `--include-deleted`.

## Integração Atual

`otto image generate` registra automaticamente artifacts `kind=image` usando lifecycle.
`otto image atlas split` registra um artifact `kind=image.atlas.split` para o
manifest e um artifact `kind=image.crop` para cada crop derivado.

O registro inclui:
- path original e cópia no blob store local
- sha256 e tamanho
- provider, model, prompt e comando
- sessão, agent e canal quando houver contexto Otto
- duração da geração
- tokens/usage quando o provider retorna
- input/output estruturados
- metadata e lineage básicos
- provenance de atlas/crop: grid, posição, parent artifact e split artifact

Para geração longa, prefira:

```bash
otto image generate "prompt" --provider openai --model gpt-image-2 --json
```

Isso retorna imediatamente `artifact_id`, `status` e comando `watch`. O worker
atualiza eventos até `completed` ou `failed`. Quando existe contexto de chat,
a mídia gerada é enviada automaticamente para o chat de origem; não faça polling
por padrão, use `watch/events` só para inspeção manual/debug.

## Regra de Provider

Artifacts não fazem fallback de provider.

Se uma geração falha, ela falha. Para tentar outro provider, rode explicitamente outro comando com `--provider`.
