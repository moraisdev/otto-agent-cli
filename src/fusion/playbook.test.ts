import { describe, expect, it } from "bun:test";
import {
  buildBothExhaustedNotice,
  buildCompanionBrief,
  buildFusionLeadPlaybook,
  buildPeerEditorPlaybook,
  buildSoloNotice,
} from "./playbook.js";

describe("fusion playbooks", () => {
  it("lead playbook names the companion session and the collaboration", () => {
    const p = buildFusionLeadPlaybook({
      leadAgentId: "main",
      collaborationId: "collab-9",
      principal: "claude",
      peer: "codex",
    });
    expect(p).toContain("collaboration collab-9");
    expect(p).toContain("agent:peer-companion-main:main");
    expect(p).toContain("ONLY one who edits");
    expect(p).toContain("Codex"); // the peer
  });

  it("lead playbook tells the lead to send a lean consult — the peer reads the diff itself", () => {
    // M0: the peer shares the tree and reads the real diff, so the lead no longer
    // hand-curates a big OBJETIVO/ARQUIVOS/DIFF envelope.
    const p = buildFusionLeadPlaybook({
      leadAgentId: "main",
      collaborationId: "collab-9",
      principal: "claude",
      peer: "codex",
    });
    expect(p).toContain("git diff");
    expect(p).not.toContain("OBJETIVO:");
  });

  it("symmetric: when Codex leads, the peer is named Claude", () => {
    const p = buildFusionLeadPlaybook({
      leadAgentId: "main",
      collaborationId: "c1",
      principal: "codex",
      peer: "claude",
    });
    expect(p).toContain("Claude"); // the peer when Codex is principal
    expect(p).not.toContain("GPT/OpenAI access"); // that blurb is codex-peer-only
  });

  it("companion brief is read-only and states the review-gate verdict protocol", () => {
    const b = buildCompanionBrief({ leadSessionName: "agent:main:main", principal: "claude", peer: "codex" });
    expect(b).toContain("READ-ONLY");
    expect(b).toContain("[Fusion Review Request]");
    expect(b).toContain("VERDICT: APPROVED");
    expect(b).toContain("VERDICT: CHANGES");
    expect(b).toContain("lead (Claude)");
  });

  it("companion brief tells the peer to see the lead's real work (git diff + transcript)", () => {
    // M0: review the actual changes, not a second-hand summary.
    const b = buildCompanionBrief({ leadSessionName: "agent:main:main", principal: "claude", peer: "codex" });
    expect(b).toContain("git diff");
    expect(b).toContain("otto sessions read agent:main:main");
  });

  it("companion brief names the lead as Codex when Codex is the principal", () => {
    const b = buildCompanionBrief({ leadSessionName: "agent:main:main", principal: "codex", peer: "claude" });
    expect(b).toContain("lead (Codex)");
  });

  it("solo notice tells the principal its peer is at quota", () => {
    expect(buildSoloNotice({ peer: "codex" })).toContain("solo");
    expect(buildSoloNotice({ peer: "codex" })).toContain("Codex");
    expect(buildSoloNotice({ peer: "claude" })).toContain("Claude");
  });

  it("both-exhausted notice mentions both providers", () => {
    expect(buildBothExhaustedNotice().toLowerCase()).toContain("both");
  });

  it("peer-editor playbook hands editing to the peer for the lead", () => {
    const p = buildPeerEditorPlaybook({ leadAgentId: "main", principal: "claude", peer: "codex" });
    expect(p).toContain("you are now the editor");
    expect(p).toContain('agent "main"');
    expect(p).toContain("Codex"); // the peer taking over
    expect(p).toContain("Claude"); // the principal that's exhausted
  });
});
