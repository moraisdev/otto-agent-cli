import { describe, expect, it } from "bun:test";
import {
  buildReviewRequestPrompt,
  parseReviewVerdict,
  runFusionReviewGate,
  type FusionReviewRequest,
} from "./fusion-gate.js";

const baseReq: FusionReviewRequest = {
  leadSessionName: "agent:main:main",
  leadAgentId: "main",
  peerProvider: "codex",
  draft: "Added the function and a test.",
  round: 0,
};

describe("parseReviewVerdict", () => {
  it("approves on explicit APPROVED", () => {
    expect(parseReviewVerdict("VERDICT: APPROVED\nlooks good").outcome).toBe("approved");
  });

  it("fails open to approved on empty / unmarked replies", () => {
    expect(parseReviewVerdict("").outcome).toBe("approved");
    expect(parseReviewVerdict("nice work, no issues").outcome).toBe("approved");
  });

  it("extracts summary and findings on CHANGES", () => {
    const v = parseReviewVerdict(
      [
        "VERDICT: CHANGES",
        "SUMMARY: 2 ajustes: erro X, edge case Y",
        "- line 12 ignores the error",
        "- missing null check",
      ].join("\n"),
    );
    expect(v.outcome).toBe("changes");
    expect(v.summary).toBe("2 ajustes: erro X, edge case Y");
    expect(v.findings).toContain("line 12 ignores the error");
    expect(v.findings).not.toContain("VERDICT");
    expect(v.findings).not.toContain("SUMMARY");
  });

  it("defaults the summary when CHANGES omits one", () => {
    const v = parseReviewVerdict("VERDICT: CHANGES\nfix the off-by-one");
    expect(v.outcome).toBe("changes");
    expect(v.summary).toBeTruthy();
    expect(v.findings).toContain("off-by-one");
  });
});

describe("buildReviewRequestPrompt", () => {
  it("includes the draft and the reply protocol", () => {
    const prompt = buildReviewRequestPrompt(baseReq);
    expect(prompt).toContain("[Fusion Review Request]");
    expect(prompt).toContain("round 1");
    expect(prompt).toContain(baseReq.draft);
    expect(prompt).toContain("VERDICT: APPROVED");
    expect(prompt).toContain("VERDICT: CHANGES");
  });
});

describe("runFusionReviewGate", () => {
  it("publishes to the companion main session and parses the verdict", async () => {
    const published: Array<{ sessionName: string; payload: Record<string, unknown> }> = [];
    const verdict = await runFusionReviewGate(baseReq, {
      publishPrompt: async (sessionName, payload) => {
        published.push({ sessionName, payload });
      },
      subscribeResponses: async function* () {
        yield { response: "VERDICT: CHANGES\nSUMMARY: 1 ajuste\n- handle the empty case" };
      },
    });
    expect(published[0]?.sessionName).toBe("agent:peer-companion-main:main");
    expect(published[0]?.payload._fusionReview).toBe(true);
    expect(verdict.outcome).toBe("changes");
    expect(verdict.summary).toBe("1 ajuste");
  });

  it("ignores empty response events and waits for the real verdict", async () => {
    const verdict = await runFusionReviewGate(baseReq, {
      publishPrompt: async () => {},
      subscribeResponses: async function* () {
        yield { response: "" };
        yield { notResponse: true };
        yield { response: "VERDICT: APPROVED" };
      },
    });
    expect(verdict.outcome).toBe("approved");
  });

  it("returns unavailable on timeout (fail-open)", async () => {
    const verdict = await runFusionReviewGate(
      { ...baseReq, timeoutMs: 20 },
      {
        publishPrompt: async () => {},
        // Never yields — forces the timeout path.
        subscribeResponses: async function* () {
          await new Promise((r) => setTimeout(r, 1000));
        },
      },
    );
    expect(verdict.outcome).toBe("unavailable");
  });

  it("returns unavailable when the stream ends without a response", async () => {
    const verdict = await runFusionReviewGate(baseReq, {
      publishPrompt: async () => {},
      subscribeResponses: async function* () {
        /* no yields */
      },
    });
    expect(verdict.outcome).toBe("unavailable");
  });
});
