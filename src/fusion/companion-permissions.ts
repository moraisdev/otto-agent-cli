/**
 * REBAC profile for the read-only fusion peer companion.
 *
 * Fusion is symmetric, so the peer runs whichever provider is NOT the principal:
 *  - **Codex peer**: its only surface is the shell — the Claude-SDK tools
 *    (Read/Grep/Glob/…) DO NOT EXIST for it, so granting `use tool:Read` is a
 *    no-op. What gates it is the Bash executable allowlist enforced by the "otto
 *    codex bash permission gate" (PreToolUse hook): each command's executable is
 *    checked as `execute executable:<name>`.
 *  - **Claude peer**: reviews via the Claude-SDK read tools (Read/Grep/Glob/…),
 *    so those ARE granted; without them every review turn would hit the tool
 *    permission gate and emit audit-denied noise.
 *
 * Both get `use tool:Bash` + the read-only executable allowlist (run tests, grep,
 * git read, etc.). Neither is ever granted Write/Edit/NotebookEdit — the lead is
 * the only editor.
 */

import type { FusionProvider } from "./state.js";

export interface CompanionGrant {
  relation: string;
  objectType: string;
  objectId: string;
}

/** Tools the companion must NEVER be granted (reference/constraint). */
export const DENIED_FOR_COMPANION = ["tool:Write", "tool:Edit", "tool:NotebookEdit"];

/** Read-only Claude-SDK tools a Claude peer needs to review natively (no Write/Edit). */
const COMPANION_READONLY_SDK_TOOLS = ["Read", "Grep", "Glob", "WebFetch", "WebSearch"];

/**
 * Read-only / non-destructive executables the Codex companion needs to actually
 * investigate (the diagnosis: rg/git/sed were denied so it couldn't do its job).
 * Mutating shells (cp/mv/mkdir/touch/rm/tee) are deliberately excluded.
 */
const COMPANION_EXECUTABLES = [
  "rg",
  "grep",
  "find",
  "cat",
  "ls",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "stat",
  "file",
  "diff",
  "jq",
  "yq",
  "cut",
  "tr",
  "awk",
  "sed",
  "git",
  "bun",
  "node",
  // `otto` is not purely read-only, but the peer needs it for two non-editing
  // jobs: `otto sessions read` (see the lead's real work) and `otto sessions
  // inform` (proactively flag findings). Code-edit safety is enforced separately
  // (no Write/Edit grant + the lead is the only editor), not by this allowlist.
  "otto",
];

/**
 * Build the peer companion's grant set: `use tool:Bash` + the read-only executable
 * allowlist, plus — for a Claude peer — the read-only Claude-SDK tools it reviews
 * with. Never grants Write/Edit. Defaults to the Codex peer profile.
 */
export function buildCompanionReadOnlyGrants(peerProvider: FusionProvider = "codex"): CompanionGrant[] {
  const grants: CompanionGrant[] = [{ relation: "use", objectType: "tool", objectId: "Bash" }];
  // A Claude peer reviews via the SDK read tools; a Codex peer has no SDK tools
  // (shell only), so granting them would be a no-op for it.
  if (peerProvider === "claude") {
    for (const tool of COMPANION_READONLY_SDK_TOOLS) {
      grants.push({ relation: "use", objectType: "tool", objectId: tool });
    }
  }
  for (const exec of COMPANION_EXECUTABLES) {
    grants.push({ relation: "execute", objectType: "executable", objectId: exec });
  }
  return grants;
}
