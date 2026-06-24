import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { close as closeChatDb } from "../db.js";
import { closeContacts } from "../contacts.js";
import { closeSessionAdapterStore } from "../adapters/adapter-db.js";
import { closeRouterDb } from "../router/router-db.js";
import { closeSessionStore } from "../router/sessions.js";

const OTTO_STATE_LOCK_DIR = join(tmpdir(), "otto-test-state.lock");
const OTTO_STATE_LOCK_RETRY_MS = 10;
const OTTO_STATE_LOCK_STALE_MS = 60_000;
const OTTO_STATE_LOCK_TIMEOUT_MS = 120_000;
const pendingStateDirs = new Set<string>();
let pendingStateCleanupRegistered = false;

async function acquireOttoStateLock(): Promise<void> {
  const deadline = Date.now() + OTTO_STATE_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      mkdirSync(OTTO_STATE_LOCK_DIR);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }

      try {
        const stats = statSync(OTTO_STATE_LOCK_DIR);
        if (Date.now() - stats.mtimeMs > OTTO_STATE_LOCK_STALE_MS) {
          rmSync(OTTO_STATE_LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock may have been released between stat attempts.
      }

      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for isolated Otto state lock");
      }

      await new Promise((resolve) => setTimeout(resolve, OTTO_STATE_LOCK_RETRY_MS));
    }
  }
}

function releaseOttoStateLock(): void {
  rmSync(OTTO_STATE_LOCK_DIR, { recursive: true, force: true });
}

function flushPendingStateDirs(): void {
  for (const dir of pendingStateDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  pendingStateDirs.clear();
}

function ensurePendingStateCleanup(): void {
  if (pendingStateCleanupRegistered) {
    return;
  }

  pendingStateCleanupRegistered = true;
  process.once("exit", flushPendingStateDirs);
}

export async function createIsolatedOttoState(prefix = "otto-test-"): Promise<string> {
  await acquireOttoStateLock();
  closeChatDb();
  closeContacts();
  closeSessionAdapterStore();
  closeSessionStore();
  closeRouterDb();
  const stateDir = mkdtempSync(join(tmpdir(), prefix));
  pendingStateDirs.add(stateDir);
  ensurePendingStateCleanup();
  process.env.OTTO_STATE_DIR = stateDir;
  return stateDir;
}

export async function cleanupIsolatedOttoState(stateDir?: string | null): Promise<void> {
  closeChatDb();
  closeContacts();
  closeSessionAdapterStore();
  closeSessionStore();
  closeRouterDb();
  delete process.env.OTTO_STATE_DIR;
  if (stateDir) pendingStateDirs.add(stateDir);
  releaseOttoStateLock();
}
