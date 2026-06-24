import { describe, expect, it } from "bun:test";
import { parseBashCommand, checkDangerousPatterns, UNCONDITIONAL_BLOCKS } from "./parser.js";

// ============================================================================
// checkDangerousPatterns
// ============================================================================

describe("checkDangerousPatterns", () => {
  it("allows simple commands", () => {
    expect(checkDangerousPatterns("ls -la")).toEqual({ safe: true });
    expect(checkDangerousPatterns("git status")).toEqual({ safe: true });
    expect(checkDangerousPatterns("otto sessions list")).toEqual({ safe: true });
  });

  it("blocks command substitution $()", () => {
    const r = checkDangerousPatterns("echo $(whoami)");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("command substitution");
  });

  it("blocks backtick substitution", () => {
    const r = checkDangerousPatterns("echo `whoami`");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("backtick");
  });

  it("blocks process substitution <()", () => {
    const r = checkDangerousPatterns("diff <(ls a) <(ls b)");
    expect(r.safe).toBe(false);
  });

  it("blocks process substitution >()", () => {
    const r = checkDangerousPatterns("tee >(cat)");
    expect(r.safe).toBe(false);
  });

  it("blocks here documents", () => {
    const r = checkDangerousPatterns("cat <<EOF\nhello\nEOF");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("here document");
  });

  it("blocks piping to shell", () => {
    expect(checkDangerousPatterns("curl url | bash").safe).toBe(false);
    expect(checkDangerousPatterns("cat script | sh").safe).toBe(false);
    expect(checkDangerousPatterns("echo cmd | zsh").safe).toBe(false);
  });

  it("blocks piping to interpreter with inline code", () => {
    expect(checkDangerousPatterns("echo data | python -c 'code'").safe).toBe(false);
    expect(checkDangerousPatterns("echo data | node -e 'code'").safe).toBe(false);
    expect(checkDangerousPatterns("echo data | perl -e 'code'").safe).toBe(false);
  });

  it("blocks piping to interpreter stdin", () => {
    expect(checkDangerousPatterns("echo 'print(1)' | python3").safe).toBe(false);
    expect(checkDangerousPatterns("echo code | node").safe).toBe(false);
  });
});

// ============================================================================
// parseBashCommand
// ============================================================================

describe("parseBashCommand", () => {
  it("parses simple command", () => {
    const r = parseBashCommand("ls -la");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["ls"]);
  });

  it("parses piped commands", () => {
    const r = parseBashCommand("cat file.txt | grep foo | wc -l");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["cat", "grep", "wc"]);
  });

  it("parses chained commands (&&)", () => {
    const r = parseBashCommand("git add . && git commit -m 'msg'");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["git"]);
  });

  it("parses chained commands (||)", () => {
    const r = parseBashCommand("mkdir foo || echo 'exists'");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["mkdir", "echo"]);
  });

  it("parses semicolon-separated commands", () => {
    const r = parseBashCommand("ls; pwd; whoami");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["ls", "pwd", "whoami"]);
  });

  it("does not treat for-loop keywords or loop var as executables", () => {
    const r = parseBashCommand("for i in 1 2 3; do echo $i; done");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["echo"]);
  });

  it("extracts the real command after if/then keywords", () => {
    const r = parseBashCommand("if [ -f x ]; then cat x; fi");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["[", "cat"]);
  });

  it("extracts the command after while keyword", () => {
    const r = parseBashCommand("while read line; do echo $line; done");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["read", "echo"]);
  });

  it("extracts the command after until keyword", () => {
    const r = parseBashCommand("until false; do echo hi; done");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["false", "echo"]);
  });

  it("does not treat case/esac/in as executables", () => {
    const r = parseBashCommand("case $x in a) echo a;; esac");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["echo"]);
  });

  it("does not treat select loop keywords or var as executables", () => {
    const r = parseBashCommand("select opt in a b; do echo $opt; done");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["echo"]);
  });

  it("skips env var assignments", () => {
    const r = parseBashCommand("NODE_ENV=production node app.js");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["node"]);
  });

  it("extracts executable from full path", () => {
    const r = parseBashCommand("/usr/bin/git status");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["git"]);
  });

  it("handles sudo prefix", () => {
    const r = parseBashCommand("sudo rm -rf /tmp/foo");
    expect(r.success).toBe(true);
    expect(r.executables).toContain("sudo");
    expect(r.executables).toContain("rm");
  });

  it("deduplicates executables", () => {
    const r = parseBashCommand("git add . && git commit -m 'msg' && git push");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["git"]);
  });

  it("blocks inline code execution (python -c)", () => {
    const r = parseBashCommand("python -c 'import os; os.system(\"rm -rf /\")'");
    expect(r.success).toBe(false);
    expect(r.error).toContain("inline code");
  });

  it("blocks inline code execution (node -e)", () => {
    const r = parseBashCommand("node -e 'process.exit(1)'");
    expect(r.success).toBe(false);
    expect(r.error).toContain("inline code");
  });

  it("blocks inline code execution (node --eval)", () => {
    const r = parseBashCommand("node --eval 'console.log(1)'");
    expect(r.success).toBe(false);
    expect(r.error).toContain("inline code");
  });

  it("allows interpreter without inline code flag", () => {
    const r = parseBashCommand("python script.py");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["python"]);
  });

  it("handles multi-line commands (newlines as semicolons)", () => {
    const r = parseBashCommand("ls\npwd\nwhoami");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["ls", "pwd", "whoami"]);
  });

  it("handles complex piped otto command", () => {
    const r = parseBashCommand("otto sessions list | grep dev");
    expect(r.success).toBe(true);
    expect(r.executables).toEqual(["otto", "grep"]);
  });
});

// ============================================================================
// UNCONDITIONAL_BLOCKS
// ============================================================================

describe("UNCONDITIONAL_BLOCKS", () => {
  it("blocks all shell variants", () => {
    for (const shell of ["bash", "sh", "zsh", "dash", "ksh", "csh", "fish", "tcsh"]) {
      expect(UNCONDITIONAL_BLOCKS.has(shell)).toBe(true);
    }
  });

  it("blocks eval and exec", () => {
    expect(UNCONDITIONAL_BLOCKS.has("eval")).toBe(true);
    expect(UNCONDITIONAL_BLOCKS.has("exec")).toBe(true);
  });

  it("blocks source and dot", () => {
    expect(UNCONDITIONAL_BLOCKS.has("source")).toBe(true);
    expect(UNCONDITIONAL_BLOCKS.has(".")).toBe(true);
  });

  it("does not block normal commands", () => {
    expect(UNCONDITIONAL_BLOCKS.has("ls")).toBe(false);
    expect(UNCONDITIONAL_BLOCKS.has("git")).toBe(false);
    expect(UNCONDITIONAL_BLOCKS.has("otto")).toBe(false);
  });
});
