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
/** Base class for every error raised by SDK transports. */
export class OttoError extends Error {
    /** Numeric HTTP status code if the error came from the gateway. */
    status;
    /** Raw body of the gateway response (parsed JSON, when available). */
    body;
    /** Logical command path that triggered the error, e.g. `"artifacts.show"`. */
    command;
    constructor(message, status, body = null, command = null) {
        super(message);
        this.name = "OttoError";
        this.status = status;
        this.body = body;
        this.command = command;
    }
}
/** 401 — missing, malformed, expired, or revoked context-key. */
export class OttoAuthError extends OttoError {
    reason;
    constructor(message, body = null, command = null) {
        super(message, 401, body, command);
        this.name = "OttoAuthError";
        const reason = body && typeof body.reason === "string" ? body.reason : null;
        this.reason = mapReason(reason);
    }
}
/** 403 — scope check denied the request. */
export class OttoPermissionError extends OttoError {
    reason;
    constructor(message, body = null, command = null) {
        super(message, 403, body, command);
        this.name = "OttoPermissionError";
        this.reason = body && typeof body.reason === "string" ? body.reason : message;
    }
}
/** 4xx (other than 401/403) — usually 400 ValidationError with `issues[]`. */
export class OttoValidationError extends OttoError {
    issues;
    constructor(message, issues, status = 400, body = null, command = null) {
        super(message, status, body, command);
        this.name = "OttoValidationError";
        this.issues = issues;
    }
}
/** 5xx — internal failure inside the gateway or the underlying handler. */
export class OttoInternalError extends OttoError {
    constructor(message, body = null, status = 500, command = null) {
        super(message, status, body, command);
        this.name = "OttoInternalError";
    }
}
/** Network failure, timeout, or unexpected gateway response shape. */
export class OttoTransportError extends OttoError {
    cause;
    constructor(message, cause, command = null) {
        super(message, 0, null, command);
        this.name = "OttoTransportError";
        if (cause !== undefined)
            this.cause = cause;
    }
}
function mapReason(value) {
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
export function buildErrorFromGateway(status, body, command) {
    const message = pickMessage(body) ?? `Otto gateway returned status ${status}`;
    if (status === 401)
        return new OttoAuthError(message, body, command);
    if (status === 403)
        return new OttoPermissionError(message, body, command);
    if (status >= 400 && status < 500) {
        const issues = Array.isArray(body?.issues) ? body.issues : [];
        return new OttoValidationError(message, issues, status, body, command);
    }
    if (status >= 500)
        return new OttoInternalError(message, body, status, command);
    return new OttoError(message, status, body, command);
}
function pickMessage(body) {
    if (!body)
        return null;
    if (typeof body.message === "string" && body.message)
        return body.message;
    if (typeof body.reason === "string" && body.reason)
        return body.reason;
    if (typeof body.error === "string" && body.error)
        return body.error;
    return null;
}
//# sourceMappingURL=errors.js.map