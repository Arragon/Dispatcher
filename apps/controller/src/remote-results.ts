import { AdapterContractError } from "@dispatcher/adapters";
import type { AccountModelCatalog,RepositoryRefs } from "@dispatcher/domain";
import type { RunnerLease, RunnerRunSnapshot } from "@dispatcher/runner";
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const parameter = (value: unknown) => typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 4000;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function remoteRepositoryRefs(value:unknown,offset:number,limit:number):RepositoryRefs{
  const invalid=():never=>{throw new AdapterContractError("REMOTE_RESULT_INVALID","Owning Runner returned invalid repository references");};
  if(!object(value)||!keys(value,["offset","limit","nextOffset","truncated","refs"])||value.offset!==offset||value.limit!==limit||value.nextOffset!==undefined&&(value.nextOffset!==offset+limit||offset+limit>10_000)||value.truncated!==undefined&&typeof value.truncated!=="boolean"||value.truncated===true&&value.nextOffset!==undefined||!Array.isArray(value.refs)||value.refs.length>limit)return invalid();
  const names=new Set<string>();
  for(const ref of value.refs){
    if(!object(ref)||!keys(ref,["name","commit","kind"])||!text(ref.name,1024))return invalid();
    const name=ref.name;
    if(names.has(name)||Array.from(name).some(character=>character.codePointAt(0)!<=32||character.codePointAt(0)===127)||["..","//","@{","~","^",":","?","*","[","\\"].some(value=>name.includes(value))||name.split("/").some(part=>part.startsWith(".")||part.endsWith(".lock"))||name.endsWith(".")||!/^refs\/(heads|tags|remotes)\/.+/.test(name)||typeof ref.commit!=="string"||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(ref.commit)||ref.kind!==(name.startsWith("refs/heads/")?"branch":name.startsWith("refs/tags/")?"tag":"remote"))return invalid();
    names.add(name);
  }
  return structuredClone(value) as unknown as RepositoryRefs;
}
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

export interface NativeRunObservation extends RunnerRunSnapshot {
  runnerId: string; profileId: string; nativeState: string; attached: boolean;
  lease: RunnerLease; settledAt?: string; resultAvailable: boolean;
}
export function remoteRunInventory(value: unknown, runnerId: string): NativeRunObservation[] {
  const invalid=():never=>{throw new AdapterContractError("REMOTE_RESULT_INVALID","Owning Runner returned invalid native reconciliation evidence");};
  if(!object(value)||value.runnerId!==runnerId||!Array.isArray(value.runs)||value.runs.length>10000)return invalid();
  const seen=new Set<string>();
  return value.runs.map(row=>{
    if(!object(row)||row.runnerId!==runnerId||!text(row.runId)||seen.has(row.runId)||!text(row.profileId)||!text(row.leaseId)||!Number.isSafeInteger(row.generation)||Number(row.generation)<1||typeof row.attached!=="boolean"||typeof row.resultAvailable!=="boolean"||!["PREPARING","PREPARED","STARTING","RUNNING","COMPLETE","FAILED","CANCELLED","OUTCOME_UNKNOWN"].includes(String(row.state))||!object(row.lease)||row.lease.runId!==row.runId||row.lease.runnerId!==runnerId||row.lease.leaseId!==row.leaseId||row.lease.generation!==row.generation||typeof row.lease.expiresAt!=="string"||!Number.isFinite(Date.parse(row.lease.expiresAt)))return invalid();
    seen.add(row.runId);
    if(row.workspace!==undefined&&!text(row.workspace,4000)||row.sessionId!==undefined&&!text(row.sessionId)||row.startCommandHash!==undefined&&(typeof row.startCommandHash!=="string"||!/^[a-f0-9]{64}$/.test(row.startCommandHash))||row.lease.revokedAt!==undefined&&(typeof row.lease.revokedAt!=="string"||!Number.isFinite(Date.parse(row.lease.revokedAt)))||row.settledAt!==undefined&&(typeof row.settledAt!=="string"||!Number.isFinite(Date.parse(row.settledAt))))return invalid();
    return {runId:row.runId,runnerId,profileId:row.profileId,generation:Number(row.generation),leaseId:row.leaseId,nativeState:String(row.state),attached:row.attached,resultAvailable:row.resultAvailable,lease:structuredClone(row.lease) as unknown as RunnerLease,...(row.workspace?{workspace:String(row.workspace)}:{}),...(row.sessionId?{sessionId:String(row.sessionId)}:{}),...(row.startCommandHash?{startCommandHash:String(row.startCommandHash)}:{}),...(row.settledAt?{settledAt:String(row.settledAt)}:{})};
  });
}
