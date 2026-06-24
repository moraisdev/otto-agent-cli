import { translateCapabilities, type Capability, type ScopeSummary } from "./nl-to-rebac.js";

export interface ProvisionOps {
  createAgent: (id: string, cwd: string) => Promise<void>;
  grant: (subject: string, relation: string, object: string) => Promise<void>;
  writeWorkspace: (cwd: string, agentsMd: string) => Promise<void>;
  addRoute: (instance: string, pattern: string, agent: string) => Promise<void>;
}

export interface ProvisionInput {
  senderIsAdmin: boolean;
  agentId: string;
  instance: string;
  groupPattern: string;
  role: string;
  capabilities: Capability[];
  confirmed: boolean;
  ops: ProvisionOps;
}

export interface ProvisionResult {
  status: "denied" | "awaiting_confirmation" | "activated" | "route_failed";
  summary: ScopeSummary;
  blocked: Capability[];
  error?: string;
}

export async function provisionAgent(input: ProvisionInput): Promise<ProvisionResult> {
  if (!input.senderIsAdmin) return { status: "denied", summary: { can: [], cannot: [] }, blocked: [] };

  const { grants, blocked, summary } = translateCapabilities(input.agentId, input.capabilities);
  const cwd = `~/otto/${input.agentId}`.replace("~", process.env.HOME ?? "~");

  // passos 2-4: scaffold + REBAC mínimo + workspace.
  // Idempotente por design: createAgent (deve pular se o agente já existir),
  // writeWorkspace (overwrite determinístico do mesmo conteúdo) e grant
  // (INSERT OR IGNORE) são seguros de repetir. Por isso uma retentativa após
  // uma falha de rota reaproveita o scaffold sem efeitos colaterais e não
  // precisamos de rollback de agente/grants.
  await input.ops.createAgent(input.agentId, cwd);
  await input.ops.writeWorkspace(
    cwd,
    `# ${input.agentId}\n\n${input.role}\n\nVocê NÃO pode fazer nada além do escopo concedido.`,
  );
  for (const g of grants) await input.ops.grant(g.subject, g.relation, g.object);

  // passo 5-6: confirmação antes de rotear
  if (!input.confirmed) return { status: "awaiting_confirmation", summary, blocked };

  // passo 7: ativar rota. Se addRoute falhar após a confirmação, o scaffold já
  // existe (idempotente), mas a ativação não ocorreu. Não propagamos o erro
  // silenciosamente: sinalizamos route_failed para o caller decidir
  // (retentar / alertar) em vez de deixar um estado parcial sem aviso.
  try {
    await input.ops.addRoute(input.instance, input.groupPattern, input.agentId);
  } catch (err) {
    return { status: "route_failed", summary, blocked, error: err instanceof Error ? err.message : String(err) };
  }
  return { status: "activated", summary, blocked };
}
