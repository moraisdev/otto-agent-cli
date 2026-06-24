import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface PendingArtifact {
  id: string;
  kind: "skill" | "command";
  name: string;
  insightId: string;
  summary: string;
  files: Record<string, string>;
  createdAt: number;
}

export function stagePending(cwd: string, input: Omit<PendingArtifact, "id" | "createdAt">): string {
  const id = randomUUID().slice(0, 8);
  const dir = join(cwd, ".pending", id);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(input.files)) writeFileSync(join(dir, file), content);
  writeFileSync(join(dir, "pending.json"), JSON.stringify({ ...input, id, createdAt: Date.now() }, null, 2));
  return id;
}
export function listPending(cwd: string): PendingArtifact[] {
  const root = join(cwd, ".pending");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((id) => readPending(cwd, id))
    .filter((p): p is PendingArtifact => p !== null);
}
export function readPending(cwd: string, id: string): PendingArtifact | null {
  const file = join(cwd, ".pending", id, "pending.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as PendingArtifact;
}
export function discardPending(cwd: string, id: string): void {
  rmSync(join(cwd, ".pending", id), { recursive: true, force: true });
}
