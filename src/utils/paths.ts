/**
 * Shared path and network utilities
 */

import path from "node:path";
import os from "node:os";

/**
 * Get the Otto state directory (~/.otto)
 */
export function getOttoStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OTTO_STATE_DIR || path.join(os.homedir(), ".otto");
}

/**
 * Normalize a URL by removing trailing slashes
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch with timeout to prevent hanging requests
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
