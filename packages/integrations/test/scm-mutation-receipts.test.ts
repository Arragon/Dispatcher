import {expect,it,vi} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {ConnectorError} from "../src/contracts.js";
import {GitHubScmConnector} from "../src/github.js";
import {DeliveryService} from "../src/delivery.js";
import type {DeliveryRequest} from "../src/scm.js";
function fixture(){
 const db=new DispatcherDatabase(":memory:"),sha="a".repeat(40),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();let created:Record<string,unknown>|undefined,posts=0,secrets=0,pushes=0;
 const control={loseResponse:false,hideExisting:false,failQuery:false,holdPostSecret:false,revoked:false,throwCanary:false,badReceipt:""};
 const adapter=new GitHubScmConnector({instance:{id:"chosen",definitionId:"scm.github",kind:"scm",displayName:"Chosen",enabled:true,health:"HEALTHY",revision:1,updatedAt:new Date().toISOString()},credentialRef:"secret://github/chosen",resolveSecret:async()=>{secrets++;if(control.holdPostSecret&&secrets===2){entered.resolve();await gate.promise;}return "fixture";},transport:{ensureBranch:async()=>undefined,push:async()=>{pushes++;return {commit:sha};}},fetch:async(input,init)=>{
  if(control.throwCanary)throw new Error("provider-private-secret-canary");
  const url=new URL(String(input));if(url.pathname.endsWith("/pulls")){
   if(init?.method!=="POST"){if(control.failQuery)return new Response("",{status:503});return new Response(JSON.stringify(created&&!control.hideExisting?[created]:[]));}
   expect(db.listEntities("scm-pr-intent")).toContainEqual(expect.objectContaining({state:"PENDING"}));posts++;const body=JSON.parse(String(init.body));created={id:17,number:1,html_url:"https://github.com/acme/repo/pull/1",state:"open",body:body.body,head:{ref:body.head,sha,repo:{full_name:"acme/repo"}},base:{ref:body.base,repo:{full_name:"acme/repo"}}};if(control.badReceipt==="commit")(created.head as {sha:string}).sha="b".repeat(40);if(control.badReceipt==="marker")created.body="Unrelated PR";if(control.badReceipt==="url")created.html_url="https://foreign.invalid/acme/repo/pull/1";if(control.loseResponse){control.loseResponse=false;throw new Error("response lost after server acceptance");}return new Response(JSON.stringify(created));
  }
  return new Response(JSON.stringify(url.pathname.endsWith("/check-runs")?{total_count:0,check_runs:[]}:{state:"pending",total_count:0,statuses:[]}));
 }});
 const run={id:"run",taskId:"task",runnerId:"runner",providerId:"codex",profileId:"p",sessionId:"session",state:"DELIVERING" as const,attempt:1,generation:1,leaseId:"lease",verification:{state:"PASSED" as const,commands:["check"]}};
 const request:DeliveryRequest={idempotencyKey:"delivery:run:1",taskId:"task",run,currentGeneration:1,currentLeaseId:"lease",repository:{owner:"acme",name:"repo"},headBranch:"dispatcher/task/run",baseBranch:"main",title:"Deliver",body:"Verified",verification:run.verification,expectedHeadCommit:sha,assertAuthority:()=>{if(control.revoked)throw new ConnectorError("CONFLICT","lease revoked",{retryable:false});}};
 return {db,adapter,request,control,entered,gate,posts:()=>posts,pushes:()=>pushes};
}
it("does not resend a PR after a lost write response even while its lookup is temporarily empty",async()=>{
 const f=fixture();try{
  f.control.loseResponse=true;await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toBeDefined();expect(f.posts()).toBe(1);expect(f.db.listEntities("scm-pr-intent")).toContainEqual(expect.objectContaining({state:"PENDING"}));
  f.control.hideExisting=true;await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toMatchObject({code:"CONFLICT"});expect(f.posts()).toBe(1);
  f.control.hideExisting=false;const recovered=await new DeliveryService(f.db).deliver(f.adapter,f.request);expect(recovered.evidence).toContainEqual(expect.objectContaining({kind:"pull-request",externalId:"17"}));expect(f.posts()).toBe(1);expect(f.db.listEntities("scm-pr-intent")).toContainEqual(expect.objectContaining({state:"COMPLETE"}));
 }finally{f.db.close();}
});
it("allows a safe retry when a read fails before any PR write was attempted",async()=>{
 const f=fixture();try{f.control.failQuery=true;await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toMatchObject({code:"TEMPORARY"});expect(f.posts()).toBe(0);expect(f.db.listEntities("scm-pr-intent")).toEqual([]);f.control.failQuery=false;await new DeliveryService(f.db).deliver(f.adapter,f.request);expect(f.posts()).toBe(1);}finally{f.db.close();}
});
it("binds PR replay identity to its actual target instead of returning an unrelated prior receipt",async()=>{
 const f=fixture();try{await new DeliveryService(f.db).deliver(f.adapter,f.request);await expect(new DeliveryService(f.db).deliver(f.adapter,{...f.request,repository:{owner:"other",name:"repo"}})).rejects.toMatchObject({code:"CONFLICT"});expect(f.posts()).toBe(1);}finally{f.db.close();}
});
it("rechecks authority after resolving credentials and before writing a PR intent or sending POST",async()=>{
 const f=fixture();try{f.control.holdPostSecret=true;const pending=new DeliveryService(f.db).deliver(f.adapter,f.request),rejected=expect(pending).rejects.toMatchObject({code:"CONFLICT"});await f.entered.promise;f.control.revoked=true;f.gate.resolve();await rejected;expect(f.posts()).toBe(0);expect(f.db.listEntities("scm-pr-intent")).toEqual([]);}finally{f.gate.resolve();f.db.close();}
});

it("does not let a new idempotency key escape an unresolved Run/generation PR intent",async()=>{
 const f=fixture();try{f.control.loseResponse=true;await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toBeDefined();f.control.hideExisting=true;await expect(new DeliveryService(f.db).deliver(f.adapter,{...f.request,idempotencyKey:"new-nonce"})).rejects.toMatchObject({code:"CONFLICT"});expect(f.posts()).toBe(1);}finally{f.db.close();}
});
it("rejects pre-aborted delivery before any provider mutation or PR intent",async()=>{
 const f=fixture();try{const signal=AbortSignal.abort();await expect(new DeliveryService(f.db).deliver(f.adapter,{...f.request,signal})).rejects.toMatchObject({code:"CONFLICT"});expect(f.posts()).toBe(0);expect(f.pushes()).toBe(0);expect(f.db.listEntities("scm-pr-intent")).toEqual([]);}finally{f.db.close();}
});
it("keeps private fetch errors out of public SCM diagnostics",async()=>{
 const f=fixture();try{f.control.throwCanary=true;await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toMatchObject({code:"TEMPORARY",message:"GitHub request failed"});}finally{f.db.close();}
});

it("retains a durable unknown PR outcome when completion persistence fails",async()=>{
 const f=fixture();try{const original=f.db.saveEntity.bind(f.db),save=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]==="scm-pr-intent"&&(args[2] as {state?:string}).state==="COMPLETE")throw new Error("completion receipt disk failure");original(...args);});await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toThrow("completion receipt disk failure");save.mockRestore();f.control.hideExisting=true;await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toMatchObject({code:"CONFLICT"});expect(f.posts()).toBe(1);f.control.hideExisting=false;await new DeliveryService(f.db).deliver(f.adapter,f.request);expect(f.posts()).toBe(1);}finally{f.db.close();}
});

it.each(["commit","marker","url"])("keeps a mismatched %s receipt unknown and never reposts it",async kind=>{
 const f=fixture();try{f.control.badReceipt=kind;await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toMatchObject({code:"CONFLICT"});await expect(new DeliveryService(f.db).deliver(f.adapter,f.request)).rejects.toMatchObject({code:"CONFLICT"});expect(f.posts()).toBe(1);expect(f.db.listDeliveryEvidence("task")).toEqual([]);expect(f.db.listEntities("scm-pr-intent")).toContainEqual(expect.objectContaining({state:"PENDING"}));}finally{f.db.close();}
});
it("permits only one create attempt when equivalent delivery calls race",async()=>{
 const f=fixture();try{const results=await Promise.allSettled([new DeliveryService(f.db).deliver(f.adapter,f.request),new DeliveryService(f.db).deliver(f.adapter,f.request)]);expect(results.some(result=>result.status==="fulfilled")).toBe(true);expect(f.posts()).toBe(1);}finally{f.db.close();}
});
