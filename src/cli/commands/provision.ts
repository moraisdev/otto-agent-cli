/**
 * Provision Commands — production caller for the self-improvement provisioning loop.
 *
 * Wires the tested `provisionAgent` lib (src/learning/provisioning.ts) to a real,
 * admin-gated CLI command. Without `--confirm` it scaffolds the agent + grants and
 * prints the CAN/CANNOT scope summary (no route). With `--confirm` it activates the
 * route. Escalation capabilities are stripped by translateCapabilities.
 */

import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Group, Command, Arg, Option, Scope } from "../decorators.js";
import { provisionAgent, type ProvisionOps, type ProvisionResult } from "../../learning/provisioning.js";
import { isSenderAdmin } from "../../learning/admin-gate.js";
import type { Capability } from "../../learning/nl-to-rebac.js";
import { grantRelation } from "../../permissions/relations.js";
import { dbCreateAgent, dbGetAgent, dbCreateRoute } from "../../router/router-db.js";

export type { ProvisionOps };

const DEFAULT_ADMIN_SUBJECT = "agent:main";
const DEFAULT_ACCOUNT_ID = "default";

export interface ProvisionRunInput {
  agentId: string;
  instance: string;
  group: string;
  role: string;
  caps: string[];
  confirm: boolean;
  sender?: string;
}

export interface ProvisionRunResult {
  status: ProvisionResult["status"];
  result?: ProvisionResult;
}

/**
 * Parse a `--cap` value of the form `verb:target` into a Capability.
 * Splits on the FIRST colon only so targets keep their own colons
 * (e.g. `execute:executable:clickup` → { verb: "execute", target: "executable:clickup" }).
 */
export function parseCapability(raw: string): Capability {
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx === raw.length - 1) {
    throw new Error(`invalid --cap "${raw}" (expected verb:target, e.g. execute:executable:clickup)`);
  }
  return { verb: raw.slice(0, idx), target: raw.slice(idx + 1) };
}

/**
 * Parse a REBAC subject like `agent:main` into { type, id }, splitting on the first colon.
 */
function parseSubject(raw: string): { type: string; id: string } {
  const idx = raw.indexOf(":");
  if (idx < 0) return { type: raw, id: "" };
  return { type: raw.slice(0, idx), id: raw.slice(idx + 1) };
}

/**
 * Parse a REBAC object like `executable:clickup` into { objectType, objectId },
 * splitting on the first colon so the id keeps any further colons.
 */
function parseObject(raw: string): { objectType: string; objectId: string } {
  const idx = raw.indexOf(":");
  if (idx < 0) return { objectType: raw, objectId: "" };
  return { objectType: raw.slice(0, idx), objectId: raw.slice(idx + 1) };
}

/**
 * Testable core: resolves admin, parses capabilities, and runs provisionAgent
 * with the supplied ops. No global side effects beyond the provided ops.
 */
export async function runProvision(input: ProvisionRunInput, ops: ProvisionOps): Promise<ProvisionRunResult> {
  const sender = input.sender ?? DEFAULT_ADMIN_SUBJECT;
  const senderIsAdmin = isSenderAdmin(sender);
  if (!senderIsAdmin) {
    return { status: "denied" };
  }

  const capabilities = input.caps.map(parseCapability);

  const result = await provisionAgent({
    senderIsAdmin,
    agentId: input.agentId,
    instance: input.instance,
    groupPattern: input.group,
    role: input.role,
    capabilities,
    confirmed: input.confirm,
    ops,
  });

  return { status: result.status, result };
}

/**
 * Production ProvisionOps backed by the real router DB, REBAC relation store, and
 * filesystem. Each op preserves the idempotency contract documented in
 * provisioning.ts so a route retry reuses the scaffold safely.
 */
export function productionOps(): ProvisionOps {
  return {
    createAgent: async (id, cwd) => {
      // dbCreateAgent throws if the agent already exists; skip to stay idempotent.
      if (dbGetAgent(id)) return;
      dbCreateAgent({ id, cwd });
    },
    grant: async (subject, relation, object) => {
      // grantRelation upserts (ON CONFLICT no-op), so re-granting is idempotent.
      const s = parseSubject(subject);
      const o = parseObject(object);
      grantRelation(s.type, s.id, relation, o.objectType, o.objectId, "manual");
    },
    writeWorkspace: async (cwd, agentsMd) => {
      mkdirSync(cwd, { recursive: true });
      writeFileSync(join(cwd, "AGENTS.md"), agentsMd);
    },
    addRoute: async (_instance, pattern, agent) => {
      dbCreateRoute({ pattern, accountId: DEFAULT_ACCOUNT_ID, agent });
    },
  };
}

function printResult(run: ProvisionRunResult): void {
  if (run.status === "denied") {
    console.log("Denied: sender is not an admin (superadmin required).");
    return;
  }
  const result = run.result;
  if (!result) return;

  console.log("\nPODE:");
  for (const line of result.summary.can) console.log(`  + ${line}`);
  if (result.blocked.length) {
    console.log("\nNÃO PODE (escalada bloqueada):");
    for (const cap of result.blocked) console.log(`  - ${cap.verb} ${cap.target}`);
  }
  for (const line of result.summary.cannot) console.log(`  - ${line}`);

  switch (run.status) {
    case "awaiting_confirmation":
      console.log("\nAguardando confirmação: rode novamente com --confirm para ativar a rota.");
      break;
    case "activated":
      console.log("\nAtivado: agente provisionado e rota criada.");
      break;
    case "route_failed":
      console.log(
        `\nFalha na rota: agente provisionado, mas a ativação da rota falhou: ${result.error ?? "erro desconhecido"}`,
      );
      break;
  }
}

@Group({
  name: "provision",
  description: "Provision scoped agents from natural-language capabilities",
  scope: "superadmin",
})
export class ProvisionCommands {
  @Command({ name: "agent", description: "Provision a scoped agent and (with --confirm) activate its route" })
  @Scope("superadmin")
  async agent(
    @Arg("id", { description: "Agent ID to provision" }) id: string,
    @Option({ flags: "--instance <instance>", description: "Instance to route from" }) instance?: string,
    @Option({ flags: "--group <pattern>", description: "Group/route pattern to bind" }) group?: string,
    @Option({ flags: "--role <text>", description: "Role description written to AGENTS.md" }) role?: string,
    @Option({ flags: "--cap <verb:target...>", description: "Capability to grant (repeatable)" }) cap?: string[],
    @Option({ flags: "--confirm", description: "Activate the route (without this, only a dry-run summary is shown)" })
    confirm?: boolean,
    @Option({ flags: "--sender <subject>", description: "Sender subject used for admin authorization" })
    sender?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    if (!instance) throw new Error("--instance is required");
    if (!group) throw new Error("--group is required");
    if (!role) throw new Error("--role is required");

    const caps = Array.isArray(cap) ? cap : cap ? [cap] : [];

    const run = await runProvision(
      {
        agentId: id,
        instance,
        group,
        role,
        caps,
        confirm: confirm ?? false,
        sender,
      },
      productionOps(),
    );

    if (asJson) {
      console.log(JSON.stringify(run, null, 2));
    } else {
      printResult(run);
    }
    return run;
  }
}
