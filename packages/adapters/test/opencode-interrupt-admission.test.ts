import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { CapabilityEvidence, NativeBinding } from "../../domain/src/index.js";
import { OpenCodeV2HttpTransport, OpenCodeV2InteractionPort } from "../src/opencode-server.js";
import { interruptNativeSession } from "../../runner/src/native-stop.js";

const a:NativeBinding={version:1,product:"opencode",region:"global",profileId:"p",backendId:"opencode-server-v2",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"ses_a",executionRefId:"execution-a",identityState:"bound"};
const fence={runId:"run-a",sessionId:"dispatcher-a",expectedTaskRevision:1,expectedCurrentRunId:"run-a",expectedControlRevision:1,expectedControlEpoch:1,generation:1,leaseId:"lease",commandId:"interrupt-a"};

async function withServer(work:(f:{
 port:OpenCodeV2InteractionPort;entered:Promise<void>;release:()=>void;posts:string[];reads:string[];
 active:Record<string,unknown>;replace:(kind:"workspace"|"serverTmp")=>void;
})=>Promise<void>,delayPath="/api/session/ses_a/interrupt",delayAfterQuiescence=false) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-interrupt-admission-")));
 const workspace=join(root,"workspace"),serverTmp=join(root,"native-tmp");mkdirSync(workspace);mkdirSync(serverTmp);
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),posts:string[]=[],reads:string[]=[];
 const active:Record<string,unknown>={ses_a:{type:"running"},ses_b:{type:"running"}};
 const evidence:CapabilityEvidence={version:1,support:"supported",level:"runtime-verified",scopeFingerprint:"scope",verifiedAt:"2026-10-13T13:30:00Z",evidenceRef:"fixture:interrupt-admission"};
 const server=createServer((req,res)=>{
  const url=new URL(req.url!,"http://127.0.0.1");let value:unknown;
  if(req.method==="POST"){posts.push(url.pathname+url.search);delete active.ses_a;value={interrupted:true};}
  else {reads.push(url.pathname);
   if(url.pathname==="/api/info")value={version:"2.0.26",pid:123,urls:[],paths:{tmp:serverTmp}};
   else if(url.pathname==="/api/location")value={directory:workspace,project:{id:"project",directory:workspace,canonical:workspace}};
   else if(url.pathname==="/api/session/active")value={data:active};
   else if(url.pathname.endsWith("/permission")||url.pathname.endsWith("/inbox"))value={data:[]};
   else value={data:{id:"ses_a",projectID:"project",location:{directory:workspace},model:{providerID:"provider",id:"model"},permissions:[],time:{created:1,updated:1}}};
  }
  res.setHeader("content-type","application/json");res.end(JSON.stringify(value));
 });
 try{
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const address=server.address();if(!address||typeof address==="string")throw Error("missing loopback fixture");
  let delayHeaders=false,quiescenceFinished=!delayAfterQuiescence;
  const http=new OpenCodeV2HttpTransport("http://127.0.0.1:"+address.port,async()=>{if(delayHeaders){entered.resolve();await release.promise;}return {};});
  const port=new OpenCodeV2InteractionPort({profileId:"p",runnerId:"local",nativeStoreRef:"store",workspacePath:workspace,scopeFingerprint:"scope",backendId:"opencode-server-v2",protocolVersion:"2.0.26",server:{pid:123,tmpDirectory:serverTmp,ownership:"external",shared:true},interruptWithoutResume:evidence,evidence:{interruptTurn:evidence}},{request:input=>{delayHeaders=input.path===delayPath&&quiescenceFinished;return http.request(input);}});
  if(delayAfterQuiescence){const inspect=port.inspectQuiescence.bind(port);port.inspectQuiescence=async(ref,request)=>{const proof=await inspect(ref,request);quiescenceFinished=true;return proof;};}
  port.registerBinding(a);
  await work({port,entered:entered.promise,release:()=>release.resolve(),posts,reads,active,replace:kind=>{const path=kind==="workspace"?workspace:serverTmp;renameSync(path,path+"-retained");mkdirSync(path);}});
 }finally{release.resolve();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true});}
}
it.each(["disconnect","workspace","serverTmp"] as const)("does not interrupt either shared session after %s during HTTP credentials",async mode=>{
 await withServer(async f=>{
  const pending=f.port.interrupt(a,{commandId:fence.commandId,fence});await f.entered;
  if(mode==="disconnect")f.port.markDisconnected();else f.replace(mode);f.release();
  const receipt=await pending;expect(receipt).toMatchObject({state:"rejected",code:"OPENCODE_INTERRUPT_ADMISSION_REJECTED"});
  expect(f.posts).toEqual([]);expect(f.active).toEqual({ses_a:{type:"running"},ses_b:{type:"running"}});
  if(mode==="disconnect"){expect(await f.port.interrupt(a,{commandId:fence.commandId,fence})).toEqual(receipt);expect(f.posts).toEqual([]);}
 });
});
it("rejects a new interrupt on a disconnected port before native reads",async()=>{
 await withServer(async f=>{
  f.port.markDisconnected();f.release();await expect(f.port.interrupt(a,{commandId:fence.commandId,fence})).rejects.toMatchObject({code:"OPENCODE_RECONCILIATION_REQUIRED"});
  expect(f.reads).toEqual([]);expect(f.posts).toEqual([]);
 });
});
it("does not submit an interrupt disconnected during awaited session preflight",async()=>{
 await withServer(async f=>{
  const pending=f.port.interrupt(a,{commandId:fence.commandId,fence}).catch(error=>error);await f.entered;f.port.markDisconnected();f.release();
  expect(await pending).toMatchObject({state:"rejected",code:"OPENCODE_INTERRUPT_ADMISSION_REJECTED"});expect(f.posts).toEqual([]);
 },"/api/session/ses_a");
});
it("keeps the qualified exact-session interrupt and resume=false on the actual wire",async()=>{
 await withServer(async f=>{
  const pending=f.port.interrupt(a,{commandId:fence.commandId,fence});await f.entered;f.release();expect(await pending).toMatchObject({state:"accepted"});
  expect(f.posts).toEqual(["/api/session/ses_a/interrupt?resume=false"]);expect(f.active).toEqual({ses_b:{type:"running"}});
  expect(await f.port.interrupt(a,{commandId:fence.commandId,fence})).toMatchObject({state:"accepted"});expect(f.posts).toHaveLength(1);
 });
});
it("preserves proven-unsent rejection through the Runner after the port preflight disconnects",async()=>{
 await withServer(async f=>{
  const pending=interruptNativeSession({binding:a,scopeFingerprint:"scope",port:f.port},{commandId:fence.commandId,fence},()=>{});
  await f.entered;f.port.markDisconnected();f.release();
  expect(await pending).toMatchObject({receipt:{state:"rejected"},nativeStopProof:{state:"unknown",code:"NATIVE_INTERRUPT_UNCONFIRMED"}});
  expect(f.posts).toEqual([]);expect(f.active).toEqual({ses_a:{type:"running"},ses_b:{type:"running"}});
 },"/api/session/ses_a",true);
});
