---
name: agent-provisioning
description: |
  Use quando um usuário ADMIN descreve, num grupo, um papel restrito para a Otto
  e diz que ela "não pode fazer nada além disso". Cria um agente dedicado para
  aquele grupo com permissões mínimas e roteia o grupo para ele após confirmação.
---

# Agent Provisioning

## Trigger
Um sender admin emite uma declaração de papel + cláusula de restrição.

## Workflow (7 passos)
1. Confirmar que o sender é admin (senão, recusar educadamente).
2. Parse: nome do agente, propósito, capacidades (verbo+alvo), limite explícito.
3. Traduzir capacidades em grants REBAC MÍNIMOS (closed-by-default). Nunca conceder
   admin, group:permissions, group:agents, group:instances, system:*.
4. Criar agente: `otto agents create <id> ~/otto/<id>`; escrever AGENTS.md com o papel;
   `mode sentinel` se for só observar.
5. Aplicar grants: `otto permissions grant agent:<id> <relation> <object>` (só os mínimos).
6. Mostrar resumo: "Agente <id> — PODE: ... NÃO PODE: o resto. Confirma?".
7. Após "sim": `otto instances routes add <instance> <group:pattern> <id>`.

## Validation
- Rota só é criada após confirmação explícita.
- Se o grupo já tem agente dedicado, atualizar o existente em vez de criar outro.
- Registrar tudo (lineage no insights DB).

## Non-goals
- Não conceder permissões de escalada.
- Não provisionar a partir de sender não-admin.
- Não permitir que o agente provisionado provisione outros agentes.
