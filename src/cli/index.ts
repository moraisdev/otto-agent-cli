#!/usr/bin/env tsx
/**
 * Otto Bot CLI - Unified command-line interface
 *
 * Uses Commander.js + custom decorators for declarative command definition.
 *
 * For programmatic access to CLI tools (without running the CLI),
 * import from "./cli/exports.js" instead.
 */

// MUST be first import - loads ~/.otto/.env before other modules initialize
import "./env.js";

import "reflect-metadata";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerCommands } from "./registry.js";
import * as allCommands from "./commands/index.js";
import { runDoctor } from "./commands/doctor.js";
import { runSetup } from "./commands/setup.js";
import { runUpdate } from "./commands/update.js";
import { emitCliAuditEvent, runWithCliAudit } from "./audit.js";
import { configureCliLogging } from "./logging.js";
import { spawnDirectTui } from "./tui-launcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
const projectRoot = join(__dirname, "../..");

configureCliLogging();

const program = new Command();

function isRootVersionRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-V");
}

if (isRootVersionRequest(process.argv.slice(2))) {
  console.log(pkg.version);
  process.exit(0);
}

program
  .name("otto")
  .description("Otto Bot CLI - Claude-powered bot management")
  .option("-r, --resume", "Open the conversation picker to resume a past session")
  .addHelpText(
    "after",
    "\nRoot options:\n  otto --version    Print Otto CLI version\n  otto --resume     Pick a past conversation to resume",
  );

// Register all command groups (auto-discovered from barrel)
registerCommands(program, Object.values(allCommands) as Array<new () => object>);

// Top-level commands (not via decorator groups)
program
  .command("doctor")
  .description("Inspect critical Otto runtime, substrate, and contract health")
  .option("--json", "Print raw JSON result")
  .action(async (options: { json?: boolean }) => {
    await runWithCliAudit(
      {
        group: "_root",
        name: "doctor",
        tool: "root_doctor",
        input: options,
        closeLazyConnection: true,
      },
      () => runDoctor({ json: options.json }),
    );
  });

program
  .command("setup")
  .description("Wizard interativo de configuração")
  .action(async () => {
    await runWithCliAudit(
      {
        group: "_root",
        name: "setup",
        tool: "root_setup",
        closeLazyConnection: true,
      },
      () => runSetup(),
    );
  });

program
  .command("update")
  .description("Update Otto CLI to the configured npm channel")
  .option("--next", "Switch to dev builds (npm @next tag)")
  .option("--stable", "Switch to stable releases (npm @latest tag)")
  .action(async (options: { next?: boolean; stable?: boolean }) => {
    await runWithCliAudit(
      {
        group: "_root",
        name: "update",
        tool: "root_update",
        input: options,
        closeLazyConnection: true,
      },
      () => runUpdate(options),
    );
  });

// TUI - full-screen terminal interface
program
  .command("tui")
  .description("Open the terminal UI for a session")
  .argument("[session]", "Session name or key", "main")
  .action(async (session: string) => {
    await runWithCliAudit(
      {
        group: "_root",
        name: "tui",
        tool: "root_tui",
        input: { session },
        closeLazyConnection: true,
      },
      async () => {
        await spawnDirectTui(session, projectRoot);
      },
    );
  });

// code - clean inline REPL coding client (the otto CLI)
program
  .command("code")
  .description("Open the clean inline REPL coding client (fusion-ready) — project-scoped by default")
  .argument("[session]", "Session name or key (defaults to a project-scoped session for the current dir)")
  .action(async (session: string | undefined) => {
    const cwd = process.cwd();
    const { runReplClient } = await import("../repl/client.js");
    const { projectSessionName } = await import("../router/project-session.js");
    const sessionName = session ?? projectSessionName(cwd);
    await runReplClient({ sessionName, cwd });
  });

program
  .command("stream")
  .description("Run the Otto JSONL stdio stream server")
  .option("--scope <scope>", "Stream scope preset", "events")
  .option("--topic <pattern...>", "Override topic patterns")
  .option("--heartbeat-ms <ms>", "Heartbeat interval in milliseconds", "5000")
  .action(async (options: { scope: string; topic?: string[]; heartbeatMs: string }) => {
    await emitCliAuditEvent({
      group: "_root",
      name: "stream",
      tool: "root_stream",
      input: options,
      status: "started",
      closeLazyConnection: false,
    });
    await runWithCliAudit(
      {
        group: "_root",
        name: "stream",
        tool: "root_stream",
        input: options,
        closeLazyConnection: false,
      },
      async () => {
        const { runCliStreamServer } = await import("../stream/server.js");
        await runCliStreamServer({
          scope: options.scope,
          topicPatterns: options.topic,
          heartbeatMs: Number.parseInt(options.heartbeatMs, 10) || 5000,
        });
      },
    );
  });

// Default action: bare `otto` (no subcommand) opens the full-screen TUI,
// auto-managing the daemon first (start if down, restart if NATS is wedged).
program.action(async () => {
  if (!process.stdout.isTTY) {
    console.error("`otto` precisa de um terminal interativo. Use `otto code` ou rode num terminal de verdade.");
    process.exitCode = 1;
    return;
  }
  const { ensureDaemonReady } = await import("./auto-launch.js");
  await ensureDaemonReady(projectRoot);
  // `otto --resume` opens the session picker first (TUI reads this sentinel).
  await spawnDirectTui(program.opts().resume ? "--resume" : "main", projectRoot);
});

// Parse and execute
program.parse();
