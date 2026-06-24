import { mkdirSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LearningDecision } from "./types.js";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function applyMemoryDecision(cwd: string, decision: LearningDecision): Promise<string> {
  const dir = join(cwd, "knowledge");
  mkdirSync(dir, { recursive: true });
  const slug = slugify(decision.title) || slugify(decision.insightId) || decision.insightId;
  const file = join(dir, `${slug}.md`);
  if (existsSync(file)) {
    appendFileSync(file, `\n\n## ${new Date().toISOString().slice(0, 10)}\n${decision.body}\n`);
  } else {
    writeFileSync(file, `# ${decision.title}\n\n${decision.body}\n`);
  }
  return file;
}
