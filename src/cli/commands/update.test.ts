import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFromBinaryPath, findPackageRoot, packageTagForChannel, resolveUpdateChannel } from "./update.js";

describe("update command helpers", () => {
  it("resolves explicit channel flags before persisted config", () => {
    expect(resolveUpdateChannel({ next: true }, { updateChannel: "latest" })).toBe("next");
    expect(resolveUpdateChannel({ stable: true }, { updateChannel: "next" })).toBe("latest");
  });

  it("uses persisted channel and falls back to latest", () => {
    expect(resolveUpdateChannel({}, { updateChannel: "next" })).toBe("next");
    expect(resolveUpdateChannel({}, {})).toBe("latest");
  });

  it("formats package tags for npm channels", () => {
    expect(packageTagForChannel("next")).toBe("otto-agent-cli@next");
    expect(packageTagForChannel("latest")).toBe("otto-agent-cli@latest");
  });

  it("detects common global install paths", () => {
    expect(detectFromBinaryPath("/home/tester/.bun/bin/otto")).toBe("bun");
    expect(detectFromBinaryPath("/opt/node/lib/node_modules/otto-agent-cli/bin/otto")).toBe("npm");
  });

  it("finds the package root from this test file", () => {
    const root = findPackageRoot(import.meta.path);
    expect(root).toBeTruthy();
    const pkg = JSON.parse(readFileSync(join(root!, "package.json"), "utf8")) as { name?: string };
    expect(pkg.name).toBe("otto-agent-cli");
  });
});
