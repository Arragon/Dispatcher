import { AdapterContractError } from "@dispatcher/adapters";
import type { AccountModelCatalog } from "@dispatcher/domain";
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const parameter = (value: unknown) => typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 4000;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function remoteCatalog(value: unknown, expected: { profileId: string; runnerId: string; providerId: string }): AccountModelCatalog {
  const invalid = (): never => { throw new AdapterContractError("REMOTE_RESULT_INVALID", "Owning Runner returned an invalid or mismatched native catalog"); };
  if (!object(value) || !keys(value, ["profileId", "runnerId", "providerId", "backendId", "contextFingerprint", "revision", "fetchedAt", "freshness", "source", "selectionSupport", "entries", "failure"]) || Object.entries(expected).some(([key, expected]) => value[key] !== expected) || ![value.backendId, value.contextFingerprint, value.revision].every(item => text(item, 1000)) || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt)) || !["native-fresh", "native-cache", "unverified"].includes(String(value.freshness)) || !["cli-query", "native-rpc", "account-api"].includes(String(value.source)) || !["explicit", "native-default-only", "unsupported"].includes(String(value.selectionSupport)) || !Array.isArray(value.entries) || value.entries.length > 10000) return invalid();
  if (value.failure !== undefined && (!object(value.failure) || !keys(value.failure, ["code", "message"]) || !text(value.failure.code) || !text(value.failure.message, 4000))) return invalid();
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!object(entry) || !keys(entry, ["id", "displayName", "kind", "selectable", "unsupportedReason", "access", "parameterOptions", "parameterDefaults", "billing"]) || !text(entry.id) || ids.has(entry.id) || !text(entry.displayName, 1000) || !["model", "tier", "native-auto"].includes(String(entry.kind)) || typeof entry.selectable !== "boolean" || !["account-listed", "unconfirmed", "denied"].includes(String(entry.access)) || !object(entry.parameterOptions) || Object.keys(entry.parameterOptions).length > 20 || !Object.entries(entry.parameterOptions).every(([key, options]) => text(key, 100) && Array.isArray(options) && options.length <= 100 && options.every(parameter))) return invalid();
    ids.add(entry.id);
    const options = entry.parameterOptions;
    if (entry.unsupportedReason !== undefined && !text(entry.unsupportedReason, 4000)) return invalid();
    if (entry.parameterDefaults !== undefined && (!object(entry.parameterDefaults) || !Object.entries(entry.parameterDefaults).every(([key, value]) => Array.isArray(options[key]) && options[key].includes(value)))) return invalid();
    if (entry.billing !== undefined && (!object(entry.billing) || !keys(entry.billing, ["mode"]) || !["unknown", "subscription", "metered"].includes(String(entry.billing.mode)))) return invalid();
  }
  return structuredClone(value) as unknown as AccountModelCatalog;
}
