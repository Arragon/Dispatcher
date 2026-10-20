import {expect,it,vi} from "vitest";
import {AdapterStartError,GenericMockAdapter,type AdapterStartOutcome,type AgentAdapter} from "@dispatcher/adapters";
import type {Run,TaskContract} from "@dispatcher/domain";
import {CanonicalScheduler,type DispatchCandidate} from "../src/index.js";

const contract:TaskContract={version:1,revision:1,goal:"Do it",scope:["."],acceptanceCriteria:["works"],verification:[],constraints:[],delivery:{type:"none"}};
function fixture(adapter:AgentAdapter=new GenericMockAdapter()){
 const settled:AdapterStartOutcome[]=[],sending=vi.fn(),reserved:Run[]=[];
 const candidate:DispatchCandidate={runnerId:"local",runnerTags:[],capacity:1,activeRuns:0,providerId:"codex",profileId:"p",resourceState:"AVAILABLE",capabilities:["code"],adapter};
 const scheduler=new CanonicalScheduler(()=>[candidate]);
 const input={task:{id:"task",projectId:"p",title:"Task",state:"READY" as const,createdAt:"now",updatedAt:"now"},taskRevision:1,contract,requirements:{capabilities:["code"]},workspacePath:"/owned/worktree",onRunStarting:(run:Run)=>{reserved.push(structuredClone(run));},onRunStartSending:sending,onRunStartSettled:(_run:Run,outcome:AdapterStartOutcome)=>{settled.push(outcome);}};
 return {scheduler,input,settled,sending,reserved};
}
it("reserves Session identity before preparation and sends its actual logical counters",async()=>{
 const adapter=new GenericMockAdapter(),start=vi.spyOn(adapter,"start"),f=fixture(adapter);
 const {run}=await f.scheduler.dispatch(f.input);
 expect(f.reserved[0]!.sessionId).not.toMatch(/^unstarted:/);
 expect(start.mock.calls[0]![0]).toMatchObject({sessionId:run.sessionId,execution:{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId}});
 expect(run.state).toBe("ACTIVE");expect(f.sending).toHaveBeenCalledTimes(1);expect(f.settled[0]).toMatchObject({kind:"created",session:{id:f.reserved[0]!.sessionId}});
});
it("marks sending at the adapter final callback after asynchronous preparation",async()=>{
 const adapter=new GenericMockAdapter(),original=adapter.start.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();
 adapter.start=async input=>{entered.resolve();await ready.promise;return original(input);};
 const f=fixture(adapter),pending=f.scheduler.dispatch(f.input);await entered.promise;expect(f.sending).not.toHaveBeenCalled();ready.resolve();await pending;expect(f.sending).toHaveBeenCalledTimes(1);
});
it("retains uncertain creation when native effect is followed by a lost reply",async()=>{
 const adapter=new GenericMockAdapter();adapter.start=async input=>{input.beforeSend?.();throw Error("response lost after create");};
 const f=fixture(adapter),{run}=await f.scheduler.dispatch(f.input);
 expect(run).toMatchObject({state:"RUNNER_UNAVAILABLE",resumePolicy:"manual",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"});expect(run.endedAt).toBeUndefined();expect(f.settled).toMatchObject([{kind:"unknown",code:"NATIVE_START_OUTCOME_UNKNOWN"}]);
});
it("accepts only an explicit not-created proof after entering the adapter",async()=>{
 const adapter=new GenericMockAdapter();adapter.start=async()=>{throw new AdapterStartError("not-created","SPAWN_FAILED","known local spawn failure");};
 const f=fixture(adapter),{run}=await f.scheduler.dispatch(f.input);expect(run.state).toBe("FAILED");expect(run.endedAt).toBeDefined();expect(f.settled).toMatchObject([{kind:"not-created",code:"SPAWN_FAILED"}]);
});
it("does not replace the reserved identity with an unexpected native result",async()=>{
 const adapter=new GenericMockAdapter(),original=adapter.start.bind(adapter);adapter.start=async input=>({...await original(input),id:"unexpected"});
 const f=fixture(adapter),{run}=await f.scheduler.dispatch(f.input);expect(run.sessionId).toBe(f.reserved[0]!.sessionId);expect(run.state).toBe("RUNNER_UNAVAILABLE");expect(f.settled[0]?.kind).toBe("unknown");
});
it("rejects callbacks retained beyond their owning start invocation",async()=>{
 const adapter=new GenericMockAdapter(),original=adapter.start.bind(adapter);let late:(()=>void)|undefined;
 adapter.start=async input=>{late=input.beforeSend;return original(input);};const f=fixture(adapter);await f.scheduler.dispatch(f.input);
 expect(late).toBeTypeOf("function");expect(()=>late!()).toThrowError(expect.objectContaining({code:"NATIVE_START_ADMISSION_CLOSED"}));expect(f.sending).toHaveBeenCalledTimes(1);
});
it("refuses to accept a backend that ignored final admission",async()=>{
 const adapter=new GenericMockAdapter(),original=adapter.start.bind(adapter);adapter.start=input=>original({...input,beforeSend:undefined});
 const f=fixture(adapter),{run}=await f.scheduler.dispatch(f.input);expect(run.state).toBe("RUNNER_UNAVAILABLE");expect(f.sending).not.toHaveBeenCalled();expect(f.settled[0]?.kind).toBe("unknown");
});
it("settles a preflight failure as not sent without entering the adapter",async()=>{
 const adapter=new GenericMockAdapter(),start=vi.spyOn(adapter,"start"),f=fixture(adapter),{run}=await f.scheduler.dispatch({...f.input,beforeStart:async()=>{throw Error("preflight rejected");}});
 expect(run.state).toBe("FAILED");expect(start).not.toHaveBeenCalled();expect(f.sending).not.toHaveBeenCalled();expect(f.settled).toMatchObject([{kind:"not-created",code:"START_NOT_SENT"}]);
});
it("retains uncertainty when persistence of a successful creation fails",async()=>{
 const f=fixture(),{run}=await f.scheduler.dispatch({...f.input,onRunStartSettled:(_run,outcome)=>{if(outcome.kind==="created")throw Error("receipt persistence failed");f.settled.push(outcome);}});
 expect(run.state).toBe("RUNNER_UNAVAILABLE");expect(run.endedAt).toBeUndefined();expect(f.settled[0]?.kind).toBe("unknown");
});
it("keeps native execution contexts closed until the owning backend is qualified",async()=>{
 const adapter=new GenericMockAdapter(),start=vi.spyOn(adapter,"start"),f=fixture(adapter);
 const {run}=await f.scheduler.dispatch({...f.input,onRunStarting:run=>{run.executionRef={version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"work",pathRef:"workspace:work",branch:"task/run",baseRevision:"sha"};}});
 expect(start).not.toHaveBeenCalled();expect(run.state).toBe("FAILED");expect(f.settled).toMatchObject([{kind:"not-created",code:"EXECUTION_CONTEXT_UNQUALIFIED"}]);
});
