import { describe, it, expect } from "bun:test";
import { validateSkillContent } from "./apply-skill.js";

const validSections = "## Trigger\nwhen X\n\n## Workflow\ndo Y\n\n## Validation\ncheck Z\n\n## Non-goals\nnot W\n";

describe("validateSkillContent", () => {
  it("rejects skill missing required sections", () => {
    const r = validateSkillContent({ name: "x", content: "# X\nso isso" }, []);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("trigger");
  });
  it("rejects duplicate name", () => {
    const r = validateSkillContent({ name: "contacts", content: validSections }, ["contacts"]);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("duplicate");
  });
  it("rejects embedded secrets", () => {
    const r = validateSkillContent({ name: "x", content: validSections + "\nsk-ant-abc123" }, []);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("secret");
  });
  it("rejects sections that only appear inline in prose", () => {
    const prose =
      "This skill describes the trigger conditions, the workflow steps, " +
      "the validation rules and the non-goals so everything is mentioned in prose.";
    const r = validateSkillContent({ name: "a", content: prose }, []);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.startsWith("missing section"))).toBe(true);
  });
  it("accepts markdown headings", () => {
    const r = validateSkillContent({ name: "a", content: validSections }, []);
    expect(r.ok).toBe(true);
  });
  it("accepts bold labels and Label: lines", () => {
    const md = "**Trigger**\nwhen X\n\nWorkflow:\ndo Y\n\n## Validation\ncheck Z\n\n* Non-goals\nnot W";
    const r = validateSkillContent({ name: "a", content: md }, []);
    expect(r.ok).toBe(true);
  });
});
