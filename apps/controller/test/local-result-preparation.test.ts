import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {InteractionStore,type JsonValue} from "@dispatcher/persistence";
import type {Run} from "@dispatcher/domain";
import type {VerificationCommand,VerificationResult} from "@dispatcher/runner";
import type {DeliveryCandidate} from "@dispatcher/workspace";
import {contentHash} from "../src/task-publications.js";
import {localReviewFixture} from "./fixtures/local-review.js";

type Fixture=Awaited<ReturnType<typeof localReviewFixture>>;
type View=Awaited<ReturnType<Fixture["results"]["read"]>>;
interface Receipt {id:string;state:string;reasonCode?:string;preparation?:{profileHash:string;commands:VerificationCommand[];checks:VerificationResult[]};proof?:{snapshot:DeliveryCandidate;commandIds:string[];checks:VerificationResult[]}}
const body=(view:View,idempotencyKey:string)=>({...view.authority!,candidateId:view.candidate!.id,idempotencyKey,confirmed:true as const});
const receipt=(f:Fixture)=>{const pointer=f.service.database.getEntity("local-review-current",f.receipt.runId) as {id:string};return f.service.database.getEntity("local-review-verification",pointer.id) as unknown as Receipt;};
const saveReceipt=(f:Fixture,value:Receipt)=>f.service.database.handle.prepare("UPDATE entities SET document_json=? WHERE kind='local-review-verification' AND id=?").run(JSON.stringify(value),value.id);
const facts=(path:string)=>({head:execFileSync("git",["-C",path,"rev-parse","HEAD"]).toString(),index:readFileSync(execFileSync("git",["-C",path,"rev-parse","--path-format=absolute","--git-path","index"]).toString().trim()).toString("base64"),bytes:readFileSync(join(path,"result.txt"),"utf8"),readme:readFileSync(join(path,"README.md"),"utf8"),env:readFileSync(join(path,"env.txt"),"utf8")});
const record=(f:Fixture,value:unknown)=>writeFileSync(join(f.root,"test-facts.json"),JSON.stringify(value,null,2));
const scriptPrefix="const fs=require('node:fs'),root=process.cwd().split('/data/')[0];";
const log=(phase:string)=>`fs.appendFileSync(root+'/preparation-facts.jsonl',JSON.stringify({phase:${JSON.stringify(phase)},cwd:process.cwd(),pwd:process.env.PWD,env:fs.existsSync('env.txt')?fs.readFileSync('env.txt','utf8'):null})+'\\n');`;
const prepare=scriptPrefix+log("prepare-0")+"if(!fs.existsSync('env.txt'))fs.writeFileSync('env.txt','prepared');";
const second=scriptPrefix+log("prepare-1")+"if(!['source-only','prepared'].includes(fs.readFileSync('env.txt','utf8')))process.exit(8);";
const check=scriptPrefix+log("check")+"if(!['source-only','prepared'].includes(fs.readFileSync('env.txt','utf8')))process.exit(9);";
const childFacts=(f:Fixture)=>existsSync(join(f.root,"preparation-facts.jsonl"))?readFileSync(join(f.root,"preparation-facts.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line) as {phase:string;cwd:string;pwd:string;env:string|null}):[];
const noAcceptance=(f:Fixture)=>{expect(f.service.database.listEntities("local-review-acceptance")).toEqual([]);expect(f.service.database.getCanonicalTask(f.receipt.taskId)?.document).toMatchObject({state:"REVIEW"});expect(f.starts()).toBe(1);};

it("reconstructs ignored environment only inside the snapshot in profile order and accepts exact frozen evidence once",async()=>{
 const f=await localReviewFixture({preparationScripts:[prepare,second],verificationScript:check});
 try{
  const initial=await f.results.read(f.receipt.runId),before=facts(initial.candidate!.worktree),registered=f.service.configuration.current().config.repositories[0]!;
  expect(f.service.database.getEntity("run-snapshot-verification-config",f.receipt.runId)).toEqual({version:1,profile:registered.snapshotVerification});
  const request=body(initial,"ordered"),verified=await f.results.verify(f.receipt.runId,request,"owner"),proof=receipt(f),observed=childFacts(f);
  record(f,{before,after:facts(initial.candidate!.worktree),verified,proof,observed});
  expect(verified.state).toBe("verified");expect(verified.verification!.commandIds).toEqual(["prepare-0","prepare-1","check"]);
  expect(observed.slice(-3)).toEqual([{phase:"prepare-0",cwd:proof.proof!.snapshot.path,pwd:proof.proof!.snapshot.path,env:null},{phase:"prepare-1",cwd:proof.proof!.snapshot.path,pwd:proof.proof!.snapshot.path,env:"prepared"},{phase:"check",cwd:proof.proof!.snapshot.path,pwd:proof.proof!.snapshot.path,env:"prepared"}]);
  expect(proof.preparation).toEqual({profileHash:contentHash(registered.snapshotVerification),commands:registered.verificationCommands.slice(0,2),checks:expect.arrayContaining([expect.objectContaining({commandId:"prepare-0",status:"passed",exitCode:0}),expect.objectContaining({commandId:"prepare-1",status:"passed",exitCode:0})])});
  expect(facts(initial.candidate!.worktree)).toEqual(before);expect(readFileSync(join(proof.proof!.snapshot.path,"env.txt"),"utf8")).toBe("prepared");
  await f.results.verify(f.receipt.runId,request,"owner");expect(childFacts(f)).toEqual(observed);
  const accept={...body(verified,"accept"),verificationId:verified.verification!.id},one=await f.results.accept(f.receipt.runId,accept,"owner");expect((await f.results.accept(f.receipt.runId,accept,"owner")).repeated).toBe(true);expect((await f.results.read(f.receipt.runId)).acceptance).toEqual(one.acceptance);expect(f.starts()).toBe(1);
 }finally{await f.close();}
});
it("an optional failing preparation retains its actual failed result and blocks all later commands and acceptance",async()=>{
 const f=await localReviewFixture({preparationScripts:[scriptPrefix+log("failed")+"console.log('token=private-value');process.exit(7)",second],verificationScript:check});
 try{const initial=await f.results.read(f.receipt.runId),before=childFacts(f),result=await f.results.verify(f.receipt.runId,body(initial,"failed"),"owner"),proof=receipt(f);record(f,{result,proof,children:childFacts(f)});
  expect(result).toMatchObject({state:"failed",reasonCode:"SNAPSHOT_PREPARATION_FAILED"});expect(childFacts(f).slice(before.length).map(value=>value.phase)).toEqual(["failed"]);
  expect(proof.preparation!.checks).toEqual([expect.objectContaining({commandId:"prepare-0",required:false,status:"failed",exitCode:7})]);expect(proof.preparation!.checks[0]!.output).not.toContain("private-value");expect(proof.proof).toBeUndefined();
  await expect(f.results.accept(f.receipt.runId,{...body(initial,"refuse"),verificationId:proof.id},"owner")).rejects.toMatchObject({code:"VERIFIED_CANDIDATE_REQUIRED"});noAcceptance(f);
 }finally{await f.close();}
});
it("qualifies an explicit empty preparation profile",async()=>{
 const f=await localReviewFixture({preparationScripts:[]});try{const initial=await f.results.read(f.receipt.runId),verified=await f.results.verify(f.receipt.runId,body(initial,"empty"),"owner"),proof=receipt(f);record(f,{verified,proof});expect(verified.state).toBe("verified");expect(proof.preparation).toEqual({profileHash:contentHash(f.service.configuration.current().config.repositories[0]!.snapshotVerification),commands:[],checks:[]});expect(verified.verification!.commandIds).toEqual(["check"]);}finally{await f.close();}
});
it("executes selected required preparation only once",async()=>{
 const f=await localReviewFixture({preparationScripts:[prepare],preparationRequired:true,verificationScript:check});try{const initial=await f.results.read(f.receipt.runId),before=childFacts(f).length,verified=await f.results.verify(f.receipt.runId,body(initial,"overlap"),"owner"),proof=receipt(f);record(f,{verified,proof,children:childFacts(f)});expect(verified.state).toBe("verified");expect(childFacts(f).slice(before).map(value=>value.phase)).toEqual(["prepare-0","check"]);expect(proof.proof!.commandIds).toEqual(["prepare-0","check"]);

 }finally{await f.close();}
});
it.each(["tracked","nonignored"] as const)("refuses %s preparation mutation before any verification check",async mutation=>{
 const script=scriptPrefix+log("mutation")+(mutation==="tracked"?"fs.writeFileSync('README.md','changed')":"fs.writeFileSync('not-ignored.txt','changed')");
 const f=await localReviewFixture({preparationScripts:[script],verificationScript:check});try{const initial=await f.results.read(f.receipt.runId),before=facts(initial.candidate!.worktree),count=childFacts(f).length,result=await f.results.verify(f.receipt.runId,body(initial,"rewrite"),"owner"),proof=receipt(f);record(f,{before,after:facts(initial.candidate!.worktree),result,proof,children:childFacts(f)});expect(result).toMatchObject({state:"failed",reasonCode:"VERIFICATION_SNAPSHOT_CHANGED"});expect(childFacts(f).slice(count).map(value=>value.phase)).toEqual(["mutation"]);expect(proof.preparation!.checks).toHaveLength(1);expect(facts(initial.candidate!.worktree)).toEqual(before);noAcceptance(f);}finally{await f.close();}
});

it("rejects a real completed publication whose only required registered command is preparation",async()=>{
 const f=await localReviewFixture({preparationScripts:[prepare],preparationRequired:true,verificationRequired:false,verificationScript:check});
 try{const result=await f.results.read(f.receipt.runId);record(f,{result,children:childFacts(f),contract:f.service.database.getEntity("run-contract",f.receipt.runId)});expect(result).toMatchObject({state:"unavailable",reasonCode:"VERIFICATION_NOT_REGISTERED"});await expect(f.results.verify(f.receipt.runId,{taskRevision:0,generation:1,leaseId:"unused",controlEpoch:0,controlRevision:0,candidateId:"0".repeat(64),idempotencyKey:"no-required-check",confirmed:true},"owner")).rejects.toMatchObject({code:"VERIFICATION_NOT_REGISTERED"});noAcceptance(f);}finally{await f.close();}
});

it.each(["missing","profileHash","definition","command-order","checks-missing","check-order","check-id","check-required","check-status","check-exit","proof-check"] as const)("refuses %s completed preparation evidence, never replays its key, and allows one fresh confirmed execution",async change=>{
 const f=await localReviewFixture({preparationScripts:[prepare,second],verificationScript:check});
 try{
  const initial=await f.results.read(f.receipt.runId),request=body(initial,"original-proof"),verified=await f.results.verify(f.receipt.runId,request,"owner");expect(verified.state).toBe("verified");
  const original=receipt(f),damaged=structuredClone(original),evidence=damaged.preparation!;
  if(change==="missing")delete damaged.preparation;
  if(change==="profileHash")evidence.profileHash="0".repeat(64);
  if(change==="definition")evidence.commands[0]!.args.push("tampered");
  if(change==="command-order")evidence.commands.reverse();
  if(change==="checks-missing")evidence.checks=[];
  if(change==="check-order")evidence.checks.reverse();
  if(change==="check-id")evidence.checks[0]!.commandId="check";
  if(change==="check-required")evidence.checks[0]!.required=true;
  if(change==="check-status")evidence.checks[0]!.status="failed";
  if(change==="check-exit")evidence.checks[0]!.exitCode=1;
  if(change==="proof-check")damaged.proof!.checks[0]!.output="different actual result";
  saveReceipt(f,damaged);const before=childFacts(f).length,read=await f.results.read(f.receipt.runId),replay=await f.results.verify(f.receipt.runId,request,"owner");
  expect(read).toMatchObject({state:"unverified",reasonCode:"SNAPSHOT_PREPARATION_REQUIRED"});expect(replay).toEqual(read);expect(childFacts(f)).toHaveLength(before);
  await expect(f.results.accept(f.receipt.runId,{...body(read,"refuse-damage"),verificationId:damaged.id},"owner")).rejects.toMatchObject({code:"VERIFIED_CANDIDATE_REQUIRED"});noAcceptance(f);
  const fresh=await f.results.verify(f.receipt.runId,body(read,"fresh-confirmed"),"owner");record(f,{change,original,damaged,read,replay,before,after:childFacts(f).length,fresh,receipt:receipt(f)});expect(fresh.state).toBe("verified");expect(childFacts(f)).toHaveLength(before+3);expect(f.starts()).toBe(1);
 }finally{await f.close();}
});

it.each(["definition","profile","removed-profile","missing-marker","malformed-marker","null-marker"] as const)("refuses %s drift before preparation without adopting current authorization",async change=>{
 const f=await localReviewFixture({preparationScripts:[prepare],verificationScript:check});
 try{const initial=await f.results.read(f.receipt.runId),before=childFacts(f),config=f.service.configuration.current().config;
  if(change==="definition")config.repositories[0]!.verificationCommands[0]!.args=["-e","process.exit(0)"];
  if(change==="profile")config.repositories[0]!.snapshotVerification!.id="different";
  if(change==="removed-profile")delete config.repositories[0]!.snapshotVerification;
  if(["definition","profile","removed-profile"].includes(change))await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});
  else if(change==="missing-marker")f.service.database.handle.prepare("DELETE FROM entities WHERE kind='run-snapshot-verification-config' AND id=?").run(f.receipt.runId);
  else f.service.database.saveEntity("run-snapshot-verification-config",f.receipt.runId,change==="null-marker"?{version:1,profile:null}:{version:1,profile:{version:1,id:"broken",preparationCommandIds:"prepare-0"}});
  const code=["definition","profile","removed-profile"].includes(change)?"LOCAL_REVIEW_CONTEXT_CHANGED":"VERIFICATION_ENVIRONMENT_UNAVAILABLE",read=await f.results.read(f.receipt.runId);
  await expect(f.results.verify(f.receipt.runId,body(initial,"refuse-config"),"owner")).rejects.toMatchObject({code});record(f,{change,read,before,after:childFacts(f)});expect(read).toMatchObject({state:"unavailable",reasonCode:code});expect(childFacts(f)).toEqual(before);expect(f.service.database.listEntities("local-review-verification")).toEqual([]);noAcceptance(f);
 }finally{await f.close();}
});
it("preserves no-profile legacy missing-marker qualification and refuses a malformed marker",async()=>{
 const f=await localReviewFixture();try{expect(f.service.database.getEntity("run-snapshot-verification-config",f.receipt.runId)).toEqual({version:1,profile:null});f.service.database.handle.prepare("DELETE FROM entities WHERE kind='run-snapshot-verification-config' AND id=?").run(f.receipt.runId);const initial=await f.results.read(f.receipt.runId),verified=await f.results.verify(f.receipt.runId,body(initial,"legacy-no-profile"),"owner");expect(verified.state).toBe("verified");expect(receipt(f).preparation).toBeUndefined();f.service.database.saveEntity("run-snapshot-verification-config",f.receipt.runId,{version:1,profile:null,extra:true});expect(await f.results.read(f.receipt.runId)).toMatchObject({state:"unavailable",reasonCode:"VERIFICATION_ENVIRONMENT_UNAVAILABLE"});}finally{await f.close();}
});

const heldPreparation=prepare+"fs.writeFileSync(root+'/preparation-entered',JSON.stringify({pid:process.pid,cwd:process.cwd()}));const timer=setInterval(()=>{if(fs.existsSync(root+'/preparation-release'))clearInterval(timer)},10);";
const processState=(pid:number)=>{try{process.kill(pid,0);return "alive";}catch(error){return (error as NodeJS.ErrnoException).code??"unknown";}};
it.each(["source","task","control","config","generation","lease"] as const)("retains the actual preparation result and refuses proof when %s drifts during its real child",async change=>{
 const f=await localReviewFixture({preparationScripts:[heldPreparation],verificationScript:check});let pending:Promise<View>|undefined;
 try{const initial=await f.results.read(f.receipt.runId),before=facts(initial.candidate!.worktree),count=childFacts(f).length,sentinel={reason:"owned-test-invalidation"};f.service.database.saveEntity("native-verification-invalidation",f.receipt.runId,sentinel);
  const invoked=f.armSnapshotInvocation("prepare-0");pending=f.results.verify(f.receipt.runId,body(initial,"in-flight-preparation"),"owner");await invoked(pending);await vi.waitFor(()=>expect(existsSync(join(f.root,"preparation-entered"))).toBe(true));const entered=JSON.parse(readFileSync(join(f.root,"preparation-entered"),"utf8"));
  if(change==="source")writeFileSync(join(initial.candidate!.worktree,"result.txt"),"changed during preparation\n");
  if(change==="task"){const task=f.service.database.getCanonicalTask(f.receipt.taskId)!;f.service.database.writeCanonicalTask(f.receipt.taskId,task.revision,{...task.document as object,title:"changed during preparation"},new Date().toISOString());}
  if(change==="control"){const store=new InteractionStore(f.service.database),control=store.control(initial.sessionId)!;store.compareAndSwapControl({sessionId:initial.sessionId,expectedRevision:control.revision,expectedEpoch:control.epoch,actorId:"owner",event:{type:"conflict",at:new Date().toISOString()}});}
  if(change==="config"){const config=f.service.configuration.current().config;config.repositories[0]!.snapshotVerification!.id="changed-in-flight";await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});}
  if(change==="generation"||change==="lease"){const run=f.service.database.getEntity("run",f.receipt.runId) as unknown as Run;f.service.database.saveEntity("run",run.id,{...run,...(change==="generation"?{generation:run.generation+1}:{leaseId:"changed-in-flight"})} as unknown as JsonValue);}
  writeFileSync(join(f.root,"preparation-release"),"release");const result=await pending,proof=receipt(f),absence=processState(entered.pid);record(f,{change,before,after:facts(initial.candidate!.worktree),entered,result,proof,absence,children:childFacts(f)});
  expect(proof.state).toBe("FAILED");expect(proof.proof).toBeUndefined();expect(proof.preparation!.checks).toEqual([expect.objectContaining({commandId:"prepare-0",status:"passed",exitCode:0})]);expect(absence).toBe("ESRCH");expect(childFacts(f).slice(count).map(value=>value.phase)).toEqual(["prepare-0"]);expect(result.verification).toBeUndefined();await expect(f.results.accept(f.receipt.runId,{...body(initial,"refuse-drift"),verificationId:proof.id},"owner")).rejects.toThrow();expect(f.service.database.getEntity("native-verification-invalidation",f.receipt.runId)).toEqual(sentinel);noAcceptance(f);
 }finally{writeFileSync(join(f.root,"preparation-release"),"cleanup");await pending;await f.close();}
});
it("cancels and drains an actual preparation child, keeps its failed result and same-key barrier, and permits a fresh confirmed attempt",async()=>{
 const f=await localReviewFixture({preparationScripts:[heldPreparation],verificationScript:check});let pending:Promise<View>|undefined;
 try{const initial=await f.results.read(f.receipt.runId),request=body(initial,"cancel-preparation");const invoked=f.armSnapshotInvocation("prepare-0");pending=f.results.verify(f.receipt.runId,request,"owner");await invoked(pending);await vi.waitFor(()=>expect(existsSync(join(f.root,"preparation-entered"))).toBe(true));const entered=JSON.parse(readFileSync(join(f.root,"preparation-entered"),"utf8")),running=await f.results.read(f.receipt.runId);expect(running).toMatchObject({state:"running",pendingVerification:{owned:true}});const stopped=await f.results.cancel(f.receipt.runId,running.pendingVerification!.id,"owner");await pending;const proof=receipt(f),before=childFacts(f).length,absence=processState(entered.pid);expect(stopped).toMatchObject({state:"failed",reasonCode:"LOCAL_VERIFICATION_CANCELLED"});expect(proof.preparation!.checks).toEqual([expect.objectContaining({commandId:"prepare-0",status:"failed"})]);expect(absence).toBe("ESRCH");await f.results.verify(f.receipt.runId,request,"owner");expect(childFacts(f)).toHaveLength(before);noAcceptance(f);writeFileSync(join(f.root,"preparation-release"),"fresh may finish");const fresh=await f.results.verify(f.receipt.runId,body(stopped,"fresh-after-cancel"),"owner");record(f,{entered,stopped,proof,before,absence,fresh,after:childFacts(f)});expect(fresh.state).toBe("verified");expect(childFacts(f)).toHaveLength(before+2);expect(f.starts()).toBe(1);
 }finally{writeFileSync(join(f.root,"preparation-release"),"cleanup");await pending;await f.close();}
});

it("an optional preparation timeout blocks the required check and retains the actual timeout and absent child",async()=>{
 const timeout=scriptPrefix+log("timeout")+"fs.writeFileSync(root+'/timeout-pid',String(process.pid));setInterval(()=>{},1000);";
 const f=await localReviewFixture({preparationScripts:[timeout],verificationScript:check});try{const initial=await f.results.read(f.receipt.runId),before=childFacts(f).length,result=await f.results.verify(f.receipt.runId,body(initial,"prep-timeout"),"owner"),proof=receipt(f),pid=Number(readFileSync(join(f.root,"timeout-pid"),"utf8")),absence=processState(pid);record(f,{result,proof,pid,absence,children:childFacts(f)});expect(result).toMatchObject({state:"failed",reasonCode:"SNAPSHOT_PREPARATION_FAILED"});expect(proof.preparation!.checks).toEqual([expect.objectContaining({commandId:"prepare-0",required:false,status:"timeout"})]);expect(absence).toBe("ESRCH");expect(childFacts(f).slice(before).map(value=>value.phase)).toEqual(["timeout"]);noAcceptance(f);}finally{await f.close();}
});
it.each(["SENDING","UNKNOWN"] as const)("keeps a configured %s proof barrier even when preparation evidence is missing",async state=>{
 const f=await localReviewFixture({preparationScripts:[prepare],verificationScript:check});try{const initial=await f.results.read(f.receipt.runId),request=body(initial,"before-uncertainty");await f.results.verify(f.receipt.runId,request,"owner");const damaged=receipt(f);delete damaged.preparation;damaged.state=state;saveReceipt(f,damaged);const before=childFacts(f).length,read=await f.results.read(f.receipt.runId);expect(read).toMatchObject({state:"unknown",reasonCode:"VERIFICATION_OUTCOME_UNKNOWN"});for(const idempotencyKey of [request.idempotencyKey,"fresh-uncertain"])await expect(f.results.verify(f.receipt.runId,{...request,idempotencyKey},"owner")).rejects.toMatchObject({code:"VERIFICATION_OUTCOME_UNKNOWN"});expect(childFacts(f)).toHaveLength(before);noAcceptance(f);record(f,{damaged,before,read,children:childFacts(f)});}finally{await f.close();}
});
it("never supplies a newly configured preparation profile to a completed no-profile Run",async()=>{
 const f=await localReviewFixture();try{const initial=await f.results.read(f.receipt.runId),config=f.service.configuration.current().config;config.repositories[0]!.snapshotVerification={version:1,id:"new-authorization",preparationCommandIds:[]};await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});expect(await f.results.read(f.receipt.runId)).toMatchObject({state:"unavailable",reasonCode:"VERIFICATION_ENVIRONMENT_UNAVAILABLE"});await expect(f.results.verify(f.receipt.runId,body(initial,"no-adoption"),"owner")).rejects.toMatchObject({code:"VERIFICATION_ENVIRONMENT_UNAVAILABLE"});expect(f.service.database.listEntities("local-review-verification")).toEqual([]);noAcceptance(f);}finally{await f.close();}
});
it("captures and cleans its actual failed automatic setup before returning the setup failure",async()=>{
 await expect(localReviewFixture({preparationScripts:[prepare],verificationScript:"process.exit(7)"})).rejects.toThrow("FIXTURE_ADVANCE_FAILED");
});
it("accepts a dispatch-frozen profile id at the schema's 100 astral-code-point boundary",async()=>{
 const f=await localReviewFixture({preparationScripts:[prepare],verificationScript:check,preparationProfileId:"🙂".repeat(100)});try{const initial=await f.results.read(f.receipt.runId);expect(initial.state).toBe("unverified");const verified=await f.results.verify(f.receipt.runId,body(initial,"unicode-profile"),"owner");record(f,{initial,verified,receipt:receipt(f)});expect(verified.state).toBe("verified");expect(receipt(f).preparation!.profileHash).toBe(contentHash(f.service.configuration.current().config.repositories[0]!.snapshotVerification));}finally{await f.close();}
});

it("keeps a snapshot invocation latch bound to its fixture root and removes it on early completion",async()=>{
 const owner=await localReviewFixture();let other:Fixture|undefined;
 try{
  other=await localReviewFixture();const initial=await other.results.read(other.receipt.runId),invoked=owner.armSnapshotInvocation("check"),work=other.results.verify(other.receipt.runId,body(initial,"foreign-fixture-invocation"),"owner");
  await expect(invoked(work)).rejects.toThrow("Verification completed before the owned snapshot command invocation");expect((await work).state).toBe("verified");expect(owner.pendingSnapshotInvocations()).toBe(0);
 }finally{try{await other?.close();}finally{await owner.close();}}
});
it("resolves a snapshot invocation latch only for the selected registered command",async()=>{
 const f=await localReviewFixture({preparationScripts:[prepare],verificationScript:check});
 try{
  const initial=await f.results.read(f.receipt.runId),invoked=f.armSnapshotInvocation("check"),work=f.results.verify(f.receipt.runId,body(initial,"selected-command-invocation"),"owner"),invocation=await invoked(work);
  expect(invocation.commandId).toBe("check");expect(invocation.cwd.startsWith(join(f.root,"data","verification-snapshots")+"/")).toBe(true);expect((await work).state).toBe("verified");expect(f.pendingSnapshotInvocations()).toBe(0);
 }finally{await f.close();}
});
it("does not treat its own automatic worktree check as a snapshot invocation",async()=>{
 const f=await localReviewFixture({advance:false});
 try{
  const invoked=f.armSnapshotInvocation("check"),work=Promise.resolve(f.service.app.inject({method:"POST",url:`/api/runs/${f.receipt.runId}/advance`,headers:f.headers}));
  await expect(invoked(work)).rejects.toThrow("Verification completed before the owned snapshot command invocation");expect((await work).statusCode).toBe(200);expect(f.pendingSnapshotInvocations()).toBe(0);
 }finally{await f.close();}
});
it("preserves an early verification rejection and removes its snapshot invocation waiter",async()=>{
 const f=await localReviewFixture();
 try{
  const initial=await f.results.read(f.receipt.runId),invoked=f.armSnapshotInvocation("check"),work=f.results.verify("unknown-controlled-run",body(initial,"early-rejected-invocation"),"owner"),outcomes=await Promise.allSettled([work,invoked(work)]);
  expect(outcomes[0]!.status).toBe("rejected");expect(outcomes[1]!.status).toBe("rejected");if(outcomes[0]!.status==="rejected"&&outcomes[1]!.status==="rejected")expect(outcomes[1]!.reason).toBe(outcomes[0]!.reason);expect(f.pendingSnapshotInvocations()).toBe(0);
 }finally{await f.close();}
});
it("settles and removes an armed snapshot invocation waiter when its fixture closes",async()=>{
 const f=await localReviewFixture();let closed=false;
 try{
  const invoked=f.armSnapshotInvocation("check");expect(f.pendingSnapshotInvocations()).toBe(1);closed=true;await f.close();await expect(invoked(Promise.resolve())).rejects.toThrow("Fixture closed before snapshot command invocation");expect(f.pendingSnapshotInvocations()).toBe(0);expect(()=>f.armSnapshotInvocation("check")).toThrow("Fixture is closed");
 }finally{if(!closed)await f.close();}
});
