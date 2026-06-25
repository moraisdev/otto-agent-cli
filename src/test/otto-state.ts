import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { close as closeChatDb } from "../db.js";
import { closeContacts } from "../contacts.js";
import { closeSessionAdapterStore } from "../adapters/adapter-db.js";
import { closeRouterDb } from "../router/router-db.js";
import { closeSessionStore } from "../router/sessions.js";

// State dirs pending removal on process exit — kept so a crashed afterEach
// doesn't leak temp directories. Bun runs each test file in its own worker, so
// `process.env.OTTO_STATE_DIR` and the singletons we close below don't cross
// file boundaries; the previous filesystem-wide mkdir lock was serializing
// independent workers and starving them past the 5s test timeout.
const pendingStateDirs = new Set<string>();
let pendingStateCleanupRegistered = false;

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
}
