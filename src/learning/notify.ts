import type { LearningDecision } from "./types.js";

export type ProposalSender = (message: string) => Promise<void>;

/**
 * Builds the human-facing proposal message for a deferred skill/command
 * decision. Pure function — no side effects.
 */
export function buildProposalMessage(decision: LearningDecision, stagedId: string): string {
  const kind = decision.route === "command" ? "comando" : "skill";
  const lines = [
    `Criei um novo ${kind}: *${decision.title}*`,
    "",
    decision.reason ? `Motivo: ${decision.reason}` : null,
    "",
    "O que faz:",
    decision.body.trim() || "(sem descrição)",
    "",
    `Para ativar, responda 'aprova' ou rode: otto learning approve ${stagedId}`,
    `Para descartar: otto learning reject ${stagedId} --reason <motivo>`,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

/**
 * Sends a proposal through an injected sender. The sender is kept abstract so
 * this stays testable and decoupled from any concrete channel/transport.
 */
export async function sendProposal(
  sender: ProposalSender,
  decision: LearningDecision,
  stagedId: string,
): Promise<void> {
  await sender(buildProposalMessage(decision, stagedId));
}
