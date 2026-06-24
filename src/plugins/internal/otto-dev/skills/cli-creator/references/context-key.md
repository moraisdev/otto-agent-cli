# Context Key

Use esta referencia quando o CLI rodar dentro do runtime do Otto.

## Regra Principal

Para CLIs externos, a interface canonica e:

- `otto context issue`
- `OTTO_CONTEXT_KEY`
- `otto context whoami`
- `otto context check`
- `otto context authorize`

Nao use:

- `OTTO_AGENT_ID`
- `OTTO_SESSION_KEY`
- `OTTO_SESSION_NAME`

## Fluxo Canonico

### 1. Processo pai emite contexto-filho

```bash
otto context issue meu-cli --allow execute:group:daemon --ttl 1h
```

Boas praticas:

- `cliName` estavel
- capability minima necessaria
- TTL curto por default
- `--inherit` so com motivo claro

### 2. Processo filho recebe apenas a key

```bash
OTTO_CONTEXT_KEY=<valor emitido>
```

Essa e a unica credencial Otto que o processo filho precisa.

### 3. CLI resolve identidade

```bash
otto context whoami
```

Campos importantes:

- `contextId`
- `agentId`
- `sessionKey`
- `sessionName`
- `source`
- `metadata`

### 4. CLI valida e pede approval

```bash
otto context check execute group daemon
otto context authorize execute group daemon
```

Interpretacao correta:

- `allowed=true, inherited=true` -> capability herdada
- `allowed=true, approved=true` -> approval novo concedido
- `allowed=false` -> negado, timeout ou fora da policy

## Lineage e Auditoria

O CLI deve permitir ou ensinar suporte a usar:

- `otto context list`
- `otto context info <contextId>`
- `otto context revoke <contextId>`

Lineage esperado:

- `parentContextId`
- `parentContextKind`
- `issuedFor`
- `issuedAt`
- `issuanceMode`

## Sinais de Implementacao Ruim

Pare e corrija se encontrar:

- export de ids de sessao para "simular" contexto
- CLI executando a acao real sem `check`/`authorize`
- logs imprimindo `contextKey`
- launcher pulando `otto context issue`

## Resultado Esperado

O CLI deve conseguir operar com least privilege, identidade correta e audit trail completo usando apenas `OTTO_CONTEXT_KEY`.
