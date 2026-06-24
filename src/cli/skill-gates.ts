export interface SkillGateMetadata {
  skill: string;
  source: "inferred" | "config";
  ruleId?: string;
}

export interface SkillGateRuleConfig {
  id?: string;
  skill?: string | null;
  disabled?: boolean;
  remove?: boolean;
  pattern?: string;
  groupRegex?: string;
  tool?: string;
  toolPrefix?: string;
  toolRegex?: string;
  command?: string;
  commandPrefix?: string;
  commandRegex?: string;
}

export interface ResolveCommandSkillGateInput {
  groupPath: string;
  command: string;
  method?: string;
}

interface OttoGroupSkillRule {
  id: string;
  pattern: RegExp;
  skill: string;
}

export interface DefaultSkillGateRule {
  id: string;
  pattern: string;
  skill: string;
}

interface EffectiveGroupSkillRule extends OttoGroupSkillRule {
  source: SkillGateMetadata["source"];
}

type ConfiguredGateResolution = SkillGateMetadata | false | undefined;

export const DEFAULT_OTTO_GROUP_SKILL_RULES: readonly OttoGroupSkillRule[] = [
  { id: "agents", pattern: /^agents(?:[._]|$)/, skill: "otto-system-agents-manager" },
  { id: "artifacts", pattern: /^artifacts(?:[._]|$)/, skill: "otto-system-artifacts" },
  { id: "audio", pattern: /^audio(?:[._]|$)/, skill: "otto-system-audio" },
  { id: "contacts", pattern: /^contacts(?:[._]|$)/, skill: "otto-system-contacts-manager" },
  { id: "context", pattern: /^context(?:[._]|$)/, skill: "otto-dev-context-cli" },
  { id: "commands", pattern: /^commands(?:[._]|$)/, skill: "otto-system-commands" },
  { id: "cron", pattern: /^cron(?:[._]|$)/, skill: "otto-system-cron-manager" },
  { id: "daemon", pattern: /^daemon(?:[._]|$)/, skill: "otto-system-daemon-manager" },
  { id: "eval", pattern: /^eval(?:[._]|$)/, skill: "otto-system-tasks-eval" },
  { id: "events", pattern: /^events(?:[._]|$)/, skill: "otto-system-events" },
  { id: "heartbeat", pattern: /^heartbeat(?:[._]|$)/, skill: "otto-system-heartbeat-manager" },
  { id: "image", pattern: /^image(?:[._]|$)/, skill: "otto-system-image" },
  { id: "routes", pattern: /^(?:routes|instances[._]routes)(?:[._]|$)/, skill: "otto-system-routes-manager" },
  { id: "instances", pattern: /^instances(?:[._]|$)/, skill: "otto-system-instances-manager" },
  { id: "permissions", pattern: /^permissions(?:[._]|$)/, skill: "otto-system-permissions-manager" },
  { id: "projects", pattern: /^projects(?:[._]|$)/, skill: "otto-system-projects" },
  { id: "prox-calls", pattern: /^prox[._]calls(?:[._]|$)/, skill: "otto-system-prox-calls" },
  { id: "sessions", pattern: /^sessions(?:[._]|$)/, skill: "otto-system-sessions" },
  { id: "settings", pattern: /^settings(?:[._]|$)/, skill: "otto-system-settings-manager" },
  { id: "skill-gates", pattern: /^skill[-._]?gates(?:[-._]|$)/, skill: "otto-system-skill-gates" },
  { id: "skills", pattern: /^skills(?:[._]|$)/, skill: "otto-system-skill-creator" },
  { id: "specs", pattern: /^specs(?:[._]|$)/, skill: "otto-system-specs" },
  { id: "stickers", pattern: /^stickers(?:[._]|$)/, skill: "otto-system-stickers" },
  { id: "tasks", pattern: /^tasks(?:[._]|$)/, skill: "otto-system-tasks" },
  { id: "triggers", pattern: /^triggers(?:[._]|$)/, skill: "otto-system-trigger-manager" },
  { id: "video", pattern: /^video(?:[._]|$)/, skill: "otto-system-video" },
  { id: "whatsapp", pattern: /^whatsapp(?:[._]|$)/, skill: "otto-system-whatsapp-manager" },
];

const OTTO_GATE_EXEMPT_COMMANDS = new Set([
  "skills.list",
  "skills.show",
  "skills.sync",
  "tools.list",
  "tools.show",
  "tools.manifest",
  "tools.schema",
  "context.codex-bash-hook",
  "context.visibility",
  "sessions.visibility",
  // Pure history read (no mutation), like sessions.visibility above. The fusion
  // Codex peer uses it to see the lead's real work, so it must stay ungated.
  "sessions.read",
]);

export function listDefaultSkillGateRules(): DefaultSkillGateRule[] {
  return DEFAULT_OTTO_GROUP_SKILL_RULES.map((rule) => ({
    id: rule.id,
    pattern: rule.pattern.source,
    skill: rule.skill,
  }));
}

export function isDefaultSkillGateRuleId(id: string): boolean {
  return DEFAULT_OTTO_GROUP_SKILL_RULES.some((rule) => rule.id === id);
}

export function resolveCommandSkillGate(
  input: ResolveCommandSkillGateInput,
  options?: { rules?: readonly SkillGateRuleConfig[] },
): SkillGateMetadata | undefined {
  const fullName = `${input.groupPath}.${input.command}`;
  if (OTTO_GATE_EXEMPT_COMMANDS.has(fullName)) {
    return undefined;
  }

  const configured = resolveConfiguredGroupTargetGate(input.groupPath, options?.rules ?? []);
  if (configured !== undefined) {
    return configured === false ? undefined : configured;
  }

  return inferOttoGroupSkillGate(input.groupPath, { rules: options?.rules });
}

export function resolveRuntimeToolSkillGate(
  input: { toolName: string },
  options?: { rules?: readonly SkillGateRuleConfig[] },
): SkillGateMetadata | undefined {
  if (isExemptOttoToolName(input.toolName)) {
    return undefined;
  }

  const configured = resolveConfiguredToolGate(input.toolName, options?.rules ?? []);
  if (configured !== undefined) {
    return configured === false ? undefined : configured;
  }

  return inferOttoToolSkillGate(input.toolName, { rules: options?.rules });
}

export function inferOttoToolSkillGate(
  toolName: string,
  options?: { rules?: readonly SkillGateRuleConfig[] },
): SkillGateMetadata | undefined {
  if (isExemptOttoToolName(toolName)) {
    return undefined;
  }
  return inferOttoGroupSkillGate(toolName, { rules: options?.rules });
}

export function inferOttoCommandSkillGate(
  commandLine: string,
  options?: { executables?: readonly string[]; rules?: readonly SkillGateRuleConfig[] },
): SkillGateMetadata | undefined {
  const configured = resolveConfiguredCommandGate(commandLine, options);
  if (configured !== undefined) {
    return configured === false ? undefined : configured;
  }

  if (options?.executables && !options.executables.includes("otto")) {
    return undefined;
  }

  const match = /(?:^|[\s;&|])(?:[^\s;&|'"]+\/)?otto\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/i.exec(commandLine);
  if (!match) {
    return undefined;
  }

  const first = normalizeCliSegment(match[1]);
  const second = normalizeCliSegment(match[2]);
  if (second && OTTO_GATE_EXEMPT_COMMANDS.has(`${first}.${second}`)) {
    return undefined;
  }
  const candidates = second ? [`${first}.${second}`, first] : [first];
  for (const groupPath of candidates) {
    const configuredGroup = resolveConfiguredGroupTargetGate(groupPath, options?.rules ?? []);
    if (configuredGroup !== undefined) {
      return configuredGroup === false ? undefined : configuredGroup;
    }

    const inferred = inferOttoGroupSkillGate(groupPath, { rules: options?.rules });
    if (inferred) {
      return inferred;
    }
  }

  return undefined;
}

export function inferOttoGroupSkillGate(
  groupOrToolName: string,
  options?: { rules?: readonly SkillGateRuleConfig[] },
): SkillGateMetadata | undefined {
  const normalized = normalizeGateTarget(groupOrToolName);
  const matched = getEffectiveDefaultRules(options?.rules ?? []).find((rule) => rule.pattern.test(normalized));
  if (!matched) {
    return undefined;
  }

  return {
    skill: matched.skill,
    source: matched.source,
    ruleId: matched.id,
  };
}

function resolveConfiguredToolGate(toolName: string, rules: readonly SkillGateRuleConfig[]): ConfiguredGateResolution {
  const normalized = normalizeGateTarget(toolName);
  for (const rule of rules) {
    if (!ruleHasDirectToolMatcher(rule) && !ruleHasGroupMatcher(rule)) {
      continue;
    }
    if (!configuredToolRuleMatches(rule, normalized, toolName)) {
      continue;
    }
    const resolution = configuredRuleResolution(rule);
    if (resolution !== undefined) {
      return resolution;
    }
  }
  return undefined;
}

function resolveConfiguredCommandGate(
  commandLine: string,
  options?: { executables?: readonly string[]; rules?: readonly SkillGateRuleConfig[] },
): ConfiguredGateResolution {
  const normalizedCommand = normalizeShell(commandLine);
  const rules = options?.rules ?? [];
  for (const rule of rules) {
    if (!ruleHasDirectCommandMatcher(rule)) {
      continue;
    }
    if (!configuredCommandRuleMatches(rule, commandLine, normalizedCommand, options?.executables)) {
      continue;
    }
    const resolution = configuredRuleResolution(rule);
    if (resolution !== undefined) {
      return resolution;
    }
  }
  return undefined;
}

function resolveConfiguredGroupTargetGate(
  groupOrToolName: string,
  rules: readonly SkillGateRuleConfig[],
): ConfiguredGateResolution {
  const normalized = normalizeGateTarget(groupOrToolName);
  for (const rule of rules) {
    if (!ruleHasGroupMatcher(rule)) {
      continue;
    }
    if (!configuredGroupRuleMatches(rule, normalized)) {
      continue;
    }
    const resolution = configuredRuleResolution(rule);
    if (resolution !== undefined) {
      return resolution;
    }
  }
  return undefined;
}

function getEffectiveDefaultRules(rules: readonly SkillGateRuleConfig[]): EffectiveGroupSkillRule[] {
  const effective: EffectiveGroupSkillRule[] = DEFAULT_OTTO_GROUP_SKILL_RULES.map((rule) => ({
    ...rule,
    source: "inferred",
  }));

  for (const config of rules) {
    if (!config.id) {
      continue;
    }
    const index = effective.findIndex((rule) => rule.id === config.id);
    if (index === -1) {
      continue;
    }
    if (isRuleDisabled(config)) {
      effective.splice(index, 1);
      continue;
    }

    const skill = normalizeConfiguredSkill(config.skill);
    const pattern = compileRulePattern(config.pattern ?? config.groupRegex);
    if (!skill && !pattern) {
      continue;
    }

    effective[index] = {
      ...effective[index]!,
      ...(skill ? { skill } : {}),
      ...(pattern ? { pattern } : {}),
      source: "config",
    };
  }

  return effective;
}

function configuredRuleResolution(rule: SkillGateRuleConfig): ConfiguredGateResolution {
  if (isRuleDisabled(rule)) {
    return false;
  }

  const skill = normalizeConfiguredSkill(rule.skill);
  if (!skill) {
    return undefined;
  }

  return {
    skill,
    source: "config",
    ...(rule.id ? { ruleId: rule.id } : {}),
  };
}

function isRuleDisabled(rule: SkillGateRuleConfig): boolean {
  return rule.disabled === true || rule.remove === true || rule.skill === null;
}

function normalizeConfiguredSkill(skill: SkillGateRuleConfig["skill"]): string | undefined {
  return typeof skill === "string" && skill.trim().length > 0 ? skill.trim() : undefined;
}

function configuredToolRuleMatches(
  rule: SkillGateRuleConfig,
  normalizedToolName: string,
  rawToolName: string,
): boolean {
  if (typeof rule.tool === "string" && normalizeGateTarget(rule.tool) === normalizedToolName) {
    return true;
  }
  if (typeof rule.toolPrefix === "string" && normalizedToolName.startsWith(normalizeGateTarget(rule.toolPrefix))) {
    return true;
  }
  if (regexMatches(rule.toolRegex, rawToolName)) {
    return true;
  }
  return configuredGroupRuleMatches(rule, normalizedToolName);
}

function configuredCommandRuleMatches(
  rule: SkillGateRuleConfig,
  rawCommandLine: string,
  normalizedCommandLine: string,
  executables: readonly string[] | undefined,
): boolean {
  if (typeof rule.command === "string" && normalizeShell(rule.command) === normalizedCommandLine) {
    return configuredMatcherExecutableAllowed(rule.command, executables);
  }
  if (
    typeof rule.commandPrefix === "string" &&
    commandStartsWith(normalizedCommandLine, normalizeShell(rule.commandPrefix))
  ) {
    return configuredMatcherExecutableAllowed(rule.commandPrefix, executables);
  }
  return regexMatches(rule.commandRegex, rawCommandLine);
}

function configuredGroupRuleMatches(rule: SkillGateRuleConfig, normalizedTarget: string): boolean {
  return regexMatches(rule.pattern ?? rule.groupRegex, normalizedTarget);
}

function ruleHasDirectToolMatcher(rule: SkillGateRuleConfig): boolean {
  return typeof rule.tool === "string" || typeof rule.toolPrefix === "string" || typeof rule.toolRegex === "string";
}

function ruleHasDirectCommandMatcher(rule: SkillGateRuleConfig): boolean {
  return (
    typeof rule.command === "string" || typeof rule.commandPrefix === "string" || typeof rule.commandRegex === "string"
  );
}

function ruleHasGroupMatcher(rule: SkillGateRuleConfig): boolean {
  return typeof rule.pattern === "string" || typeof rule.groupRegex === "string";
}

function compileRulePattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern) {
    return undefined;
  }
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function regexMatches(pattern: string | undefined, value: string): boolean {
  const regex = compileRulePattern(pattern);
  return regex ? regex.test(value) : false;
}

function configuredMatcherExecutableAllowed(matcher: string, executables: readonly string[] | undefined): boolean {
  if (!executables) {
    return true;
  }
  const firstToken = normalizeShell(matcher).split(" ")[0];
  if (!firstToken) {
    return true;
  }
  const executable = firstToken.split("/").filter(Boolean).at(-1) ?? firstToken;
  return executables.includes(executable);
}

function normalizeCliSegment(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeGateTarget(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeShell(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function commandStartsWith(command: string, prefix: string): boolean {
  if (!prefix) return false;
  return command === prefix || command.startsWith(`${prefix} `) || command.includes(` ${prefix} `);
}

function isExemptOttoToolName(toolName: string): boolean {
  const normalized = normalizeGateTarget(toolName);
  for (const fullName of OTTO_GATE_EXEMPT_COMMANDS) {
    if (normalized === fullName.replace(/\./g, "_")) {
      return true;
    }
  }
  return false;
}
