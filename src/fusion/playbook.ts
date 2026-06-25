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
    `reviews alongside you, and proactively messages you with findings. It cannot edit anything.`,
    ``,
    `${peerName} works CONCURRENTLY — it is NOT on your critical path, so do NOT block waiting on it. It`,
    `automatically reviews each of your completed turns in the background and sends findings (risks, bugs,`,
    `better approaches) as \`[System] Inform\` messages. Work at full speed and finish the user's request;`,
    `when an \`[System] Inform\` from ${peerName} arrives, weigh it and fold it into your NEXT turn — fix the`,
    `issue, or push back with reasoning. It shares this working tree and reads your real \`git diff\` itself,`,
    `so its review is grounded in your actual changes (no need to paste diffs at it).`,
    ``,
    `You MAY still ask ${peerName} a direct question when you genuinely need its input BEFORE proceeding (a`,
    `hard design fork, a second opinion on a risky change) — but keep it the EXCEPTION, rare and lean:`,
    `  otto sessions send ${companionKey} "<lean question + which files/area to check>" -w --timeout 60`,
    `Prefer to keep moving and let the async review catch things, rather than blocking on a synchronous`,
    `consult. If a consult times out or errors, do NOT retry it in a loop — note it and proceed solo.`,
    ``,
    `When done, reply ONCE to the user: what you built, and any ${peerName} findings you incorporated.`,
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
    `Stay FOCUSED and time-boxed: the lead is blocked waiting on your reply with a finite budget it picked`,
    `from the question (~30s quick, ~90s normal, ~180s deep). Treat that as a hard cap: a fast, specific`,
    `answer beats a thorough-but-late one. Run a handful of high-signal, targeted commands — NOT an`,
    `exhaustive sweep or a long loop of shell calls. As soon as you have enough to answer, STOP investigating`,
    `and reply. If a question genuinely needs more than the budget allows, say so up front and answer with`,
    `what you have rather than letting the consult time out.`,
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
