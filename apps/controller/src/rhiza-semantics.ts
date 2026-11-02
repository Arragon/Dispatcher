import { createHash } from "node:crypto";
import { RhizaIngressError } from "./rhiza-auth.js";

const invalid = (): never => { throw new RhizaIngressError("INVALID_REQUEST", 400, "The ingress semantic value is invalid"); };
function quoted(value: string): string {
  for (const character of value) { const code = character.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) invalid(); }
  return JSON.stringify(value);
}

/** Ingress v1 canonical JSON; deliberately independent of legacy UI hashing. */
export function canonicalRhizaJson(value: unknown): string {
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): string => {
    if (depth > 64) return invalid();
    if (value === null) return "null";
    if (typeof value === "string") return quoted(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : invalid();
    if (typeof value !== "object" || ancestors.has(value)) return invalid();
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length) return invalid();
        const items: string[] = [];
        for (let index = 0; index < value.length; index++) { if (!Object.hasOwn(value, index)) return invalid(); items.push(visit(value[index], depth + 1)); }
        return `[${items.join(",")}]`;
      }
      return `{${Object.keys(value).sort().map(key => `${quoted(key)}:${visit((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
    } finally { ancestors.delete(value); }
  };
  return visit(value, 0);
}
export const rhizaDigest = (value: unknown): string => createHash("sha256").update(canonicalRhizaJson(value), "utf8").digest("hex");
export function rhizaInputHash(content: string): string {
  quoted(content);
  return createHash("sha256").update(content, "utf8").digest("hex");
}
export function rhizaApprovalDigest<T extends { approval: { reference: string; expiresAt: string } }>(order: T): string {
  const { approval, ...workOrder } = order;
  return rhizaDigest({ workOrder, approval: { reference: approval.reference, expiresAt: approval.expiresAt } });
}
