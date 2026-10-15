import { describe,expect,it } from "vitest";
import { readCodexCatalog, normalizeCodexCatalog } from "../src/codex-catalog.js";
const context={profileId:"a",runnerId:"local",repositoryId:"repo",executionContextRef:"repo-context",reason:"open" as const};
const model={model:"native-model",displayName:"Native model",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"medium"}]};
describe("Codex native catalogs",()=>{
  it("normalizes only native choices, stable content revisions and unconfirmed access without invented prices",()=>{
    const a=normalizeCodexCatalog({data:[model]},context,"fingerprint","2026-10-15T00:00:00Z");
    const b=normalizeCodexCatalog({data:[model]},context,"fingerprint","2026-10-15T01:00:00Z");
    expect(a.revision).toBe(b.revision);expect(a.entries[0]).toMatchObject({id:"native-model",access:"unconfirmed",parameterOptions:{reasoningEffort:["low","medium"]},billing:{mode:"unknown"}});
    expect(normalizeCodexCatalog({data:[model]},{...context,profileId:"b"},"other-account","now").revision).not.toBe(a.revision);
    expect(()=>normalizeCodexCatalog({data:[{...model,defaultReasoningEffort:"invented"}]},context,"fingerprint","now")).toThrow();
  });
  it("paginates read-only native requests and rejects cursor cycles",async()=>{
    const calls:string[]=[];let pages=0;
    const request=async(input:{method:string})=>{calls.push(input.method);return input.method==="account/read"?{account:{type:"chatgpt",email:"fixture@example.invalid",planType:"pro"}}:{data:[{...model,model:`m${pages++}`}],nextCursor:pages===1?"next":null};};
    const catalog=await readCodexCatalog({profile:{id:"a",alias:"A",codexHome:"/missing/fixture-native-home"},context,workspacePath:"/tmp",request});
    expect(catalog.entries).toHaveLength(2);expect(calls).toEqual(["account/read","model/list","model/list"]);expect(JSON.stringify(catalog)).not.toContain("fixture@example.invalid");
    await expect(readCodexCatalog({profile:{id:"a",alias:"A",codexHome:"/missing"},context,workspacePath:"/tmp",request:async i=>i.method==="account/read"?{account:null}:{data:[model],nextCursor:"cycle"}})).rejects.toMatchObject({code:"INVALID_MODEL_CATALOG"});
  });
});

it("reaps native RPC processes before returning and rejects mutating methods",async()=>{
  const {readCodexNative}=await import("../src/codex-catalog.js");const {mkdtempSync,writeFileSync,readFileSync,chmodSync,rmSync}=await import("node:fs");const {tmpdir}=await import("node:os");const {join}=await import("node:path");
  const directory=mkdtempSync(join(tmpdir(),"codex-rpc-")),executable=join(directory,"native"),marker=join(directory,"closed");
  try{
    writeFileSync(executable,`#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});process.on('SIGTERM',()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'closed');process.exit(0);});rl.on('line',line=>{const m=JSON.parse(line);if(m.id)console.log(JSON.stringify({id:m.id,result:m.id===1?{}:{data:[],nextCursor:null}}));});`);chmodSync(executable,0o755);
    const input={executable,codexHome:directory,workspacePath:directory,method:"model/list" as const,params:{}};
    expect(await readCodexNative(input)).toMatchObject({data:[]});expect(readFileSync(marker,"utf8")).toBe("closed");
    await expect(readCodexNative({...input,method:"thread/start" as never})).rejects.toMatchObject({code:"READ_ONLY_QUERY_REQUIRED"});
  }finally{rmSync(directory,{recursive:true,force:true});}
});
