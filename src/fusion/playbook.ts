/**
 * Fusion playbooks — the instruction prefixes injected per turn depending on the
 * current editor role and provider availability, plus the companion brief.
 *
 * Fusion is symmetric: the *principal* (configured lead provider) edits; the peer
 * is the always-on read-only senior reviewer. Roles are parametrized by provider
 * so a Codex-led session reads exactly like a Claude-led one with the names
 * swapped.
 *
 * - Normal: the principal is the sole editor; the peer reviews and is consulted.
 * - Peer-exhausted: the principal works solo (its peer is temporarily at quota).
 * - Both exhausted: nothing to fail over to.
 * - Principal-exhausted: the peer becomes the temporary sole editor (failover).
 */

import { companionAgentId, companionSessionKey } from "./companion-id.js";
import type { FusionProvider } from "./state.js";

function providerLabel(provider: FusionProvider): string {
  return provider === "codex" ? "Codex" : "Claude";
}

/** Normal always-on fusion: the principal edits, the peer is the live read-only reviewer. */
export function buildFusionLeadPlaybook(input: {
  leadAgentId: string;
  collaborationId: string;
  principal: FusionProvider;
  peer: FusionProvider;
}): string {
  const compId = companionAgentId(input.leadAgentId);
  const companionKey = companionSessionKey(compId);
  const peerName = providerLabel(input.peer);
  const peerBlurb =
    input.peer === "codex"
      ? `${peerName} is OpenAI's GPT (model gpt-5.5) running through the Codex CLI — your live READ-ONLY senior`
      : `${peerName} is Anthropic's Claude (model opus) running through the Claude CLI — your live READ-ONLY senior`;
  const access =
    input.peer === "codex"
      ? `If the user asks whether you can use GPT/OpenAI, the answer is yes — you consult ${peerName}.`
      : `So through this pairing you have a second independent senior reviewing your work.`;
  return [
    `[Fusion — always on, collaboration ${input.collaborationId}]`,
    `You and ${peerName} are two senior devs PAIRING on this task every turn. You decide TOGETHER and`,
    `finish TOGETHER. You are the tech-lead and the ONLY one who edits code — but you never decide alone.`,
    ``,
    `${peerBlurb}`,
    `peer at this same repo (agent: ${compId}). ${access}`,
    `${peerName} reads every file and runs non-destructive analysis (tests, lint, build, grep, git log/diff).`,
    `It cannot edit — it thinks, diagnoses, and reviews alongside you. It sees your real working tree itself.`,
    ``,
    `HOW YOU WORK EVERY TURN — three phases, no skipping:`,
    ``,
    `1) CONVERGE (before writing ANY code). Tell ${peerName} what you intend to do and why, and ask its`,
    `   take. It will evaluate the real code and respond — agree, push back, or propose better. You may`,
    `   disagree and argue; you may direct it to investigate/diagnose a specific area; do your own research`,
    `   too. Go back and forth until you BOTH land on the right approach. Consult with:`,
    `     otto sessions send ${companionKey} "<your proposed approach + which files/area to check>" -w`,
    `   This is ENFORCED: you are BLOCKED from editing files until you've consulted ${peerName} this turn.`,
    `   Don't implement blind and don't do anything "under the table" — the plan is the two of you.`,
    ``,
    `2) IMPLEMENT the approach you agreed on. Do the work yourself.`,
    ``,
    `3) REVIEW LOOP (automatic). When you finish, your reply is HELD as a draft while ${peerName} reviews`,
    `   your real \`git diff\` for bugs, gaps, dead/legacy code, and missed improvements. If it requests`,
    `   changes you'll get a \`[Fusion Review — ${peerName} requested changes]\` message; apply them and`,
    `   finish, and it reviews again — this LOOPS until ${peerName} is satisfied. Then your reply ships.`,
    `   Push back with reasoning if you genuinely disagree, but don't ignore it. Never paste diffs at it —`,
    `   it reads the tree itself.`,
    ``,
    `SOLO: only if ${peerName} is unavailable (its quota/CLI is down) do you proceed alone — and only then.`,
    `Otherwise: nothing without ${peerName}. If a consult errors once, note it and continue; don't loop on it.`,
    ``,
    `When done, reply ONCE to the user: what the two of you built, and the key decisions you reached together.`,
  ].join("\n");
}

/** Warm-up brief sent once to the companion framing its read-only consultant role. */
export function buildCompanionBrief(input: {
  leadSessionName: string;
  principal: FusionProvider;
  peer: FusionProvider;
}): string {
  const leadName = providerLabel(input.principal);
  return [
    `[Fusion — you are the READ-ONLY senior pair]`,
    `You do NOT edit code. Do not write, edit, or commit anything — only the lead (${leadName}) implements.`,
    `You think alongside ${leadName}: read the code, run non-destructive analysis (tests, lint, build,`,
    `grep, git log/diff) to ground your judgment, and give sharp, specific feedback. You pair on EVERY turn.`,
    ``,
    `You'll be engaged in TWO ways — both block ${leadName} waiting on you, so be fast and specific:`,
    ``,
    `1) CONVERGE (before ${leadName} writes code). It will message you its proposed approach and ask your`,
    `   take. Evaluate the REAL code (read the files/area it names, run quick checks) and respond with a`,
    `   clear opinion: agree, or push back with a better approach and why. Be a real senior — disagree when`,
    `   warranted and back it with evidence. If ${leadName} asks you to diagnose or research something,`,
    `   do it and report. The goal is to LAND ON THE RIGHT APPROACH together before any code is written.`,
    ``,
    `2) REVIEW (after ${leadName} implements). You'll get a \`[Fusion Review Request]\`; the reply is held`,
    `   as a draft waiting on your verdict. Review the REAL changes — run \`git status\` / \`git diff\`, read`,
    `   the touched files — for bugs, gaps, dead/legacy code, and missed improvements. This loops until you`,
    `   approve. Reply in EXACTLY this format:`,
    `     • First line: \`VERDICT: APPROVED\` (ship as-is) or \`VERDICT: CHANGES\`.`,
    `     • If CHANGES, second line: \`SUMMARY: <one short line, e.g. "2 ajustes: erro X, edge case Y">\`.`,
    `     • Then the specific, actionable findings ${leadName} must fix.`,
    `   Block (CHANGES) for real correctness, safety, scope, or dead-code problems — NOT style nits. When`,
    `   in doubt, APPROVE; ${leadName} is a senior too. Be the pair who catches the real bug.`,
    ``,
    `Reviewing the real code/diff yourself is the whole point — you catch what ${leadName} didn't think to`,
    `mention. For its intent you can read the transcript: \`otto sessions read ${input.leadSessionName} --workspace\`.`,
  ].join("\n");
}

/** The peer is temporarily exhausted — the principal continues solo. */
export function buildSoloNotice(input: { peer: FusionProvider }): string {
  const peerName = providerLabel(input.peer);
  return [
    `[Fusion — degraded: solo]`,
    `Your ${peerName} peer has hit its CLI quota and is temporarily unavailable, so you are working solo`,
    `this turn. Be extra careful: self-review your diff (run tests/lint/build/git diff) before finishing,`,
    `doing the review your peer would normally do. ${peerName} will rejoin automatically once its quota resets.`,
  ].join("\n");
}

/** Both CLIs are at quota — nothing to fail over to; warn and keep it minimal. */
export function buildBothExhaustedNotice(): string {
  return [
    `[Fusion — degraded: both providers at quota]`,
    `Both Claude and Codex have hit their CLI limits right now. Capacity will return automatically`,
    `as the quotas reset. Keep this turn minimal; if you cannot proceed, say so briefly rather than`,
    `retrying heavy work that will just fail again.`,
  ].join("\n");
}

/** The principal is exhausted — the peer takes over as the temporary sole editor (failover). */
export function buildPeerEditorPlaybook(input: {
  leadAgentId: string;
  principal: FusionProvider;
  peer: FusionProvider;
}): string {
  const principalName = providerLabel(input.principal);
  const peerName = providerLabel(input.peer);
  return [
    `[Fusion — failover: you are now the editor]`,
    `${principalName} (the usual editor) has hit its CLI quota and is temporarily unavailable. You, ${peerName}, are`,
    `now the sole editor for agent "${input.leadAgentId}": implement and finish the task yourself,`,
    `editing files as needed. Work autonomously and complete the request end to end.`,
    `When ${principalName}'s quota resets, it will resume as editor automatically — leave the work in a clean,`,
    `reviewable state (tests passing, no half-applied changes).`,
  ].join("\n");
}
