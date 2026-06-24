import { describe, it, expect } from "bun:test";
import { buildProposalMessage, sendProposal } from "./notify.js";
import type { LearningDecision } from "./types.js";

const decision: LearningDecision = {
  insightId: "i1",
  route: "skill",
  title: "Move ClickUp Card",
  body: "## trigger\n## workflow\n## validation\n## non-goals",
  reason: "repeated steps",
};

describe("buildProposalMessage", () => {
  it("includes the title, what it does and approval instructions with the staged id", () => {
    const msg = buildProposalMessage(decision, "abc12345");
    expect(msg).toContain("Move ClickUp Card");
    expect(msg).toContain("abc12345");
    expect(msg).toContain("otto learning approve abc12345");
    expect(msg.toLowerCase()).toContain("aprova");
  });
});

describe("sendProposal", () => {
  it("sends the built message through the injected sender", async () => {
    const sent: string[] = [];
    await sendProposal(
      async (msg) => {
        sent.push(msg);
      },
      decision,
      "abc12345",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Move ClickUp Card");
    expect(sent[0]).toContain("abc12345");
  });
});
