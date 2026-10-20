import {expect,it,vi} from "vitest";
import {CodexAdapter,type CodexTurnResult,MemorySessionStore,type AdapterSession,type SessionStore} from "../src/index.js";
const profile={id:"p",alias:"P",codexHome:"/native"};
const result:CodexTurnResult={state:"waiting",summary:"question",providerSessionId:"native",events:[]};
function fixture(store:SessionStore=new MemorySessionStore()){
 const start=vi.fn(()=>({cancel:async()=>{},status:()=>"completed" as const,result:async()=>result}));
 const adapter=new CodexAdapter(profile,{start},store);return {start,adapter,store};
}
const stale=()=>{throw Object.assign(new Error("stale control"),{code:"STALE_CONTROL_EPOCH"});};
it("rejects initial creation at final admission without invoking Codex",async()=>{
 const f=fixture();await expect(f.adapter.start({runId:"r",workspacePath:"/work",beforeSend:stale})).rejects.toMatchObject({creationOutcome:"not-created",code:"STALE_CONTROL_EPOCH"});expect(f.start).not.toHaveBeenCalled();
});
it("rejects an async creation guard before invoking Codex",async()=>{
 const f=fixture();await expect(f.adapter.start({runId:"r",workspacePath:"/work",beforeSend:async()=>{throw new Error("private guard rejection");}})).rejects.toMatchObject({creationOutcome:"not-created",code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(f.start).not.toHaveBeenCalled();
});
it("checks the original authority again after awaiting the previous native result",async()=>{
 const f=fixture(),held=Promise.withResolvers<CodexTurnResult>();f.start.mockImplementationOnce(()=>({cancel:async()=>{},status:()=>"completed",result:()=>held.promise}));
 const session=await f.adapter.start({runId:"r",workspacePath:"/work"});let current=true;
 const pending=f.adapter.send(session.id,"next",()=>{if(!current)stale();});const rejected=expect(pending).rejects.toMatchObject({code:"STALE_CONTROL_EPOCH"});
 current=false;held.resolve(result);await rejected;expect(f.start).toHaveBeenCalledTimes(1);
});
it("forwards resume admission to the same-session final send",async()=>{
 const f=fixture(),session=await f.adapter.start({runId:"r",workspacePath:"/work"});await f.adapter.status(session.id);
 await expect(f.adapter.resume(session.id,stale)).rejects.toMatchObject({code:"STALE_CONTROL_EPOCH"});expect(f.start).toHaveBeenCalledTimes(1);
});
it("requires synchronous authority for same-session input",async()=>{
 const f=fixture(),session=await f.adapter.start({runId:"r",workspacePath:"/work"});
 await expect(f.adapter.send(session.id,"next",async()=>{})).rejects.toMatchObject({code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(f.start).toHaveBeenCalledTimes(1);
});
it("rechecks immediately before native input after storing the new turn intent",async()=>{
 let current=true,starts=0;const memory=new MemorySessionStore();
 const store={load:(id:string)=>memory.load(id),save:(session:AdapterSession)=>{memory.save(session);if(session.state==="STARTING"&&++starts===2)current=false;}};
 const f=fixture(store),session=await f.adapter.start({runId:"r",workspacePath:"/work"});
 await expect(f.adapter.send(session.id,"next",()=>{if(!current)stale();})).rejects.toMatchObject({code:"STALE_CONTROL_EPOCH"});expect(f.start).toHaveBeenCalledTimes(1);
});
it("preserves the original session and input when the final guard succeeds",async()=>{
 const f=fixture(),session=await f.adapter.start({runId:"r",workspacePath:"/work"}),guard=vi.fn();
 expect(await f.adapter.send(session.id,"next",guard)).toMatchObject({sessionId:session.id,type:"session.message"});expect(guard).toHaveBeenCalled();expect(f.start).toHaveBeenLastCalledWith(expect.objectContaining({prompt:"next",providerSessionId:"native",workspacePath:"/work"}));
});
it("captures the original creation guard before storing native intent",async()=>{
 const input={runId:"r",workspacePath:"/work",beforeSend:stale},memory=new MemorySessionStore();
 const f=fixture({load:id=>memory.load(id),save:session=>{memory.save(session);input.beforeSend=()=>{};}});
 await expect(f.adapter.start(input)).rejects.toMatchObject({creationOutcome:"not-created",code:"STALE_CONTROL_EPOCH"});expect(f.start).not.toHaveBeenCalled();
});
it("uses the captured managed cwd and prompt even if caller input changes during intent persistence",async()=>{
 const input={runId:"r",workspacePath:"/work",prompt:"original"},memory=new MemorySessionStore();
 const f=fixture({load:id=>memory.load(id),save:session=>{memory.save(session);input.workspacePath="/different";input.prompt="changed";}});
 const session=await f.adapter.start(input);expect(session.workspacePath).toBe("/work");expect(f.start).toHaveBeenLastCalledWith(expect.objectContaining({workspacePath:"/work",prompt:"original"}));
});
