import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { AgentConfig } from "../router/types.js";
import { getOttoStateDir } from "../utils/paths.js";
import type { RuntimeLaunchPrompt, OttoCommandPromptMetadata } from "../runtime/message-types.js";

export type OttoCommandScope = "agent" | "global";
export type OttoCommandIssueLevel = "error" | "warning";

export const OTTO_COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const LOWERCASE_OTTO_COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SUPPORTED_FRONTMATTER_KEYS = new Set(["title", "description", "argument-hint", "arguments", "disabled"]);
const UNSUPPORTED_CAPABILITY_KEYS = new Set([
  "allowed-tools",
  "model",
  "effort",
  "thinking",
  "shell",
  "hooks",
  "context",
  "agent",
]);

type FrontmatterValue = string | string[] | boolean;

export interface OttoCommandIssue {
  level: OttoCommandIssueLevel;
  code: string;
  message: string;
  id?: string;
  scope?: OttoCommandScope;
  path?: string;
}

export interface OttoCommandRecord {
  id: string;
  fileName: string;
  title?: string;
  description?: string;
  argumentHint?: string;
  arguments: string[];
  disabled: boolean;
  scope: OttoCommandScope;
  path: string;
  relativePath: string;
  body: string;
  frontmatter: Record<string, FrontmatterValue>;
  issues: OttoCommandIssue[];
  shadowedBy?: string;
  shadows?: string[];
}

export interface OttoCommandRegistry {
  agentCwd?: string;
  agentCommandsDir?: string;
  globalCommandsDir: string;
  entries: OttoCommandRecord[];
  commands: OttoCommandRecord[];
  issues: OttoCommandIssue[];
}

export interface OttoCommandInvocation {
  id: string;
  token: string;
  rawArguments: string;
  originalText: string;
}

export type OttoCommandInvocationParseResult =
  | { kind: "none" }
  | { kind: "invalid"; originalText: string; message: string }
  | ({ kind: "command" } & OttoCommandInvocation);

export interface RenderedOttoCommand {
  prompt: string;
  metadata: OttoCommandPromptMetadata;
  command: OttoCommandRecord;
  positionalArguments: string[];
}

export class OttoCommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly commandId?: string,
  ) {
    super(message);
    this.name = "OttoCommandError";
  }
}

export interface DiscoverOttoCommandsOptions {
  agentCwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ExpandOttoCommandPromptOptions {
  agent: AgentConfig;
  env?: NodeJS.ProcessEnv;
}

export function getOttoCommandsHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.OTTO_HOME || getOttoStateDir(env);
}

export function getGlobalOttoCommandsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getOttoCommandsHome(env), "commands");
}

export function getAgentOttoCommandsDir(agentCwd: string): string {
  return join(resolve(agentCwd), ".otto", "commands");
}

export function parseOttoCommandInvocation(text: string): OttoCommandInvocationParseResult {
  const originalText = text;
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith("#")) {
    return { kind: "none" };
  }

  const tokenMatch = /^#(\S*)/.exec(trimmedStart);
  const rawName = tokenMatch?.[1] ?? "";
  if (!rawName) {
    return { kind: "invalid", originalText, message: "Command name is required after #." };
  }
  if (!OTTO_COMMAND_NAME_PATTERN.test(rawName)) {
    return {
      kind: "invalid",
      originalText,
      message:
        `Invalid command name "#${rawName}". Use letters, numbers, and hyphens; ` +
        "start with a letter or number; max length is 64.",
    };
  }

  const token = `#${rawName}`;
  const rest = trimmedStart.slice(token.length);
  if (rest.length > 0 && !/^\s/.test(rest)) {
    return {
      kind: "invalid",
      originalText,
      message: `Invalid command token "${token}". The command token must end before the next non-whitespace text.`,
    };
  }

  return {
    kind: "command",
    id: rawName.toLowerCase(),
    token,
    rawArguments: rest.replace(/^\s+/, ""),
    originalText,
  };
}

export function normalizeOttoCommandId(value: string): string {
  const trimmed = value.trim().replace(/^#/, "");
  if (!trimmed) {
    throw new OttoCommandError("Command name is required.", "invalid_command_name");
  }
  if (!OTTO_COMMAND_NAME_PATTERN.test(trimmed)) {
    throw new OttoCommandError(
      `Invalid command name "${value}". Use letters, numbers, and hyphens; start with a letter or number; max length is 64.`,
      "invalid_command_name",
      trimmed.toLowerCase(),
    );
  }
  return trimmed.toLowerCase();
}

export function discoverOttoCommands(options: DiscoverOttoCommandsOptions = {}): OttoCommandRegistry {
  const env = options.env ?? process.env;
  const agentCwd = options.agentCwd ? resolve(options.agentCwd) : undefined;
  const agentCommandsDir = agentCwd ? getAgentOttoCommandsDir(agentCwd) : undefined;
  const globalCommandsDir = getGlobalOttoCommandsDir(env);
  const entries = [
    ...(agentCommandsDir ? readCommandScope("agent", agentCommandsDir) : []),
    ...readCommandScope("global", globalCommandsDir),
  ];
  const issues = entries.flatMap((entry) => entry.issues);

  for (const issue of findDuplicateIssues(entries)) {
    issues.push(issue);
    for (const entry of entries.filter((candidate) => candidate.id === issue.id && candidate.scope === issue.scope)) {
      entry.issues.push(issue);
    }
  }

  const commands = buildEffectiveCommands(entries);
  return {
    agentCwd,
    agentCommandsDir,
    globalCommandsDir,
    entries,
    commands,
    issues,
  };
}

export function resolveOttoCommand(registry: OttoCommandRegistry, id: string): OttoCommandRecord | undefined {
  const normalizedId = normalizeOttoCommandId(id);
  const agentEntries = registry.entries.filter((entry) => entry.id === normalizedId && entry.scope === "agent");
  const globalEntries = registry.entries.filter((entry) => entry.id === normalizedId && entry.scope === "global");
  const candidateEntries = agentEntries.length > 0 ? agentEntries : globalEntries;
  const validCandidateEntries = candidateEntries.filter((entry) => !hasEntryError(entry, "invalid_command_file_name"));

  if (validCandidateEntries.length > 1) {
    throw new OttoCommandError(
      `Command #${normalizedId} is ambiguous: ${validCandidateEntries.map((entry) => entry.path).join(", ")}`,
      "duplicate_command",
      normalizedId,
    );
  }

  const command = validCandidateEntries[0];
  if (!command) {
    return undefined;
  }
  const firstError = command.issues.find((issue) => issue.level === "error");
  if (firstError) {
    throw new OttoCommandError(firstError.message, firstError.code, normalizedId);
  }
  return command;
}

export function renderOttoCommand(
  command: OttoCommandRecord,
  invocation: OttoCommandInvocation,
  positionalArgumentOverride?: string[],
): RenderedOttoCommand {
  if (command.disabled) {
    throw new OttoCommandError(`Command #${command.id} is disabled.`, "disabled_command", command.id);
  }

  const positionalArguments = positionalArgumentOverride ?? parseShellLikeArguments(invocation.rawArguments);
  const renderedBody = renderOttoCommandBody(command.body, {
    rawArguments: invocation.rawArguments,
    positionalArguments,
    namedArguments: command.arguments,
  });
  const prompt = composePromptText(command, invocation, renderedBody);
  const metadata: OttoCommandPromptMetadata = {
    id: command.id,
    scope: command.scope,
    sourcePath: command.path,
    originalText: invocation.originalText,
    arguments: invocation.rawArguments,
    renderedPromptSha256: sha256Text(prompt),
  };

  return {
    prompt,
    metadata,
    command,
    positionalArguments,
  };
}

export function renderOttoCommandByName(input: {
  name: string;
  rawArguments?: string;
  originalText?: string;
  agent: AgentConfig;
  env?: NodeJS.ProcessEnv;
}): RenderedOttoCommand {
  const id = normalizeOttoCommandId(input.name);
  const rawArguments = input.rawArguments ?? "";
  const originalText = input.originalText ?? `#${id}${rawArguments ? ` ${rawArguments}` : ""}`;
  const registry = discoverOttoCommands({ agentCwd: input.agent.cwd, env: input.env });
  const command = resolveOttoCommand(registry, id);
  if (!command) {
    throw new OttoCommandError(`Unknown Otto command: #${id}.`, "unknown_command", id);
  }
  return renderOttoCommand(command, {
    id,
    token: `#${id}`,
    rawArguments,
    originalText,
  });
}

export function expandOttoCommandPrompt(
  prompt: RuntimeLaunchPrompt,
  options: ExpandOttoCommandPromptOptions,
): RuntimeLaunchPrompt {
  const invocation = parseOttoCommandInvocation(prompt.prompt);
  if (invocation.kind === "none") {
    return prompt;
  }
  if (invocation.kind === "invalid") {
    throw new OttoCommandError(invocation.message, "invalid_command_name");
  }

  const registry = discoverOttoCommands({ agentCwd: options.agent.cwd, env: options.env });
  const command = resolveOttoCommand(registry, invocation.id);
  if (!command) {
    return prompt;
  }

  const rendered = renderOttoCommand(command, invocation);
  return {
    ...prompt,
    prompt: rendered.prompt,
    commands: [...(prompt.commands ?? []), rendered.metadata],
  };
}

export function parseShellLikeArguments(rawArguments: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of rawArguments) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

function readCommandScope(scope: OttoCommandScope, dir: string): OttoCommandRecord[] {
  if (!existsSync(dir)) {
    return [];
  }
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    return [];
  }
  return walkMarkdownFiles(dir).map((path) => readCommandFile(scope, dir, path));
}

function walkMarkdownFiles(root: string): string[] {
  const results: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(path);
      }
    }
  };
  visit(root);
  return results.sort((a, b) => a.localeCompare(b));
}

function readCommandFile(scope: OttoCommandScope, root: string, path: string): OttoCommandRecord {
  const fileName = basename(path, extname(path));
  const id = fileName.toLowerCase();
  const issues: OttoCommandIssue[] = [];
  const relativePath = relative(root, path);

  if (!OTTO_COMMAND_NAME_PATTERN.test(fileName)) {
    issues.push({
      level: "error",
      code: "invalid_command_file_name",
      message:
        `Invalid command filename "${basename(path)}". Use letters, numbers, and hyphens before .md; ` +
        "start with a letter or number; max length is 64.",
      id,
      scope,
      path,
    });
  } else if (!LOWERCASE_OTTO_COMMAND_NAME_PATTERN.test(fileName)) {
    issues.push({
      level: "warning",
      code: "non_lowercase_command_file_name",
      message: `Command filename "${basename(path)}" works, but lowercase ASCII filenames are preferred.`,
      id,
      scope,
      path,
    });
  }

  let frontmatter: Record<string, FrontmatterValue> = {};
  let body = readFileSync(path, "utf8");
  try {
    const parsed = parseCommandFile(body);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
    issues.push(...validateFrontmatter(frontmatter, { id, scope, path }));
  } catch (error) {
    issues.push({
      level: "error",
      code: "invalid_frontmatter",
      message: error instanceof Error ? error.message : String(error),
      id,
      scope,
      path,
    });
  }

  return {
    id,
    fileName,
    title: scalarString(frontmatter.title),
    description: scalarString(frontmatter.description),
    argumentHint: scalarString(frontmatter["argument-hint"]),
    arguments: frontmatterArray(frontmatter.arguments),
    disabled: frontmatter.disabled === true,
    scope,
    path,
    relativePath,
    body,
    frontmatter,
    issues,
  };
}

function parseCommandFile(content: string): { frontmatter: Record<string, FrontmatterValue>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  return {
    frontmatter: parseFrontmatterBlock(match[1]!),
    body: content.slice(match[0].length),
  };
}

function parseFrontmatterBlock(block: string): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = {};
  let activeArrayKey: string | null = null;

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const arrayMatch = /^\s*-\s+(.+)$/.exec(line);
    if (arrayMatch && activeArrayKey) {
      const current = result[activeArrayKey];
      if (!Array.isArray(current)) {
        throw new Error(`Invalid frontmatter array for ${activeArrayKey}.`);
      }
      current.push(stripYamlQuotes(arrayMatch[1]!.trim()));
      continue;
    }

    const fieldMatch = /^([a-zA-Z_][a-zA-Z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (!fieldMatch) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    const key = fieldMatch[1]!;
    const rawValue = fieldMatch[2] ?? "";
    if (!rawValue.trim()) {
      result[key] = [];
      activeArrayKey = key;
      continue;
    }

    result[key] = parseInlineFrontmatterValue(rawValue);
    activeArrayKey = null;
  }

  return result;
}

function parseInlineFrontmatterValue(rawValue: string): FrontmatterValue {
  const value = rawValue.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((entry) => stripYamlQuotes(entry.trim()))
      .filter(Boolean);
  }
  return stripYamlQuotes(value);
}

function stripYamlQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function validateFrontmatter(
  frontmatter: Record<string, FrontmatterValue>,
  context: Pick<OttoCommandIssue, "id" | "scope" | "path">,
): OttoCommandIssue[] {
  const issues: OttoCommandIssue[] = [];
  for (const key of Object.keys(frontmatter)) {
    if (SUPPORTED_FRONTMATTER_KEYS.has(key)) continue;
    issues.push({
      level: "warning",
      code: UNSUPPORTED_CAPABILITY_KEYS.has(key) ? "unsupported_capability_frontmatter" : "unsupported_frontmatter",
      message: `Unsupported command frontmatter "${key}" is ignored.`,
      ...context,
    });
  }

  if (frontmatter.arguments !== undefined && !Array.isArray(frontmatter.arguments)) {
    issues.push({
      level: "error",
      code: "invalid_arguments_frontmatter",
      message: "Command frontmatter arguments must be a list of names.",
      ...context,
    });
  }
  if (frontmatter.disabled !== undefined && typeof frontmatter.disabled !== "boolean") {
    issues.push({
      level: "error",
      code: "invalid_disabled_frontmatter",
      message: "Command frontmatter disabled must be true or false.",
      ...context,
    });
  }
  return issues;
}

function findDuplicateIssues(entries: OttoCommandRecord[]): OttoCommandIssue[] {
  const issues: OttoCommandIssue[] = [];
  for (const scope of ["agent", "global"] as const) {
    const byId = new Map<string, OttoCommandRecord[]>();
    for (const entry of entries.filter((candidate) => candidate.scope === scope)) {
      if (hasEntryError(entry, "invalid_command_file_name")) continue;
      byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
    }
    for (const [id, duplicates] of byId.entries()) {
      if (duplicates.length < 2) continue;
      issues.push({
        level: "error",
        code: "duplicate_command",
        message: `Duplicate #${id} commands in ${scope} scope: ${duplicates.map((entry) => entry.path).join(", ")}`,
        id,
        scope,
      });
    }
  }
  return issues;
}

function buildEffectiveCommands(entries: OttoCommandRecord[]): OttoCommandRecord[] {
  const byId = new Map<string, OttoCommandRecord[]>();
  for (const entry of entries) {
    if (hasEntryError(entry, "invalid_command_file_name")) continue;
    byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  }

  const commands: OttoCommandRecord[] = [];
  for (const candidates of byId.values()) {
    const agentCommands = candidates.filter((candidate) => candidate.scope === "agent");
    const globalCommands = candidates.filter((candidate) => candidate.scope === "global");
    const effective = (agentCommands[0] ?? globalCommands[0]) as OttoCommandRecord | undefined;
    if (!effective) continue;

    if (effective.scope === "agent" && globalCommands.length > 0) {
      effective.shadows = globalCommands.map((entry) => entry.path);
      for (const globalCommand of globalCommands) {
        globalCommand.shadowedBy = effective.path;
      }
    }
    commands.push(effective);
  }

  return commands.sort((a, b) => a.id.localeCompare(b.id));
}

function hasEntryError(entry: OttoCommandRecord, code?: string): boolean {
  return entry.issues.some((issue) => issue.level === "error" && (!code || issue.code === code));
}

function scalarString(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function frontmatterArray(value: FrontmatterValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function renderOttoCommandBody(
  body: string,
  input: {
    rawArguments: string;
    positionalArguments: string[];
    namedArguments: string[];
  },
): string {
  let sawPlaceholder = false;
  let rendered = body.replace(/\$ARGUMENTS(?:\[(\d+)])?/g, (_match, index: string | undefined) => {
    sawPlaceholder = true;
    if (index === undefined) return input.rawArguments;
    return input.positionalArguments[Number(index)] ?? "";
  });

  rendered = rendered.replace(/\$(\d+)/g, (_match, index: string) => {
    sawPlaceholder = true;
    return input.positionalArguments[Number(index)] ?? "";
  });

  const names = new Map(input.namedArguments.map((name, index) => [name, input.positionalArguments[index] ?? ""]));
  rendered = rendered.replace(/\$([A-Za-z_][A-Za-z0-9_-]*)/g, (match, name: string) => {
    if (name === "ARGUMENTS") {
      sawPlaceholder = true;
      return input.rawArguments;
    }
    if (!names.has(name)) {
      return match;
    }
    sawPlaceholder = true;
    return names.get(name) ?? "";
  });

  if (input.rawArguments.trim() && !sawPlaceholder) {
    return `${rendered.trimEnd()}\n\nARGUMENTS: ${input.rawArguments}`;
  }
  return rendered;
}

function composePromptText(
  command: OttoCommandRecord,
  invocation: OttoCommandInvocation,
  renderedBody: string,
): string {
  const lines = [
    `## Otto Command: #${command.id}`,
    "",
    `Source: ${command.scope}`,
    `Path: ${command.path}`,
    `Original: ${invocation.originalText}`,
    `Arguments: ${invocation.rawArguments || "(none)"}`,
    "",
    "---",
    "",
    renderedBody.trimEnd(),
  ];
  return lines.join("\n").trimEnd();
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
