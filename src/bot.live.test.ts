import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, setDefaultTimeout } from "bun:test";

setDefaultTimeout(120_000);

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "bot.live.fixture.ts");

describe("OttoBot live provider integration", () => {
  if (!process.env.OTTO_LIVE_TESTS) {
    it.skip("runs only when OTTO_LIVE_TESTS=1", () => {});
    return;
  }

  it("passes in an isolated process", () => {
    const result = spawnSync(process.execPath, ["test", fixturePath, "--timeout=60000"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OTTO_TEST_ISOLATED_FIXTURE: "bot-live",
      },
      encoding: "utf8",
    });

    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
    }

    expect(result.status).toBe(0);
  });
});
