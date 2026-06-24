const REQUIRED = ["trigger", "workflow", "validation", "non-goals"];
const SECRET_RES = [/sk-ant-[a-z0-9-]+/i, /omni_sk_[a-f0-9]+/i, /AKIA[0-9A-Z]{16}/, /\b[A-Za-z0-9_-]{40,}\b/];
export interface SkillCandidate {
  name: string;
  content: string;
}
export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSection(content: string, section: string): boolean {
  const term = escapeRegExp(section);
  const heading = new RegExp(`^#{1,6}\\s.*${term}`, "im");
  const label = new RegExp(`^\\s*[*]?[*]?\\s*${term}\\b`, "im");
  return heading.test(content) || label.test(content);
}

export function validateSkillContent(c: SkillCandidate, existingNames: string[]): ValidationResult {
  const problems: string[] = [];
  for (const sec of REQUIRED) if (!hasSection(c.content, sec)) problems.push(`missing section: ${sec}`);
  if (existingNames.includes(c.name)) problems.push(`duplicate skill name: ${c.name}`);
  if (SECRET_RES.some((re) => re.test(c.content))) problems.push("possible secret embedded");
  return { ok: problems.length === 0, problems };
}
