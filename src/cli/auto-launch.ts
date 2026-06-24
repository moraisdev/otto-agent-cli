/**
 * Bare-`otto` launcher: ensure the daemon is healthy, then open the TUI.
 *
 * Typing `otto` with no subcommand should "just work": bring up the NATS server
 * (the omni-nats PM2 process the bot connects to) if it's down, start/restart the
 * otto bot so it connects, then drop the user into the full-screen terminal UI.
 *
 * NATS and the otto bot are SEPARATE concerns: `otto daemon start` only manages
 * the bot, not NATS — so starting NATS is handled here explicitly.
 */

import { spawnSync } from "node:child_process";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { isOttoRunning } from "../pm2.js";
import { logger } from "../utils/logger.js";

const log = logger.child("cli:auto-launch");

/** PM2 process that runs the embedded NATS server (with JetStream) for otto. */
const NATS_PM2_PROCESS = "omni-nats";

export interface DaemonPlan {
  /** Whether the NATS server needs to be brought up. */
  startNats: boolean;
  /** What to do with the otto bot process. */
  ottoAction: "start" | "restart" | "none";
}

/**
 * Pure decision core. NATS and otto are independent:
 * - NATS down ⇒ start it.
 * - otto down ⇒ start it.
 * - otto up but NATS was down ⇒ restart it (it likely exhausted its connect
 *   retries while NATS was missing, so it won't reconnect on its own).
 * - both up ⇒ nothing.
 */
export function planDaemonActions(input: { ottoRunning: boolean; natsUp: boolean }): DaemonPlan {
  let ottoAction: DaemonPlan["ottoAction"];
  if (!input.ottoRunning) ottoAction = "start";
  else if (!input.natsUp) ottoAction = "restart";
  else ottoAction = "none";
  return { startNats: !input.natsUp, ottoAction };
}

/** NATS port, honoring NATS_PORT (default 4222). */
export function resolveNatsPort(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.NATS_PORT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4222;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort TCP reachability check (proxy for "NATS is listening"). */
export function checkPort(port: number, host = "127.0.0.1", timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ port, host });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForNats(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkPort(port)) return true;
    await sleep(500);
  }
  return false;
}

/** Bring up the NATS server via its PM2 process. Returns true if the command ran. */
function startNatsServer(): boolean {
  const start = spawnSync("pm2", ["start", NATS_PM2_PROCESS], { stdio: "inherit" });
  if (start.status === 0) return true;
  // Already-defined-but-errored processes sometimes need restart instead of start.
  const restart = spawnSync("pm2", ["restart", NATS_PM2_PROCESS], { stdio: "inherit" });
  if (restart.status === 0) return true;
  console.log(
    `⚠️  Não consegui iniciar o NATS (PM2 '${NATS_PM2_PROCESS}'). Rode 'otto setup' para configurar a infra do omni.`,
  );
  return false;
}

function runOttoDaemon(projectRoot: string, args: string[]): void {
  const bin = join(projectRoot, "bin", "otto");
  spawnSync(bin, ["daemon", ...args], { stdio: "inherit", env: process.env });
}

/**
 * Ensure NATS is reachable and the otto bot is running, fixing whatever is
 * missing, then wait (briefly) for NATS so the UI connects cleanly.
 */
export async function ensureDaemonReady(projectRoot: string): Promise<void> {
  const port = resolveNatsPort();
  const plan = planDaemonActions({ ottoRunning: isOttoRunning(), natsUp: await checkPort(port) });

  if (plan.startNats) {
    console.log("⚙️  NATS fora do ar — iniciando o servidor NATS…");
    startNatsServer();
    if (!(await waitForNats(port))) {
      log.warn("NATS did not come up before timeout", { port });
      console.log("⚠️  NATS demorou a responder; abrindo mesmo assim (deve reconectar sozinho).");
    }
  }

  if (plan.ottoAction === "start") {
    console.log("⚙️  Otto daemon não está rodando — iniciando…");
    runOttoDaemon(projectRoot, ["start"]);
  } else if (plan.ottoAction === "restart") {
    console.log("⚙️  Reconectando o otto ao NATS…");
    runOttoDaemon(projectRoot, ["restart", "-m", "auto: otto launch (NATS recovered)"]);
  }
}
