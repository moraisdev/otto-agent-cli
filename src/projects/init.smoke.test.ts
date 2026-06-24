import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

let stateDir: string | null = null;

setDefaultTimeout(20_000);

function runCli(args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync("bun", ["src/cli/index.ts", ...args], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...(stateDir ? { OTTO_STATE_DIR: stateDir } : {}),
      NO_COLOR: "1",
    },
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: bun src/cli/index.ts ${args.join(" ")}`,
        `status=${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

describe("project init smoke", () => {
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-project-init-smoke-");
  });

  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  it("initializes a project through the CLI with a canonical workflow template", () => {
    const result = JSON.parse(
      runCli([
        "projects",
        "init",
        "Ops Cadence",
        "--slug",
        "ops-cadence",
        "--owner-agent",
        "main",
        "--session",
        "ops-room",
        "--resource",
        "worktree:/tmp/otto.bot",
        "--workflow-template",
        "technical-change",
        "--json",
      ]).stdout,
    ) as {
      details: {
        project: {
          slug: string;
          ownerAgentId?: string;
          operatorSessionName?: string;
        };
        links: Array<{ assetType: string; assetId: string; role?: string; metadata?: Record<string, unknown> }>;
        workflowAggregate: { overallStatus: string | null; primaryWorkflowRunId: string | null } | null;
      };
      workflows: Array<{ source: string; templateId?: string; workflowRunId: string; workflowStatus: string | null }>;
    };

    expect(result.details.project).toMatchObject({
      slug: "ops-cadence",
      ownerAgentId: "main",
      operatorSessionName: "ops-room",
    });
    expect(result.details.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetType: "agent", assetId: "main", role: "owner" }),
        expect.objectContaining({ assetType: "session", assetId: "ops-room", role: "operator" }),
        expect.objectContaining({
          assetType: "resource",
          assetId: "/tmp/otto.bot",
          role: "substrate",
          metadata: expect.objectContaining({
            type: "worktree",
            locator: "/tmp/otto.bot",
            label: "otto.bot worktree",
          }),
        }),
        expect.objectContaining({ assetType: "workflow", role: "primary" }),
      ]),
    );
    expect(result.details.workflowAggregate).toMatchObject({
      overallStatus: "ready",
    });
    expect(result.workflows).toEqual([
      expect.objectContaining({
        source: "template",
        templateId: "technical-change",
        workflowStatus: "ready",
      }),
    ]);
  });
});
