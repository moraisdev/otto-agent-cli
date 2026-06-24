import { spawnSync } from "node:child_process";
import { OTTO_CONTEXT_KEY_ENV } from "../runtime/context-registry.js";

export interface ReferenceCliRunResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export type ReferenceCliRunner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; encoding: "utf8" },
) => ReferenceCliRunResult;

export interface ReferenceCliDeps {
  ottoBin?: string;
  ottoArgs?: string[];
  env?: NodeJS.ProcessEnv;
  run?: ReferenceCliRunner;
}

export interface ContextWhoamiResult {
  contextId: string;
  kind: string;
  agentId?: string | null;
  sessionKey?: string | null;
  sessionName?: string | null;
  source?: Record<string, unknown> | null;
  createdAt: number;
  expiresAt?: number | null;
  lastUsedAt?: number | null;
  revokedAt?: number | null;
  metadata?: Record<string, unknown> | null;
  capabilitiesCount: number;
}

export interface ContextAuthorizeResult {
  contextId: string;
  agentId?: string | null;
  permission: string;
  objectType: string;
  objectId: string;
  allowed: boolean;
  approved: boolean;
  inherited: boolean;
  reason?: string | null;
  capabilitiesCount: number;
}

export interface ProbeDaemonResult {
  context: ContextWhoamiResult;
  authorization: ContextAuthorizeResult;
  daemonStatus: string;
}

export function createReferenceContextCli(deps: ReferenceCliDeps = {}) {
  const ottoBin = deps.ottoBin ?? process.env.OTTO_BIN ?? "otto";
  const ottoArgs = deps.ottoArgs ?? [];
  const env = deps.env ?? process.env;
  const run: ReferenceCliRunner =
    deps.run ??
    ((command, args, options) => {
      const result = spawnSync(command, args, options);
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        error: result.error,
      };
    });

  function requireContextKey(): string {
    const contextKey = env[OTTO_CONTEXT_KEY_ENV];
    if (!contextKey) {
      throw new Error(`Missing ${OTTO_CONTEXT_KEY_ENV}`);
    }
    return contextKey;
  }

  function execOtto(args: string[]): string {
    requireContextKey();

    const result = run(ottoBin, [...ottoArgs, ...args], {
      env,
      encoding: "utf8",
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      throw new Error(details || `Failed to run: ${[ottoBin, ...ottoArgs, ...args].join(" ")}`);
    }

    return stdout;
  }

  function execOttoJson<T>(args: string[]): T {
    const stdout = execOtto(args);
    return extractJsonObject(stdout) as T;
  }

  return {
    whoami(): ContextWhoamiResult {
      return execOttoJson<ContextWhoamiResult>(["context", "whoami"]);
    },

    authorize(permission: string, objectType: string, objectId: string): ContextAuthorizeResult {
      return execOttoJson<ContextAuthorizeResult>(["context", "authorize", permission, objectType, objectId]);
    },

    daemonStatus(): string {
      return execOtto(["daemon", "status"]).trim();
    },

    probeDaemon(): ProbeDaemonResult {
      const context = this.whoami();
      const authorization = this.authorize("execute", "group", "daemon");
      if (!authorization.allowed) {
        throw new Error(authorization.reason || "Permission denied for daemon status");
      }

      return {
        context,
        authorization,
        daemonStatus: this.daemonStatus(),
      };
    },
  };
}

export function runReferenceContextCli(argv = process.argv.slice(2), deps: ReferenceCliDeps = {}): void {
  const cli = createReferenceContextCli(deps);
  const [command] = argv;

  switch (command) {
    case "whoami":
      printJson(cli.whoami());
      return;
    case "probe-daemon":
      printJson(cli.probeDaemon());
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

export function extractJsonObject(output: string): unknown {
  const trimmed = output.trim();
  for (let start = 0; start < trimmed.length; start++) {
    if (trimmed[start] !== "{") continue;
    const end = findBalancedJsonObjectEnd(trimmed, start);
    if (end === -1) continue;

    const candidate = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning for the next balanced object
    }
  }

  throw new Error(`Expected JSON object in otto output, got:\n${trimmed || "(empty output)"}`);
}

function findBalancedJsonObjectEnd(input: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index++) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function printUsage(): void {
  console.log(
    [
      "Reference Context CLI",
      "",
      "Usage:",
      "  bun src/reference/context-cli.ts whoami",
      "  bun src/reference/context-cli.ts probe-daemon",
      "",
      `Environment: ${OTTO_CONTEXT_KEY_ENV} must be set`,
    ].join("\n"),
  );
}

if (import.meta.main) {
  runReferenceContextCli(process.argv.slice(2));
}
