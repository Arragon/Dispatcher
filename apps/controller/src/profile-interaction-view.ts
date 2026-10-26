import { openSync, readSync, closeSync } from "node:fs";
import type { AgentProfileConfig } from "@dispatcher/config";
import type { AdapterManifest } from "@dispatcher/adapters";
import { redactNativeText } from "@dispatcher/observability";
import { assessInteractionCapability, type CapabilityEvidence, type ProfileInteractionView, type ProfileInteractionRow as Row, type ProfileInteractionEvidence as EvidenceView } from "@dispatcher/domain";

const names=["durableIdentity","historyRead","sameSessionContinue","liveSteer","interruptTurn","nativeApproval","observeExternalChanges","releaseControl","reclaimControl","restartReattach"] as const;
const surfaces=["desktop","ide","web","mobile","tui"] as const;
type Support=EvidenceView["support"];
type Level=NonNullable<EvidenceView["evidenceLevel"]>;
export type {ProfileInteractionView} from "@dispatcher/domain";
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=2048&&!Array.from(value).some(c=>c.charCodeAt(0)<32)&&redactNativeText(value)===value;
const token=(value:unknown):value is string=>text(value)&&/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
// Date.parse also accepts arbitrary parenthesized comments; never echo those as timestamps.
const timestamp=(value:unknown):value is string=>text(value)&&/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)&&Number.isFinite(Date.parse(value));
const support=(value:unknown):Support=>value==="supported"||value==="unsupported"?value:"unknown";
function history(name:string,input:unknown,scope:unknown,installedVersion:unknown):EvidenceView {
 const evidence=object(input);if(!evidence||evidence.version!==1)return {name,support:"unknown"};
 const level=evidence.level;
 const scoped=token(installedVersion)&&text(scope)&&evidence.scopeFingerprint===scope&&["documented","installed-probed","runtime-verified","ui-roundtrip-verified"].includes(typeof level==="string"?level:"");
 const qualified=scoped&&text(evidence.evidenceRef)&&assessInteractionCapability(evidence as unknown as CapabilityEvidence,scope as string,surfaces.some(surface=>surface===name)?"ui-roundtrip-verified":"runtime-verified").supported;
 return {name,support:"unknown",historicalSupport:scoped&&evidence.support==="unsupported"?"unsupported":qualified?support(evidence.support):"unknown",...(["documented","installed-probed","runtime-verified","ui-roundtrip-verified"].includes(typeof level==="string"?level:"")?{evidenceLevel:level as Level}:{}),...(timestamp(evidence.verifiedAt)?{verifiedAt:evidence.verifiedAt}:{})};
}
/** A checked-in archive supplies historical facts, never current native authority. */
export function profileInteractionView(profile:AgentProfileConfig,manifest:AdapterManifest|undefined,matrix:unknown):ProfileInteractionView {
 const input=object(matrix),currentRegion=token(profile.settings?.region)?profile.settings.region:["qoder-cn","workbuddy","codebuddy"].includes(profile.provider)?"cn":"global";
 const rows:Row[]=[];
 if(input?.version===1&&Array.isArray(input.rows)&&input.rows.length<=200)for(const value of input.rows){
  const row=object(value);if(!row||row.profileId!==profile.id||row.product!==(profile.provider==="qoder-cn"?"qoder":profile.provider)||!token(row.backendId)||!token(row.region)||row.installedVersion!==null&&!token(row.installedVersion)||!text(row.nextVerification))continue;
  const capabilities=object(row.capabilities),entries=object(row.surfaces);
  rows.push({backendId:row.backendId,region:row.region,installedVersion:row.installedVersion as string|null,invalidationReason:row.region!==currentRegion?"REGION_CHANGED":profile.nativeInteraction&&profile.nativeInteraction.backendId!==row.backendId?"BACKEND_CHANGED":!manifest?.backends.some(b=>b.id===row.backendId)?"BACKEND_UNAVAILABLE":"CURRENT_SCOPE_UNVERIFIED",installation:"unknown",authentication:"unknown",capabilities:names.map(name=>history(name,capabilities?.[name],row.scopeFingerprint,row.installedVersion)),surfaces:surfaces.map(name=>history(name,entries?.[name],row.scopeFingerprint,row.installedVersion)),nextVerification:"先测试当前版本与登录，再按后端、地区核对真实运行和原生入口。"});
 }
 for(const backend of manifest?.backends??[])if(!rows.some(row=>row.backendId===backend.id&&row.region===currentRegion))rows.push({backendId:backend.id,region:currentRegion,installedVersion:null,invalidationReason:"NO_VERIFICATION_RECORD",installation:"unknown",authentication:"unknown",capabilities:names.map(name=>({name,support:"unknown"})),surfaces:surfaces.map(name=>({name,support:"unknown"})),nextVerification:"先测试登录，再按后端验证真实运行和原生入口。"});
 return {version:1,rows};
}
/** One collocated build asset; source tests can inject an explicit trusted file URL. */
export function loadProfileEvidence(path:URL=new URL("./profile-capability-history.json",import.meta.url)):unknown {
 let descriptor:number|undefined;
 try {
  descriptor=openSync(path,"r");const limit=512*1024,buffer=Buffer.alloc(limit+1);let bytes=0;
  while(bytes<buffer.length){const count=readSync(descriptor,buffer,bytes,buffer.length-bytes,null);if(count===0)break;bytes+=count;}
  if(bytes>limit)return undefined;
  return JSON.parse(buffer.subarray(0,bytes).toString("utf8")) as unknown;
 }catch{return undefined;}finally{if(descriptor!==undefined)closeSync(descriptor);}
}
