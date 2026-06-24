import "reflect-metadata";
import { Arg, Command, Group, Option } from "../decorators.js";
import { fail } from "../context.js";
import { buildCliOffsetPagination, paginateCliItems } from "../pagination.js";
import { configStore } from "../../config-store.js";
import {
  discoverOttoCommands,
  normalizeOttoCommandId,
  renderOttoCommand,
  resolveOttoCommand,
  type OttoCommandIssue,
  type OttoCommandRecord,
} from "../../commands/index.js";
import type { AgentConfig } from "../../router/types.js";
import { filterItemsByCanonicalTag } from "../../tags/helpers.js";

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function resolveAgent(agentId?: string): AgentConfig {
  const config = configStore.getConfig();
  const resolvedAgentId = agentId?.trim() || config.defaultAgent;
  const agent = config.agents[resolvedAgentId];
  if (!agent) {
    fail(`Agent not found: ${resolvedAgentId}`);
  }
  return agent;
}

function serializeIssue(issue: OttoCommandIssue): Record<string, unknown> {
  return {
    level: issue.level,
    code: issue.code,
    message: issue.message,
    id: issue.id ?? null,
    scope: issue.scope ?? null,
    path: issue.path ?? null,
  };
}

function serializeCommand(
  command: OttoCommandRecord,
  options: { includeBody?: boolean } = {},
): Record<string, unknown> {
  return {
    id: command.id,
    token: `#${command.id}`,
    title: command.title ?? null,
    description: command.description ?? null,
    argumentHint: command.argumentHint ?? null,
    arguments: command.arguments,
    disabled: command.disabled,
    scope: command.scope,
    path: command.path,
    relativePath: command.relativePath,
    shadowedBy: command.shadowedBy ?? null,
    shadows: command.shadows ?? [],
    issues: command.issues.map(serializeIssue),
    ...(options.includeBody ? { body: command.body, frontmatter: command.frontmatter } : {}),
  };
}

function printCommandSummary(command: OttoCommandRecord): void {
  const disabled = command.disabled ? " disabled" : "";
  const shadow = command.shadows?.length ? " shadows global" : command.shadowedBy ? " shadowed" : "";
  const description = command.description ? ` - ${command.description}` : "";
  console.log(`#${command.id} [${command.scope}${disabled}${shadow}]${description}`);
  console.log(`  ${command.path}`);
  if (command.argumentHint) {
    console.log(`  args: ${command.argumentHint}`);
  }
  for (const issue of command.issues) {
    console.log(`  ${issue.level}: ${issue.code} - ${issue.message}`);
  }
}

function printIssue(issue: OttoCommandIssue): void {
  const target = [issue.scope, issue.id ? `#${issue.id}` : null, issue.path].filter(Boolean).join(" ");
  console.log(`${issue.level}: ${issue.code}${target ? ` (${target})` : ""}`);
  console.log(`  ${issue.message}`);
}

function normalizeRestArgs(rest?: string[]): string[] {
  return Array.isArray(rest) ? rest : [];
}

@Group({
  name: "commands",
  description: "Manage Otto prompt commands",
  scope: "open",
})
export class OttoCommandsCommands {
  @Command({ name: "list", description: "List Otto commands" })
  list(
    @Option({ flags: "--agent <id>", description: "Resolve agent-scoped commands for this agent" }) agentId?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
    @Option({ flags: "--tag <slug>", description: "Filter by canonical command tag" }) tagSlug?: string,
    @Option({ flags: "--limit <n>", description: "Page size (default: 50, max: 500)" }) limit?: string,
    @Option({ flags: "--offset <n>", description: "Number of matching commands to skip (default: 0)" }) offset?: string,
  ) {
    const agent = resolveAgent(agentId);
    const registry = discoverOttoCommands({ agentCwd: agent.cwd });
    const tagFilter = tagSlug?.trim() || null;
    const commands = filterItemsByCanonicalTag(
      registry.commands,
      "command",
      tagFilter ?? undefined,
      (command) => command.id,
    );
    const page = paginateCliItems(commands, { limit, offset });
    const pageCommands = page.items;
    const pagination = buildCliOffsetPagination({
      baseCommand: ["otto", "commands", "list"],
      limit: page.limit,
      offset: page.offset,
      returned: pageCommands.length,
      total: page.total,
      options: ["--agent", agentId, "--tag", tagFilter],
    });
    const payload = {
      total: page.total,
      pagination,
      ...(tagFilter ? { filters: { tag: tagFilter } } : {}),
      agent: { id: agent.id, cwd: agent.cwd },
      locations: {
        agent: registry.agentCommandsDir ?? null,
        global: registry.globalCommandsDir,
      },
      items: pageCommands.map((command) => serializeCommand(command)),
      commands: pageCommands.map((command) => serializeCommand(command)),
      issues: registry.issues.map(serializeIssue),
    };

    if (asJson) {
      printJson(payload);
      return payload;
    }
    if (pageCommands.length === 0) {
      console.log("No Otto commands found.");
      return payload;
    }
    console.log(
      `Otto commands (${pageCommands.length} returned of ${page.total}, limit ${page.limit}, offset ${page.offset}):`,
    );
    for (const command of pageCommands) {
      printCommandSummary(command);
    }
    if (pagination.nextCommand) {
      console.log("\nNext page:");
      console.log(`  ${pagination.nextCommand}`);
    }
    if (registry.issues.length > 0) {
      console.log("");
      console.log(`Issues (${registry.issues.length}):`);
      for (const issue of registry.issues) printIssue(issue);
    }
    return payload;
  }

  @Command({ name: "show", description: "Show one Otto command" })
  show(
    @Arg("name", { description: "Command name, with or without #" }) name: string,
    @Option({ flags: "--agent <id>", description: "Resolve agent-scoped commands for this agent" }) agentId?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const agent = resolveAgent(agentId);
    const id = normalizeOttoCommandId(name);
    const registry = discoverOttoCommands({ agentCwd: agent.cwd });
    const command = resolveOttoCommand(registry, id);
    if (!command) {
      fail(`Otto command not found: #${id}`);
    }

    const payload = {
      agent: { id: agent.id, cwd: agent.cwd },
      command: serializeCommand(command, { includeBody: true }),
    };
    if (asJson) {
      printJson(payload);
      return payload;
    }
    printCommandSummary(command);
    console.log("");
    console.log(command.body.trimEnd());
    return payload;
  }

  @Command({ name: "validate", description: "Validate Otto command files" })
  validate(
    @Option({ flags: "--agent <id>", description: "Resolve agent-scoped commands for this agent" }) agentId?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const agent = resolveAgent(agentId);
    const registry = discoverOttoCommands({ agentCwd: agent.cwd });
    const errors = registry.issues.filter((issue) => issue.level === "error");
    const warnings = registry.issues.filter((issue) => issue.level === "warning");
    const payload = {
      valid: errors.length === 0,
      agent: { id: agent.id, cwd: agent.cwd },
      total: registry.entries.length,
      effectiveTotal: registry.commands.length,
      errors: errors.map(serializeIssue),
      warnings: warnings.map(serializeIssue),
    };

    if (asJson) {
      printJson(payload);
    } else if (errors.length === 0 && warnings.length === 0) {
      console.log(`Otto commands valid (${registry.entries.length} files).`);
    } else {
      console.log(`Otto command validation: ${errors.length} errors, ${warnings.length} warnings`);
      for (const issue of registry.issues) printIssue(issue);
    }
    if (errors.length > 0) {
      process.exitCode = 1;
    }
    return payload;
  }

  @Command({ name: "run", description: "Render a Otto command into its composed prompt" })
  run(
    @Arg("name", { description: "Command name, with or without #" }) name: string,
    @Arg("args", { required: false, variadic: true, description: "Command arguments" }) rest?: string[],
    @Option({ flags: "--agent <id>", description: "Resolve agent-scoped commands for this agent" }) agentId?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const agent = resolveAgent(agentId);
    const id = normalizeOttoCommandId(name);
    const args = normalizeRestArgs(rest);
    const rawArguments = args.join(" ");
    const registry = discoverOttoCommands({ agentCwd: agent.cwd });
    const command = resolveOttoCommand(registry, id);
    if (!command) {
      fail(`Otto command not found: #${id}`);
    }

    const rendered = renderOttoCommand(
      command,
      {
        id,
        token: `#${id}`,
        rawArguments,
        originalText: `#${id}${rawArguments ? ` ${rawArguments}` : ""}`,
      },
      args,
    );
    const payload = {
      agent: { id: agent.id, cwd: agent.cwd },
      command: serializeCommand(command),
      metadata: rendered.metadata,
      positionalArguments: rendered.positionalArguments,
      prompt: rendered.prompt,
    };

    if (asJson) {
      printJson(payload);
      return payload;
    }
    console.log(rendered.prompt);
    return payload;
  }
}
