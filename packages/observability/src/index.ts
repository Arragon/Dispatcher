import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";

const sensitiveKey = /(?:api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;
const sensitiveStringPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
];

export const REDACTED = "[REDACTED]";

function redactString(value: string): string {
  return sensitiveStringPatterns.reduce((result, pattern) => result.replace(pattern, REDACTED), value);
}

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sensitiveKey.test(key) && key !== "credentialRef" ? REDACTED : redactValue(entry, seen)]),
  );
}

export function containsSecretLike(value: unknown): boolean {
  return JSON.stringify(redactValue(value)) !== JSON.stringify(value);
}

export class UnsafeExternalPayloadError extends Error {
  readonly code = "SECRET_LIKE_EXTERNAL_PAYLOAD";

  constructor() {
    super("External payload contains secret-like content");
    this.name = "UnsafeExternalPayloadError";
  }
}

export function assertExternalPayloadSafe(value: unknown): void {
  if (containsSecretLike(value)) throw new UnsafeExternalPayloadError();
}

export function createLogger(options: LoggerOptions = {}, destination?: DestinationStream): Logger {
  const hooks: LoggerOptions["hooks"] = {
    logMethod(args, method) {
      const redactedArgs = args.map((argument) => redactValue(argument));
      const invoke = method as unknown as (...input: unknown[]) => void;
      invoke.apply(this, redactedArgs);
    },
  };
  return pino({ level: "info", ...options, hooks }, destination);
}
