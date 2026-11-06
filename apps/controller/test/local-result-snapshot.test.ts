import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {InteractionStore} from "@dispatcher/persistence";
import type {DeliveryCandidate} from "@dispatcher/workspace";
import {localReviewFixture} from "./fixtures/local-review.js";

type Fixture=Awaited<ReturnType<typeof localReviewFixture>>;
type View=Awaited<ReturnType<Fixture['results']['read']>>;
const body=(view:View,idempotencyKey:string)=>({...view.authority!,candidateId:view.candidate!.id,idempotencyKey,confirmed:true as const});
const proof=(f:Fixture)=>{
 const pointer=f.service.database.getEntity('local-review-current',f.receipt.runId) as {id:string};
 return f.service.database.getEntity('local-review-verification',pointer.id) as {id:string;state:string;proof?:{executionBasis?:string;snapshot:DeliveryCandidate;checks:{output:string}[]}};
};
const sourceFacts=(path:string)=>({head:execFileSync('git',['-C',path,'rev-parse','HEAD']).toString(),index:execFileSync('git',['-C',path,'ls-files','--stage','-z']).toString(),indexBytes:readFileSync(execFileSync('git',['-C',path,'rev-parse','--path-format=absolute','--git-path','index']).toString().trim()).toString('base64'),bytes:readFileSync(join(path,'result.txt'),'utf8')});
const childFacts="{const facts={cwd:process.cwd(),pwd:process.env.PWD,top:require('node:child_process').execFileSync('git',['rev-parse','--show-toplevel']).toString().trim()};require('node:fs').appendFileSync(process.cwd().split('/data/')[0]+'/child-facts.jsonl',JSON.stringify(facts)+'\\n');console.log(JSON.stringify(facts))}";
const record=(f:Fixture,facts:unknown)=>writeFileSync(join(f.root,'test-facts.json'),JSON.stringify(facts,null,2));

it("executes the registered check in the actual isolated snapshot and records its private execution basis",async()=>{
 const f=await localReviewFixture({verificationScript:childFacts});
 try{
  const initial=await f.results.read(f.receipt.runId),before=sourceFacts(initial.candidate!.worktree);
  const verified=await f.results.verify(f.receipt.runId,body(initial,'isolated'),'owner'),receipt=proof(f);
  const facts=JSON.parse(readFileSync(join(f.root,'child-facts.jsonl'),'utf8').trim().split('\n').at(-1)!);
  record(f,{before,after:sourceFacts(initial.candidate!.worktree),verified,receipt,facts});
  expect(verified.state).toBe('verified');
  expect(facts).toEqual({cwd:receipt.proof!.snapshot.path,pwd:receipt.proof!.snapshot.path,top:receipt.proof!.snapshot.path});
  expect(facts.cwd).not.toBe(initial.candidate!.worktree);
  expect(receipt.proof!.executionBasis).toBe('isolated-snapshot-v1');
  expect(verified.verification!.basis).toBe('matching-managed-source');
  expect(sourceFacts(initial.candidate!.worktree)).toEqual(before);expect(f.starts()).toBe(1);
 }finally{await f.close();}
});

it("refuses a registered snapshot rewrite without changing source bytes, HEAD or index or accepting it",async()=>{
 // Automatic Run verification is the first invocation. Only the explicit local review rewrites.
 const script="const fs=require('node:fs'),marker=process.cwd().split('/data/')[0]+'/automatic-check-done';if(fs.existsSync(marker))fs.writeFileSync('result.txt','rewritten by check\\n');else fs.writeFileSync(marker,'automatic');"+childFacts;
 const f=await localReviewFixture({verificationScript:script});
 try{
  const initial=await f.results.read(f.receipt.runId),before=sourceFacts(initial.candidate!.worktree);
  const result=await f.results.verify(f.receipt.runId,body(initial,'rewrite'),'owner'),receipt=proof(f);
  const directory=join(f.root,'data/verification-snapshots'),manifest=readdirSync(directory).find(name=>name.endsWith('.json'))!;
  const snapshot=JSON.parse(readFileSync(join(directory,manifest),'utf8')) as DeliveryCandidate;
  record(f,{before,after:sourceFacts(initial.candidate!.worktree),result,receipt,snapshot,snapshotBytes:readFileSync(join(snapshot.path,'result.txt'),'utf8')});
  expect(result).toMatchObject({state:'failed',reasonCode:'VERIFICATION_SNAPSHOT_CHANGED'});
  expect(sourceFacts(initial.candidate!.worktree)).toEqual(before);
  expect(readFileSync(join(snapshot.path,'result.txt'),'utf8')).toBe('rewritten by check\n');
  expect(receipt.proof).toBeUndefined();expect(result.verification).toBeUndefined();
  await expect(f.results.accept(f.receipt.runId,{...body(initial,'refuse-rewrite'),verificationId:receipt.id},'owner')).rejects.toMatchObject({code:'VERIFIED_CANDIDATE_REQUIRED'});
  expect(f.service.database.listEntities('local-review-acceptance')).toEqual([]);
  expect(f.service.database.getCanonicalTask(f.receipt.taskId)?.document).toMatchObject({state:'REVIEW'});expect(f.starts()).toBe(1);
 }finally{await f.close();}
});

const removeExecutionBasis=(f:Fixture,state?:'SENDING'|'UNKNOWN')=>{
 const receipt=proof(f);delete receipt.proof!.executionBasis;
 if(state)receipt.state=state;
 f.service.database.handle.prepare("UPDATE entities SET document_json=? WHERE kind='local-review-verification' AND id=?").run(JSON.stringify(receipt),receipt.id);
 return receipt;
};
const childCount=(f:Fixture)=>readFileSync(join(f.root,'child-facts.jsonl'),'utf8').trim().split('\n').length;

it("requires fresh isolated execution for a legacy completed proof without replaying the same key",async()=>{
 const f=await localReviewFixture({verificationScript:childFacts});
 try{
  const initial=await f.results.read(f.receipt.runId),request=body(initial,'legacy');
  const verified=await f.results.verify(f.receipt.runId,request,'owner');expect(verified.state).toBe('verified');
  const legacy=removeExecutionBasis(f),before=childCount(f),read=await f.results.read(f.receipt.runId),replay=await f.results.verify(f.receipt.runId,request,'owner'),afterReplay=childCount(f);
  const fresh=await f.results.verify(f.receipt.runId,body(read,'fresh-confirmed'),'owner');
  record(f,{legacy,read,replay,before,afterReplay,afterFresh:childCount(f),fresh,receipt:proof(f)});
  expect(read).toMatchObject({state:'unverified',reasonCode:'ISOLATED_VERIFICATION_REQUIRED'});expect(read.verification).toBeUndefined();
  expect(replay).toMatchObject({state:'unverified',reasonCode:'ISOLATED_VERIFICATION_REQUIRED'});expect(afterReplay).toBe(before);
  expect(fresh.state).toBe('verified');expect(proof(f).proof!.executionBasis).toBe('isolated-snapshot-v1');expect(childCount(f)).toBe(before+1);
  expect(f.service.database.getCanonicalTask(f.receipt.taskId)?.document).toMatchObject({state:'REVIEW'});expect(f.starts()).toBe(1);
 }finally{await f.close();}
});

it("refuses acceptance of a legacy completed proof without changing Task or acceptance receipts",async()=>{
 const f=await localReviewFixture({verificationScript:childFacts});
 try{
  const initial=await f.results.read(f.receipt.runId),verified=await f.results.verify(f.receipt.runId,body(initial,'verify'),'owner');
  const legacy=removeExecutionBasis(f),before=childCount(f);
  let outcome:unknown;try{outcome=await f.results.accept(f.receipt.runId,{...body(verified,'legacy-accept'),verificationId:verified.verification!.id},'owner');}catch(error){outcome={code:(error as {code:string}).code};}
  record(f,{legacy,outcome,before,after:childCount(f)});
  expect(outcome).toEqual({code:'VERIFIED_CANDIDATE_REQUIRED'});
  expect(f.service.database.getCanonicalTask(f.receipt.taskId)?.document).toMatchObject({state:'REVIEW'});
  expect(f.service.database.listEntities('local-review-acceptance')).toEqual([]);expect(f.service.database.listEntities('local-review-receipt')).toEqual([]);
  expect(childCount(f)).toBe(before);expect(f.starts()).toBe(1);
 }finally{await f.close();}
});

it.each(['SENDING','UNKNOWN'] as const)("preserves a legacy %s replay barrier without the discriminator",async state=>{
 const f=await localReviewFixture({verificationScript:childFacts});
 try{
  const initial=await f.results.read(f.receipt.runId),request=body(initial,'verify');await f.results.verify(f.receipt.runId,request,'owner');
  const legacy=removeExecutionBasis(f,state),before=childCount(f),read=await f.results.read(f.receipt.runId);
  await expect(f.results.verify(f.receipt.runId,request,'owner')).rejects.toMatchObject({code:'VERIFICATION_OUTCOME_UNKNOWN'});
  await expect(f.results.verify(f.receipt.runId,{...request,idempotencyKey:'new-key'},'owner')).rejects.toMatchObject({code:'VERIFICATION_OUTCOME_UNKNOWN'});
  record(f,{legacy,read,before,after:childCount(f)});
  expect(read).toMatchObject({state:'unknown',reasonCode:'VERIFICATION_OUTCOME_UNKNOWN'});expect(childCount(f)).toBe(before);expect(f.starts()).toBe(1);
 }finally{await f.close();}
});

it("preserves historical accepted facts and same-acceptance replay when its proof is legacy",async()=>{
 const f=await localReviewFixture({verificationScript:childFacts});
 try{
  const initial=await f.results.read(f.receipt.runId),verified=await f.results.verify(f.receipt.runId,body(initial,'verify'),'owner'),request={...body(verified,'accept'),verificationId:verified.verification!.id};
  const accepted=await f.results.accept(f.receipt.runId,request,'owner'),legacy=removeExecutionBasis(f),before=childCount(f),replay=await f.results.accept(f.receipt.runId,request,'owner'),read=await f.results.read(f.receipt.runId);
  record(f,{accepted,legacy,replay,read,before,after:childCount(f)});
  expect(replay).toEqual({...accepted,repeated:true});expect(read).toMatchObject({state:'accepted',acceptance:accepted.acceptance});
  expect(f.service.database.getCanonicalTask(f.receipt.taskId)?.document).toMatchObject({state:'DONE'});expect(childCount(f)).toBe(before);expect(f.starts()).toBe(1);
 }finally{await f.close();}
});

const heldChild=childFacts+";{const fs=require('node:fs'),root=process.cwd().split('/data/')[0],marker=root+'/automatic-check-done';if(!fs.existsSync(marker))fs.writeFileSync(marker,'automatic');else{fs.writeFileSync(root+'/child-entered',JSON.stringify({pid:process.pid,cwd:process.cwd()}));const timer=setInterval(()=>{if(fs.existsSync(root+'/child-release'))clearInterval(timer)},10)}}";
it.each(['source','task','control'] as const)("refuses proof when %s changes while an actual registered child is in flight",async change=>{
 const f=await localReviewFixture({verificationScript:heldChild});let pending:Promise<View>|undefined;
 try{
  const initial=await f.results.read(f.receipt.runId),before=sourceFacts(initial.candidate!.worktree);
  const invoked=f.armSnapshotInvocation('check');pending=f.results.verify(f.receipt.runId,body(initial,'in-flight'),'owner');
  await invoked(pending);
  await vi.waitFor(()=>expect(existsSync(join(f.root,'child-entered'))).toBe(true));
  const entered=JSON.parse(readFileSync(join(f.root,'child-entered'),'utf8'));
  if(change==='source')writeFileSync(join(initial.candidate!.worktree,'result.txt'),'changed during real verification\n');
  else if(change==='task'){
   const task=f.service.database.getCanonicalTask(f.receipt.taskId)!;
   f.service.database.writeCanonicalTask(f.receipt.taskId,task.revision,{...task.document as object,title:'changed during real child'},new Date().toISOString());
  }else{
   const store=new InteractionStore(f.service.database),control=store.control(initial.sessionId)!;
   store.compareAndSwapControl({sessionId:initial.sessionId,expectedRevision:control.revision,expectedEpoch:control.epoch,actorId:'owner',event:{type:'conflict',at:new Date().toISOString()}});
  }
  writeFileSync(join(f.root,'child-release'),'release');const result=await pending,receipt=proof(f);
  record(f,{change,before,after:sourceFacts(initial.candidate!.worktree),entered,result,receipt});
  expect(entered.cwd).not.toBe(initial.candidate!.worktree);expect(receipt.state).toBe('FAILED');expect(receipt.proof).toBeUndefined();
  expect(receipt).toMatchObject({reasonCode:change==='source'?'CANDIDATE_CHANGED':change==='task'?'LOCAL_REVIEW_CONTEXT_CHANGED':'NATIVE_WRITE_LOCKED'});
  expect(result.verification).toBeUndefined();
  await expect(f.results.accept(f.receipt.runId,{...body(initial,'refuse-after-change'),verificationId:receipt.id},'owner')).rejects.toThrow();
  expect(f.service.database.getCanonicalTask(f.receipt.taskId)?.document).toMatchObject({state:'REVIEW'});expect(f.starts()).toBe(1);
 }finally{writeFileSync(join(f.root,'child-release'),'cleanup');await pending;await f.close();}
});

it("cancels and drains the exact real snapshot verifier without proof or another native start",async()=>{
 const f=await localReviewFixture({verificationScript:heldChild});let pending:Promise<View>|undefined;
 try{
  const initial=await f.results.read(f.receipt.runId),invoked=f.armSnapshotInvocation('check');pending=f.results.verify(f.receipt.runId,body(initial,'cancel-child'),'owner');
  await invoked(pending);
  await vi.waitFor(()=>expect(existsSync(join(f.root,'child-entered'))).toBe(true));
  const entered=JSON.parse(readFileSync(join(f.root,'child-entered'),'utf8')),running=await f.results.read(f.receipt.runId);
  expect(running).toMatchObject({state:'running',pendingVerification:{owned:true}});
  const stopped=await f.results.cancel(f.receipt.runId,running.pendingVerification!.id,'owner');await pending;
  let absence:string;try{process.kill(entered.pid,0);absence='alive';}catch(error){absence=(error as NodeJS.ErrnoException).code??'unknown';}
  record(f,{entered,stopped,absence,receipt:proof(f)});
  expect(stopped).toMatchObject({state:'failed',reasonCode:'LOCAL_VERIFICATION_CANCELLED'});expect(absence).toBe('ESRCH');expect(proof(f).proof).toBeUndefined();expect(f.starts()).toBe(1);
 }finally{writeFileSync(join(f.root,'child-release'),'cleanup');await pending;await f.close();}
});
