/**
 * Project-scoped session naming.
 *
 * A coding session is rooted in a project directory, not the agent's fixed cwd.
 * `projectSessionName` maps an absolute path to a stable, NATS-subject-safe
 * session name (no dots/spaces) that the terminal REPL and a bound WhatsApp
 * group both resolve to — so they're one session for that project.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";

function normalizePath(cwd: string): string {
  // Drop a single trailing slash so "/p" and "/p/" hash the same.
  return cwd.length > 1 && cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
}

function slugifyBasename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || "dir";
}

export function projectSessionName(cwd: string): string {
  const normalized = normalizePath(cwd);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `proj-${slugifyBasename(basename(normalized))}-${hash}`;
}
