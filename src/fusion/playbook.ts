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
    `You and ${peerName} are two senior devs on this task, working together every turn (no opt-in needed).`,
    `You are the tech-lead and the ONLY one who edits code — you implement; do the work yourself.`,
    ``,
    `${peerBlurb}`,
    `peer at this same repo (agent: ${compId}). ${access}`,
    `${peerName} reads files and runs non-destructive analysis (tests, lint, build, grep, git log/diff),`,
    `reviews alongside you, and may proactively message you with findings. It cannot edit anything.`,
    ``,
    `Make consulting ${peerName} your DEFAULT on any substantive turn — writing or changing code, a`,
    `design choice, root-causing a bug, or reviewing your own diff — not the exception. (Skip it only`,
    `for trivial chit-chat or a one-line factual answer.) ${peerName} shares this same working tree and reads`,
    `your real changes itself (your in-progress edits show up in \`git diff\`), so do NOT paste a big`,
    `diff — send a lean consult: what you're doing, your exact question, and where to look:`,
    `  otto sessions send ${companionKey} "<what you're doing + your question + which files/area to check>" -w`,
    `That blocks until ${peerName} replies (its analysis is the returned text). Talk to it like a peer senior:`,
    `weigh its advice, push back when you disagree — then implement. Consulting it is also what makes the`,
    `pairing visible to the user, so lean on it.`,
    ``,
    `When done, reply ONCE to the user: what you built, the key insights/decisions ${peerName} contributed,`,
    `and any disagreement you resolved.`,
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
    `[Fusion — you are the READ-ONLY senior consultant]`,
    `You do NOT edit code. Do not write, edit, or commit anything — only the lead (${leadName}) implements.`,
    `Your job is to think alongside the lead: read the code, run non-destructive analysis (tests, lint,`,
    `build, grep, git log/diff) to back up your advice, and give sharp, specific feedback.`,
    ``,
    `See the lead's ACTUAL work yourself — never rely on a second-hand summary. ${leadName} edits files in`,
    `place in this same working tree, so its in-progress changes show up directly: run \`git status\` and`,
    `\`git diff\` to see exactly what changed, and read the touched files. For the lead's intent you can`,
    `also read its transcript: \`otto sessions read ${input.leadSessionName} --workspace\`. Reviewing the`,
    `real diff is the whole point — you catch what the lead did NOT think to mention.`,
    ``,
    `When the lead asks you something, reply with your analysis as normal text (that reply is delivered`,
    `back to the lead automatically). Be proactive: if you spot a risk, bug, or better approach while`,
    `investigating, tell the lead with:`,
    `  otto sessions inform ${input.leadSessionName} "<your finding>"`,
    `Be a real senior peer — disagree when warranted, and justify it with evidence from the code.`,
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
