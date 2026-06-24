import { describe, expect, it } from "bun:test";
import { OTTO_EVENTS_SUBJECTS } from "./audit-stream.js";

function streamSubjectPatternsOverlap(left: string, right: string): boolean {
  const leftTokens = left.split(".");
  const rightTokens = right.split(".");

  function overlaps(leftIndex: number, rightIndex: number): boolean {
    const leftToken = leftTokens[leftIndex];
    const rightToken = rightTokens[rightIndex];

    if (leftToken === undefined || rightToken === undefined) {
      return leftToken === rightToken || leftToken === ">" || rightToken === ">";
    }

    if (leftToken === ">" || rightToken === ">") return true;
    if (leftToken === "*" || rightToken === "*") return overlaps(leftIndex + 1, rightIndex + 1);
    if (leftToken !== rightToken) return false;
    return overlaps(leftIndex + 1, rightIndex + 1);
  }

  return overlaps(0, 0);
}

describe("OTTO_EVENTS stream subjects", () => {
  it("captures internal session replay events without overlapping the prompt workqueue", () => {
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.*.runtime");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.*.response");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.*.claude");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.*.tool");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.abort");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.reset.requested");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.reset.completed");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.delete.requested");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto.session.delete.completed");
    expect(OTTO_EVENTS_SUBJECTS).toContain("otto._cli.cli.>");
    expect(OTTO_EVENTS_SUBJECTS).not.toContain("otto.session.*.prompt");
    expect(OTTO_EVENTS_SUBJECTS).not.toContain("otto.*.cli.>");
    expect(new Set(OTTO_EVENTS_SUBJECTS).size).toBe(OTTO_EVENTS_SUBJECTS.length);
  });

  it("does not define overlapping subjects in the same stream", () => {
    for (const [index, subject] of OTTO_EVENTS_SUBJECTS.entries()) {
      for (const other of OTTO_EVENTS_SUBJECTS.slice(index + 1)) {
        expect(streamSubjectPatternsOverlap(subject, other), `${subject} overlaps ${other}`).toBe(false);
      }
    }
  });
});
