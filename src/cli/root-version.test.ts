import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

function testEnv(stateDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, OTTO_STATE_DIR: stateDir };
  delete env.OTTO_CONTEXT_KEY;
  delete env.OTTO_SESSION_KEY;
  delete env.OTTO_SESSION_NAME;
  delete env.OTTO_AGENT_ID;
  delete env.OTTO_CHANNEL;
  delete env.OTTO_ACCOUNT_ID;
  delete env.OTTO_CHAT_ID;
  return env;
}

describe("CLI root version", () => {
  it("prints version only for the root invocation", () => {
    const result = spawnSync("bun", ["src/cli/index.ts", "--version"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: testEnv(join(tmpdir(), `otto-root-version-${process.pid}-root`)),
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("lets subcommands own their --version option", () => {
    const stateDir = join(tmpdir(), `otto-root-version-${process.pid}-subcommand`);
    const result = spawnSync("bun", ["src/cli/index.ts", "artifacts", "restore", "art_missing", "--version", "1"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: testEnv(stateDir),
    });
    rmSync(stateDir, { recursive: true, force: true });

    expect(result.status).toBe(1);
    expect(result.stdout.trim()).not.toBe(pkg.version);
    expect(result.stderr).toContain("Artifact not found: art_missing");
  });
});
