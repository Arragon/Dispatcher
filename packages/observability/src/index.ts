import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";

const sensitiveKey = /(?:api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;
const sensitiveStringPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
];

export const REDACTED = "[REDACTED]";
const credentialLabel=/(?:password|api[-_]?key|authorization|credential|private[-_]?key|secret|token|cookie)$/i;
const nativeAuthName="(?:codex[-_]?home|opencode[-_]?home|config[-_]?dir|auth[-_]?(?:dir(?:ectory)?|file)|native[-_]?auth[-_]?(?:dir(?:ectory)?|path)|user[-_]?data[-_]?dir|credential[-_]?path|oauth[-_]?directory|acp[-_]?directory)";
const nativeAuthKey=new RegExp(`^${nativeAuthName}$`,"i");
// Keep the persisted SecretReference grammar, including nested names; never resolve it here.
function isOpaqueSecretReference(value:string):boolean {return /^secret:\/\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/.test(value)&&!value.slice("secret://".length).includes("..");}
/** Scan each label once; a credential-prefix regex can backtrack on every hyphen. */
function redactAssignments(value:string,labelPattern:RegExp):string {
  const labels=/[a-z0-9_-]+/gi;
  let result="",copied=0;
  for(let label=labels.exec(value);label;label=labels.exec(value)) {
    const flag=label[0].startsWith("--");
    if(!labelPattern.test(flag?label[0].slice(2):label[0]))continue;
    const suffix=value.slice(labels.lastIndex);
    const separator=/^["']?\s*[:=]\s*/.exec(suffix)??(flag?/^\s+/.exec(suffix):null);
    if(!separator)continue;
    const payload=/^(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s"',;}]+)/.exec(suffix.slice(separator[0].length));
    if(!payload)continue;
    const end=labels.lastIndex+separator[0].length+payload[0].length;
    result+=value.slice(copied,label.index)+REDACTED;
    copied=end;labels.lastIndex=end;
  }
  return result+value.slice(copied);
}
function redactNativeCredentials(value:string):string {
  if(isOpaqueSecretReference(value))return value;
  return redactAssignments(value,credentialLabel).replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,REDACTED).replace(/\bBearer\s+[^\s"',;}]+/gi,REDACTED).replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi,REDACTED);
}
export function redactNativeText(value:string):string {
  return redactAssignments(redactNativeCredentials(value),nativeAuthKey).replace(/(?:\/|[A-Z]:\\)[^\r\n"',;}]+/gi,path=>{
    // Scan a path-like span once rather than retrying every slash in a long transcript.
    const native=/(?:[/\\]\.codex(?:[-_][A-Za-z0-9_.-]+)?|\/(?:\.config|\.local\/share)\/opencode)(?=[/\\\s]|$)/i.exec(path);
    if(!native)return path;
    // Unquoted spaces cannot distinguish a pathname from another path/diagnostic;
    // remove the whole span so later auth directories cannot survive the first match.
    return REDACTED;
  });
}

/** Scoped native diagnostics/evidence sanitizer; does not alter ordinary logger semantics. */
export function redactNativePayload(value:unknown,seen=new WeakSet<object>()):unknown {
  if(typeof value==="string")return redactNativeText(value);
  if(value===null||typeof value!=="object")return value;
  if(seen.has(value))return "[CIRCULAR]";seen.add(value);
  if(Array.isArray(value))return value.map(entry=>redactNativePayload(entry,seen));
  return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,key==="credentialRef"?typeof entry==="string"&&isOpaqueSecretReference(entry)?entry:REDACTED:sensitiveKey.test(key)||/cookie/i.test(key)||nativeAuthKey.test(key)?REDACTED:redactNativePayload(entry,seen)]));
}


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
