/**
 * In-process transport for `@otto-os/sdk`.
 *
 * MONOREPO-INTERNAL ONLY. This module is excluded from the published package
 * (see `tsconfig.json` exclude + `package.json` exports). It imports `otto.bot`
 * internals via relative paths and only works inside this repo.
 *
 * Reuses `dispatch()` from the gateway pipeline so callers running inside the
 * Otto process get the same validation, scope checks, and audit guarantees
 * without any HTTP overhead.
 *
 * Browser/edge/external consumers must use `createHttpTransport` instead.
 *
 * Future publish path: convert `otto.bot` into a peer dep with package-scoped
 * exports for `dispatch`, `RegistrySnapshot`, `ScopeContext`, `ContextRecord`,
 * then re-add `./transport/in-process` to the exports map.
 */

import { dispatch } from "../../../../src/sdk/gateway/dispatcher.js";
import type { CommandRegistryEntry, RegistrySnapshot } from "../../../../src/cli/registry-snapshot.js";
import type { ScopeContext } from "../../../../src/permissions/scope.js";
import type { ContextRecord } from "../../../../src/router/router-db.js";

import type { Transport, TransportCallInput } from "./types.js";
import {
  OttoInternalError,
  OttoTransportError,
  buildErrorFromGateway,
  type OttoErrorBody,
} from "../errors.js";

export interface InProcessTransportConfig {
  /** Live registry snapshot. Usually `getRegistry()`. */
  registry: RegistrySnapshot;
  /** Caller scope. Empty `{}` runs as anonymous (`open` scope only). */
  scopeContext: ScopeContext;
  /** Allow `superadmin`-scoped commands. Off by default. */
  allowSuperadmin?: boolean;
  /** Optional context record threaded into audit lineage. */
  contextRecord?: ContextRecord | null;
}

export function createInProcessTransport(config: InProcessTransportConfig): Transport {
  const { registry, scopeContext, allowSuperadmin, contextRecord } = config;
  const byPath = indexByPath(registry);

  return {
    async call<T>(input: TransportCallInput): Promise<T> {
      const path = `${[...input.groupSegments, input.command].join("/")}`;
      const commandLabel = `${input.groupSegments.join(".")}.${input.command}`;
      const cmd = byPath.get(path);
      if (!cmd) {
        throw new OttoTransportError(`Unknown command: ${commandLabel}`, undefined, commandLabel);
      }

      const result = await dispatch(cmd, input.body ?? {}, scopeContext, {
        ...(allowSuperadmin ? { allowSuperadmin: true } : {}),
        ...(contextRecord !== undefined ? { contextRecord } : {}),
      });

      const status = result.response.status;

      if (input.binary) {
        if (status >= 200 && status < 300) {
          return result.response as unknown as T;
        }
        const text = await safeText(result.response);
        const parsed = parseJson(text);
        if (parsed === null) {
          throw new OttoInternalError(
            `Otto gateway returned status ${status} with no body`,
            null,
            status,
            commandLabel,
          );
        }
        throw buildErrorFromGateway(status, parsed, commandLabel);
      }

      const text = await safeText(result.response);
      const parsed = parseJson(text);

      if (status >= 200 && status < 300) {
        if (parsed === null && text.length === 0) {
          return {} as T;
        }
        return parsed as T;
      }
      if (parsed === null) {
        throw new OttoInternalError(
          `Otto gateway returned status ${status} with no body`,
          null,
          status,
          commandLabel,
        );
      }
      throw buildErrorFromGateway(status, parsed, commandLabel);
    },
  };
}

function indexByPath(registry: RegistrySnapshot): Map<string, CommandRegistryEntry> {
  const map = new Map<string, CommandRegistryEntry>();
  for (const cmd of registry.commands) {
    map.set([...cmd.groupSegments, cmd.command].join("/"), cmd);
  }
  return map;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function parseJson(raw: string): OttoErrorBody | null {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw) as OttoErrorBody;
  } catch {
    return { error: "MalformedResponse", message: raw.slice(0, 1024) };
  }
}
