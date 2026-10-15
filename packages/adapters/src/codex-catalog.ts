import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AccountModelCatalog, ModelCatalogContext } from "@dispatcher/domain";
import { AdapterContractError } from "./contracts.js";
import type { CodexProfileConfig } from "./codex.js";
export interface CodexReadRequest {
  executable: string; codexHome: string; workspacePath: string;
  method: "model/list" | "account/read"; params: Record<string,unknown>;
}
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid=()=>new AdapterContractError("INVALID_MODEL_CATALOG","Native model catalog is malformed");
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw invalid();return value as Record<string,unknown>;}
function text(value:unknown):string{if(typeof value!=="string"||!value||value.length>240||Array.from(value).some(c=>c.codePointAt(0)!<32))throw invalid();return value;}

/** Each connection is restricted to read-only RPCs and is reaped before returning. */
export function readCodexNative(input:CodexReadRequest):Promise<unknown>{
  if(!["model/list","account/read"].includes(input.method))return Promise.reject(new AdapterContractError("READ_ONLY_QUERY_REQUIRED","Only native read-only queries are allowed"));
  return new Promise((resolve,reject)=>{
    const child=spawn(input.executable,["app-server","--stdio"],{cwd:input.workspacePath,shell:false,stdio:["pipe","pipe","pipe"],env:{...process.env,PWD:input.workspacePath,CODEX_HOME:input.codexHome}});
    const lines=createInterface({input:child.stdout});let ending=false,result:unknown,error:Error|undefined,bytes=0;let kill:ReturnType<typeof setTimeout>|undefined;
    const finish=(failure?:Error)=>{if(ending)return;ending=true;error=failure;clearTimeout(timeout);lines.close();child.stdin.end();child.kill("SIGTERM");kill=setTimeout(()=>child.kill("SIGKILL"),2000);};
    const fail=()=>finish(new AdapterContractError("NATIVE_QUERY_FAILED","Native read-only query failed or timed out"));
    const timeout=setTimeout(fail,30000);
    const send=(value:unknown)=>{if(!ending)child.stdin.write(`${JSON.stringify(value)}\n`);};
    child.stdout.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>4194304)fail();});child.stderr.on("data",()=>undefined);
    child.stdin.on("error",fail);child.on("error",fail);
    child.on("close",()=>{clearTimeout(timeout);if(kill)clearTimeout(kill);lines.close();if(error||result===undefined)reject(error??new AdapterContractError("NATIVE_QUERY_FAILED","Native query exited before a response"));else resolve(result);});
    let initialized=false;
    lines.on("line",line=>{
      if(ending)return;if(line.length>1048576){fail();return;}
      let m:Record<string,unknown>;try{m=object(JSON.parse(line));}catch{fail();return;}
      if(m.method&&m.id!==undefined){send({id:m.id,error:{code:-32601,message:"Read-only client"}});return;}
      if(m.id===1){if(initialized||m.error||m.result===undefined){fail();return;}initialized=true;send({method:"initialized",params:{}});send({id:2,method:input.method,params:input.params});}
      else if(m.id===2){if(!initialized||m.error||m.result===undefined){fail();return;}result=m.result;finish();}
    });
    send({id:1,method:"initialize",params:{clientInfo:{name:"agent_dispatcher",version:"0.1.0"}}});
  });
}

export function normalizeCodexCatalog(value:unknown,context:ModelCatalogContext,contextFingerprint:string,fetchedAt:string):AccountModelCatalog{
  const raw=object(value);if(!Array.isArray(raw.data)||!raw.data.length||raw.data.length>1000)throw invalid();
  const seen=new Set<string>();
  const entries:AccountModelCatalog["entries"]=raw.data.map((value):AccountModelCatalog["entries"][number]=>{
    const m=object(value),id=text(m.model);if(seen.has(id))throw invalid();seen.add(id);
    if(!Array.isArray(m.supportedReasoningEfforts)||m.supportedReasoningEfforts.length>20||typeof m.hidden!=="boolean")throw invalid();
    const efforts=m.supportedReasoningEfforts.map(e=>text(object(e).reasoningEffort));const nativeDefault=text(m.defaultReasoningEffort);
    if(!efforts.includes(nativeDefault)||new Set(efforts).size!==efforts.length)throw invalid();
    return {id,displayName:text(m.displayName),kind:"model",selectable:!m.hidden,...(m.hidden?{unsupportedReason:"Hidden by native client"}:{}),access:"unconfirmed",parameterOptions:{reasoningEffort:efforts},parameterDefaults:{reasoningEffort:nativeDefault},billing:{mode:"unknown"}};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  return {profileId:context.profileId,runnerId:context.runnerId,providerId:"codex",backendId:"codex-exec-json",contextFingerprint,revision:digest({contextFingerprint,entries}),fetchedAt,freshness:"native-fresh",source:"native-rpc",selectionSupport:"explicit",entries};
}
export async function readCodexCatalog(input:{profile:CodexProfileConfig;context:ModelCatalogContext;workspacePath:string;request?:(input:CodexReadRequest)=>Promise<unknown>}):Promise<AccountModelCatalog>{
  const request=input.request??readCodexNative;
  const query=(method:CodexReadRequest["method"],params:Record<string,unknown>)=>request({executable:input.profile.executable??"codex",codexHome:input.profile.codexHome,workspacePath:input.workspacePath,method,params});
  const account=object(await query("account/read",{refreshToken:false}));
  const data:unknown[]=[];let cursor:string|undefined;const cursors=new Set<string>();const deadline=Date.now()+30000;
  for(let page=0;page<20;page++){
    if(Date.now()>deadline)throw invalid();
    const value=object(await query("model/list",{limit:100,includeHidden:false,...(cursor?{cursor}:{})}));if(!Array.isArray(value.data))throw invalid();data.push(...value.data);if(data.length>1000)throw invalid();
    if(value.nextCursor===undefined||value.nextCursor===null){
      const configHash=async(path:string)=>{try{return createHash("sha256").update(await readFile(path)).digest("hex");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}};
      const authStamp=await stat(join(input.profile.codexHome,"auth.json")).then(s=>({size:s.size,mtime:s.mtimeMs})).catch(()=>null);
      const fingerprint=digest({profileId:input.profile.id,runnerId:input.context.runnerId,repositoryId:input.context.repositoryId,executionContextRef:input.context.executionContextRef,codexHome:input.profile.codexHome,executable:input.profile.executable??"codex",account:account.account??null,authStamp,globalConfig:await configHash(join(input.profile.codexHome,"config.toml")),projectConfig:await configHash(join(input.workspacePath,".codex","config.toml"))});
      const catalog=normalizeCodexCatalog({data},input.context,fingerprint,new Date().toISOString());
      if(account.requiresOpenaiAuth===true&&!account.account){catalog.freshness="unverified";catalog.selectionSupport="native-default-only";catalog.failure={code:"NATIVE_AUTH_REQUIRED",message:"Native account authentication is required"};}
      return catalog;
    }
    cursor=text(value.nextCursor);if(cursors.has(cursor))throw invalid();cursors.add(cursor);
  }
  throw invalid();
}
