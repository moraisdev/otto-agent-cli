/**
 * Error hierarchy thrown by `@otto-os/sdk` transports.
 *
 * Both the HTTP and in-process transports normalise gateway responses into
 * these classes so callers can write provider-agnostic catch blocks.
 *
 *   try {
 *     await client.artifacts.show("art_x");
 *   } catch (e) {
 *     if (e instanceof OttoValidationError) {
 *       for (const issue of e.issues) console.log(issue.path, issue.message);
 *     } else if (e instanceof OttoAuthError) {
 *       // refresh context key, retry, etc.
 *     }
 *   }
 */

export type AuthFailureReason = "missing" | "malformed" | "unknown" | "revoked" | "expired" | null;

export interface OttoIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export interface OttoErrorBody {
  error: string;
  message?: string;
  issues?: OttoIssue[];
  reason?: string;
  [key: string]: unknown;
}

/** Base class for every error raised by SDK transports. */
export class OttoError extends Error {
  /** Numeric HTTP status code if the error came from the gateway. */
  public readonly status: number;
  /** Raw body of the gateway response (parsed JSON, when available). */
  public readonly body: OttoErrorBody | null;
  /** Logical command path that triggered the error, e.g. `"artifacts.show"`. */
  public readonly command: string | null;

  constructor(message: string, status: number, body: OttoErrorBody | null = null, command: string | null = null) {
    super(message);
    this.name = "OttoError";
    this.status = status;
    this.body = body;
    this.command = command;
  }
}

/** 401 — missing, malformed, expired, or revoked context-key. */
export class OttoAuthError extends OttoError {
  public readonly reason: AuthFailureReason;
  constructor(message: string, body: OttoErrorBody | null = null, command: string | null = null) {
    super(message, 401, body, command);
    this.name = "OttoAuthError";
    const reason = body && typeof body.reason === "string" ? body.reason : null;
    this.reason = mapReason(reason);
  }
}

/** 403 — scope check denied the request. */
export class OttoPermissionError extends OttoError {
  public readonly reason: string;
  constructor(message: string, body: OttoErrorBody | null = null, command: string | null = null) {
    super(message, 403, body, command);
    this.name = "OttoPermissionError";
    this.reason = body && typeof body.reason === "string" ? body.reason : message;
  }
}

/** 4xx (other than 401/403) — usually 400 ValidationError with `issues[]`. */
export class OttoValidationError extends OttoError {
  public readonly issues: OttoIssue[];
  constructor(
    message: string,
    issues: OttoIssue[],
    status = 400,
    body: OttoErrorBody | null = null,
    command: string | null = null,
  ) {
    super(message, status, body, command);
    this.name = "OttoValidationError";
    this.issues = issues;
  }
}

/** 5xx — internal failure inside the gateway or the underlying handler. */
export class OttoInternalError extends OttoError {
  constructor(message: string, body: OttoErrorBody | null = null, status = 500, command: string | null = null) {
    super(message, status, body, command);
    this.name = "OttoInternalError";
  }
}

/** Network failure, timeout, or unexpected gateway response shape. */
export class OttoTransportError extends OttoError {
  public readonly cause?: unknown;
  constructor(message: string, cause?: unknown, command: string | null = null) {
    super(message, 0, null, command);
    this.name = "OttoTransportError";
    if (cause !== undefined) this.cause = cause;
  }
}

function mapReason(value: string | null): AuthFailureReason {
  switch (value) {
    case "missing":
    case "malformed":
    case "unknown":
    case "revoked":
    case "expired":
      return value;
    default:
      return null;
  }
}

/**
 * Build the right error subclass from a gateway error response.
 * Internal helper used by transports to keep mapping in one place.
 */
export function buildErrorFromGateway(
  status: number,
  body: OttoErrorBody | null,
  command: string | null,
): OttoError {
  const message = pickMessage(body) ?? `Otto gateway returned status ${status}`;
  if (status === 401) return new OttoAuthError(message, body, command);
  if (status === 403) return new OttoPermissionError(message, body, command);
  if (status >= 400 && status < 500) {
    const issues = Array.isArray(body?.issues) ? (body!.issues as OttoIssue[]) : [];
    return new OttoValidationError(message, issues, status, body, command);
  }
  if (status >= 500) return new OttoInternalError(message, body, status, command);
  return new OttoError(message, status, body, command);
}

function pickMessage(body: OttoErrorBody | null): string | null {
  if (!body) return null;
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.reason === "string" && body.reason) return body.reason;
  if (typeof body.error === "string" && body.error) return body.error;
  return null;
}
