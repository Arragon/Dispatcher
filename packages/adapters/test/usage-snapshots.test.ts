import {expect,it,vi} from "vitest";
import {CodexAdapter,QoderAdapter,type AgentAdapter} from "../src/index.js";
const resource={type:"resource" as const,state:"QUOTA_EXHAUSTED" as const,source:"event" as const,confidence:"high" as const,reason:"reported quota"};
function fixture(provider:"codex"|"qoder",state:"running"|"completed",stream=false){
 const completed=Promise.withResolvers<{state:"failed";summary:string;events:Array<typeof resource>}>();
 const result=vi.fn(()=>completed.promise),turn={status:()=>state,cancel:async()=>undefined,result,...(stream?{events:()=>[resource]}:{})};
 const adapter:AgentAdapter=provider==="codex"?new CodexAdapter({id:"p",alias:"P",codexHome:"/native"},{start:()=>turn}):new QoderAdapter({id:"p",alias:"P"},{start:()=>turn});
 return {adapter,completed,result};
}
it.each(["codex","qoder"] as const)("reads active %s telemetry without waiting for or requesting its result",async provider=>{
 const f=fixture(provider,"running"),session=await f.adapter.start({runId:"r",workspacePath:"/work"});const pending=f.adapter.usage!(session.id);
 try{
  const snapshot=await Promise.race([pending,new Promise<"blocked">(resolve=>setImmediate(()=>resolve("blocked")))]);
  expect(snapshot).not.toBe("blocked");expect(snapshot).toMatchObject({state:"UNKNOWN"});expect(f.result).not.toHaveBeenCalled();
 }finally{f.completed.resolve({state:"failed",summary:"done",events:[resource]});await pending;}
});
it.each(["codex","qoder"] as const)("does not wait when %s reports process completion before its result settles",async provider=>{
 const f=fixture(provider,"completed"),session=await f.adapter.start({runId:"r",workspacePath:"/work"});const pending=f.adapter.usage!(session.id);
 try{
  const snapshot=await Promise.race([pending,new Promise<"blocked">(resolve=>setImmediate(()=>resolve("blocked")))]);
  expect(snapshot).not.toBe("blocked");expect(snapshot).toMatchObject({state:"UNKNOWN"});
  f.completed.resolve({state:"failed",summary:"done",events:[resource]});await Promise.resolve();
  expect(await f.adapter.usage!(session.id)).toMatchObject({state:"QUOTA_EXHAUSTED",reason:"reported quota"});
 }finally{f.completed.resolve({state:"failed",summary:"done",events:[resource]});await pending;}
});
it.each(["codex","qoder"] as const)("reads %s native stream resource evidence without result I/O",async provider=>{
 const f=fixture(provider,"running",true),session=await f.adapter.start({runId:"r",workspacePath:"/work"});const pending=f.adapter.usage!(session.id);
 try{expect(await Promise.race([pending,new Promise<"blocked">(resolve=>setImmediate(()=>resolve("blocked")))])).toMatchObject({state:"QUOTA_EXHAUSTED"});expect(f.result).not.toHaveBeenCalled();}
 finally{f.completed.resolve({state:"failed",summary:"done",events:[resource]});await pending;}
});
it.each(["codex","qoder"] as const)("keeps %s result-read failure separate from execution resource state",async provider=>{
 const f=fixture(provider,"completed"),session=await f.adapter.start({runId:"r",workspacePath:"/work"});
 f.completed.reject(Error("token=private-native-failure"));
 const snapshot=await f.adapter.usage!(session.id);expect(snapshot).toMatchObject({telemetry:{status:"unknown",reasonCode:"USAGE_SNAPSHOT_UNAVAILABLE"}});expect(snapshot).not.toHaveProperty("state");expect(JSON.stringify(snapshot)).not.toContain("private-native-failure");
});

it.each(["codex","qoder"] as const)("keeps %s resource observation time and does not move prior-turn data into a new turn",async provider=>{
 const observedAt="2026-10-19T00:00:00Z",reported={...resource,observedAt},next=Promise.withResolvers<{state:"completed";summary:string;events:[]}>(),second=vi.fn(()=>next.promise);let starts=0;
 const start=()=>++starts===1?{status:()=>"completed" as const,cancel:async()=>undefined,result:async()=>({state:"completed" as const,providerSessionId:"native",summary:"done",events:[reported]})}:{status:()=>"running" as const,cancel:async()=>undefined,result:second};
 const adapter:AgentAdapter=provider==="codex"?new CodexAdapter({id:"p",alias:"P",codexHome:"/native"},{start}):new QoderAdapter({id:"p",alias:"P"},{start});
 const session=await adapter.start({runId:"r",workspacePath:"/work"});
 try{
  expect(await adapter.usage!(session.id)).toMatchObject({state:"QUOTA_EXHAUSTED",checkedAt:observedAt});await adapter.send(session.id,"next");
  expect(await adapter.usage!(session.id)).toMatchObject({state:"UNKNOWN"});expect(second).not.toHaveBeenCalled();expect(starts).toBe(2);
 }finally{next.resolve({state:"completed",summary:"done",events:[]});}
});
