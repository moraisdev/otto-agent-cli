import { describe, expect, it } from "bun:test";
import { selectOrphanedTaskSessions } from "./runner.js";

describe("selectOrphanedTaskSessions", () => {
  const hasActiveTask = (name: string) => name === "active-task-work";

  it("selects ephemeral task sessions whose task is no longer active", () => {
    const sessions = [
      { name: "done-task-work", expiresAt: 1_000 },
      { name: "active-task-work", expiresAt: 1_000 },
    ];
    expect(selectOrphanedTaskSessions(sessions, hasActiveTask)).toEqual(["done-task-work"]);
  });

  it("ignores non-task sessions even when ephemeral", () => {
    const sessions = [
      { name: "agent:main:main", expiresAt: 1_000 },
      { name: "agent:main:dm:5511999", expiresAt: 1_000 },
    ];
    expect(selectOrphanedTaskSessions(sessions, hasActiveTask)).toEqual([]);
  });

  it("ignores non-ephemeral (permanent) task-named sessions", () => {
    const sessions = [{ name: "done-task-work", expiresAt: null }];
    expect(selectOrphanedTaskSessions(sessions, hasActiveTask)).toEqual([]);
  });

  it("keeps sessions whose task is still active", () => {
    const sessions = [{ name: "active-task-work", expiresAt: 1_000 }];
    expect(selectOrphanedTaskSessions(sessions, hasActiveTask)).toEqual([]);
  });

  it("recognizes the task-<id>-work prefix form", () => {
    const sessions = [{ name: "task-abc123-work", expiresAt: 1_000 }];
    expect(selectOrphanedTaskSessions(sessions, () => false)).toEqual(["task-abc123-work"]);
  });
});
