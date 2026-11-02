import {expect,it,vi} from "vitest";
import {CodexAdapter,OpenCodeAdapter,MemorySessionStore,type AdapterSession} from "../src/index.js";
import type {NativeModelInvocation} from "@dispatcher/domain";

it.each(["codex","opencode"] as const)("records actual %s invocation parameters independently for each turn",async provider=>{
  const store=new MemorySessionStore(),records:NativeModelInvocation[]=[];
  const recordModelInvocation=vi.fn((record:NativeModelInvocation)=>records.push(structuredClone(record)));
  Object.assign(store,{recordModelInvocation});
  const calls=vi.fn(()=>({status:()=>"completed" as const,cancel:async()=>undefined,result:async()=>({state:"completed" as const,summary:"done",events:[],providerSessionId:"native"})}));
  const profile={id:"p",alias:"P",model:"explicit",codexHome:"/native"};
  const adapter=provider==="codex"?new CodexAdapter(profile,{start:calls},store):new OpenCodeAdapter(profile,{start:calls},store);
  const execution={generation:2,attempt:3,leaseId:"lease-a"},session=await adapter.start({runId:"run",workspacePath:"/work",execution});
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({version:1,id:session.turnId,sessionId:session.id,runId:"run",profileId:"p",backendId:adapter.manifest.backends[0]!.id,kind:"start",execution,model:{id:"explicit",options:{}}});
  profile.model="later";await adapter.send(session.id,"private prompt must not enter the record");
  expect(records).toHaveLength(2);expect(records[1]).toMatchObject({kind:"input",nativeSessionId:"native",model:{id:"explicit",options:{}},execution});
  expect(records[1]?.id).not.toBe(records[0]?.id);expect(JSON.stringify(records)).not.toContain("private prompt");
  expect(calls).toHaveBeenCalledTimes(2);
});
it.each(["codex","opencode"] as const)("does not fabricate a %s invocation after failed admission or backend preparation",async provider=>{
  const store=new MemorySessionStore(),recordModelInvocation=vi.fn();Object.assign(store,{recordModelInvocation});
  const start=vi.fn(()=>{throw Error("backend not invoked successfully");}),profile={id:"p",alias:"P",model:"m",codexHome:"/native"};
  const adapter=provider==="codex"?new CodexAdapter(profile,{start},store):new OpenCodeAdapter(profile,{start},store);
  await expect(adapter.start({runId:"blocked",workspacePath:"/work",beforeSend:()=>{throw Error("rejected");}})).rejects.toThrow();
  expect(start).not.toHaveBeenCalled();expect(recordModelInvocation).not.toHaveBeenCalled();
  await expect(adapter.start({runId:"failed",workspacePath:"/work"})).rejects.toThrow("backend not invoked successfully");
  expect(start).toHaveBeenCalledTimes(1);expect(recordModelInvocation).not.toHaveBeenCalled();
});
it.each(["codex","opencode"] as const)("stops the owned %s turn if invocation persistence fails",async provider=>{
  const store=new MemorySessionStore(),recordModelInvocation=vi.fn(()=>{throw Error("evidence disk failure");});Object.assign(store,{recordModelInvocation});
  const cancel=vi.fn(async()=>undefined),start=vi.fn(()=>({status:()=>"completed" as const,cancel,result:async()=>({state:"completed" as const,summary:"done",events:[]})}));
  const profile={id:"p",alias:"P",model:"m",codexHome:"/native"},adapter=provider==="codex"?new CodexAdapter(profile,{start},store):new OpenCodeAdapter(profile,{start},store);
  await expect(adapter.start({runId:"r",workspacePath:"/work"})).rejects.toThrow("evidence disk failure");
  expect(start).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalledTimes(1);
});
it("does not publish the preceding invocation after a later send is rejected",async()=>{
  const sessions:AdapterSession[]=[],store=new MemorySessionStore(),save=store.save.bind(store),recordModelInvocation=vi.fn();
  vi.spyOn(store,"save").mockImplementation(session=>{sessions.push(structuredClone(session));save(session);});Object.assign(store,{recordModelInvocation});
  const start=vi.fn(()=>({status:()=>"completed" as const,cancel:async()=>undefined,result:async()=>({state:"completed" as const,summary:"done",events:[],providerSessionId:"native"})}));
  const adapter=new CodexAdapter({id:"p",alias:"P",codexHome:"/native",model:"m"},{start},store),session=await adapter.start({runId:"r",workspacePath:"/work"});
  let guards=0;await expect(adapter.send(session.id,"blocked",()=>{if(++guards===2)throw Error("late admission rejection");})).rejects.toThrow();
  expect(recordModelInvocation).toHaveBeenCalledTimes(1);expect(store.load(session.id)?.modelInvocationId).not.toBe(store.load(session.id)?.turnId);
});
