/**
 * Normalize raw NATS session-output events into a discriminated union the REPL
 * client can render. Keeps the (testable) event logic out of the I/O loop.
 *
 * Topics (suffix of otto.session.{name}.*):
 *  - stream   {chunk}            live text delta
 *  - response {response}         final assistant text — turn done
 *  - tool     {event,toolName,…} tool start/end
 *  - prompt   {prompt}           the user's own message echoed back
 *  - runtime/claude              provider noise — ignored
 */

export type SessionEventTopic = "stream" | "response" | "tool" | "prompt" | "runtime" | "claude";

export type ClassifiedSessionEvent =
  | { kind: "stream"; text: string }
  | { kind: "tool-start"; toolName: string; input: unknown }
  | { kind: "tool-end"; toolName: string; output: unknown; isError: boolean }
  | { kind: "response"; text: string }
  | { kind: "user-echo"; text: string }
  | { kind: "ignore" };

export function classifySessionEvent(topic: SessionEventTopic, data: Record<string, unknown>): ClassifiedSessionEvent {
  switch (topic) {
    case "stream": {
      const text = typeof data.chunk === "string" ? data.chunk : "";
      return text ? { kind: "stream", text } : { kind: "ignore" };
    }
    case "response": {
      const text = typeof data.response === "string" ? data.response : "";
      return { kind: "response", text };
    }
    case "tool": {
      const toolName = typeof data.toolName === "string" ? data.toolName : "unknown";
      if (data.event === "start") {
        return { kind: "tool-start", toolName, input: data.input };
      }
      if (data.event === "end") {
        return { kind: "tool-end", toolName, output: data.output, isError: data.isError === true };
      }
      return { kind: "ignore" };
    }
    case "prompt": {
      const text = typeof data.prompt === "string" ? data.prompt : "";
      return { kind: "user-echo", text };
    }
    default:
      return { kind: "ignore" };
  }
}
