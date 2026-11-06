import {mkdtempSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {CodexAdapter,CodexCliBackend,MemorySessionStore} from "../src/index.js";
import {OwnedProcessGroup} from "../src/owned-process.js";
it.each([{outcome:"completed",event:"turn.completed",adapterState:"COMPLETED"},{outcome:"failed",event:"turn.failed",adapterState:"FAILED"}] as const)("records exact $outcome turn completion only after the owning process group drains",async({outcome,event,adapterState})=>{
 const root=mkdtempSync(join(tmpdir(),"native-drain-proof-")),script=join(root,"fixture-cli"),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 writeFileSync(script,`#!${process.execPath}\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'native-owned-fixture'}));console.log(JSON.stringify({type:${JSON.stringify(event)}}));\n`,{mode:0o700});
 const proofs:unknown[]=[],store=new MemorySessionStore();Object.assign(store,{recordTurnCompletion:(proof:unknown)=>proofs.push(structuredClone(proof))});
 const stop=OwnedProcessGroup.prototype.stop,gate=vi.spyOn(OwnedProcessGroup.prototype,"stop").mockImplementation(async function(this:OwnedProcessGroup){entered.resolve();await release.promise;return stop.call(this);});
 try{
  const adapter=new CodexAdapter({id:"p",alias:"P",codexHome:root,executable:script,model:"explicit"},new CodexCliBackend(),store),session=await adapter.start({runId:"run",workspacePath:root,prompt:"private-prompt-canary",execution:{generation:2,attempt:3,leaseId:"lease"}}),pending=adapter.result(session.id);
  await entered.promise;expect(proofs).toEqual([]);release.resolve();expect(await pending).toMatchObject({state:adapterState});
  expect(proofs).toEqual([expect.objectContaining({version:1,invocationId:session.modelInvocationId,runId:"run",sessionId:session.id,profileId:"p",backendId:"codex-exec-json",providerSessionId:"native-owned-fixture",producer:"owned-process-group",outcome,execution:{generation:2,attempt:3,leaseId:"lease"}})]);expect(JSON.stringify(proofs)).not.toContain("private-prompt-canary");
 }finally{release.resolve();gate.mockRestore();rmSync(root,{recursive:true,force:true});}
});
it("does not infer owned-process completion proof from a custom backend's COMPLETED row",async()=>{
 const proofs:unknown[]=[],store=new MemorySessionStore();Object.assign(store,{recordTurnCompletion:(proof:unknown)=>proofs.push(proof)});
 const adapter=new CodexAdapter({id:"p",alias:"P",codexHome:"/fixture"},{start:()=>({status:()=>"completed",cancel:async()=>undefined,result:async()=>({state:"completed",summary:"fixture",events:[],providerSessionId:"native"})})},store),session=await adapter.start({runId:"r",workspacePath:"/fixture"});await adapter.result(session.id);expect(proofs).toEqual([]);
});
it("rejects a custom backend's self-reported drain claim even for a canonical lease",async()=>{
 const proofs:unknown[]=[],store=new MemorySessionStore();Object.assign(store,{recordTurnCompletion:(proof:unknown)=>proofs.push(proof)});
 const adapter=new CodexAdapter({id:"p",alias:"P",codexHome:"/fixture"},{start:()=>({status:()=>"completed",cancel:async()=>undefined,drainProof:()=>({producer:"owned-process-group" as const,completedAt:new Date().toISOString()}),result:async()=>({state:"completed",summary:"fixture",events:[],providerSessionId:"native"})})},store),session=await adapter.start({runId:"r",workspacePath:"/fixture",execution:{generation:1,attempt:1,leaseId:"lease"}});await adapter.result(session.id);expect(proofs).toEqual([]);
});
it("retains exact owned cancellation drain and observed native identity before acknowledging the stop",async()=>{
 const root=mkdtempSync(join(tmpdir(),"native-cancel-drain-")),script=join(root,"fixture-cli"),ready=join(root,"ready"),proofs:unknown[]=[],store=new MemorySessionStore();Object.assign(store,{recordTurnCompletion:(proof:unknown)=>proofs.push(structuredClone(proof))});
 writeFileSync(script,`#!${process.execPath}\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'cancelled-owned-native'}));require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);\n`,{mode:0o700});
 const adapter=new CodexAdapter({id:"p",alias:"P",codexHome:root,executable:script},new CodexCliBackend(),store),session=await adapter.start({runId:"r",workspacePath:root,execution:{generation:1,attempt:1,leaseId:"lease"}});
 try{await vi.waitFor(()=>expect(existsSync(ready)).toBe(true));expect(await adapter.cancel(session.id)).toMatchObject({state:"CANCELLED",providerSessionId:"cancelled-owned-native"});expect(proofs).toEqual([expect.objectContaining({invocationId:session.modelInvocationId,providerSessionId:"cancelled-owned-native",producer:"owned-process-group",outcome:"cancelled"})]);}finally{await adapter.cancel(session.id);rmSync(root,{recursive:true,force:true});}
});
