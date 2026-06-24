export const ESCALATION_RELATIONS = ["admin"] as const;
export const ESCALATION_OBJECTS = ["system:*", "group:permissions", "group:agents", "group:instances"] as const;
export const ESCALATION_OBJECT_PREFIXES = ["system:", "group:permissions", "group:agents", "group:instances"] as const;

export interface Capability {
  verb: string;
  target: string;
}
export interface Grant {
  subject: string;
  relation: string;
  object: string;
}
export interface ScopeSummary {
  can: string[];
  cannot: string[];
}
export interface TranslationResult {
  grants: Grant[];
  blocked: Capability[];
  summary: ScopeSummary;
}

// Comparison key: trim + lowercase. Used ONLY for the escalation check so that
// "Admin", "admin ", "system:* " and "GROUP:PERMISSIONS_GRANT" can never slip
// past via casing or whitespace.
function escalationKey(value: string): string {
  return value.trim().toLowerCase();
}

function isEscalation(verb: string, target: string): boolean {
  const v = escalationKey(verb);
  const t = escalationKey(target);
  if ((ESCALATION_RELATIONS as readonly string[]).includes(v)) return true;
  if ((ESCALATION_OBJECTS as readonly string[]).includes(t)) return true;
  if (ESCALATION_OBJECT_PREFIXES.some((prefix) => t.startsWith(prefix))) return true;
  return false;
}

export function translateCapabilities(agentId: string, caps: Capability[]): TranslationResult {
  const grants: Grant[] = [];
  const blocked: Capability[] = [];
  for (const cap of caps) {
    if (isEscalation(cap.verb, cap.target)) {
      blocked.push(cap);
      continue;
    }
    // Emit a clean grant: trim whitespace (so a dirty "  Read " can't smuggle a
    // distinct relation tuple) but preserve case — REBAC objects like tool:Read
    // and executable names are case-sensitive.
    grants.push({ subject: `agent:${agentId}`, relation: cap.verb.trim(), object: cap.target.trim() });
  }
  return {
    grants,
    blocked,
    summary: {
      can: grants.flatMap((g) => [`${g.relation} ${g.object}`, g.object]),
      cannot: grants.length ? ["everything else"] : [],
    },
  };
}
