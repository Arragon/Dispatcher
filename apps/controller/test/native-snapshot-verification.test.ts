import {execFileSync} from "node:child_process";
import {existsSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {backup} from "node:sqlite";
import {DispatcherDatabase,type JsonValue} from "@dispatcher/persistence";
import {VerificationRegistry,type VerificationCommand,type VerificationResult} from "@dispatcher/runner";
import type {Run} from "@dispatcher/domain";
import type {DeliveryCandidate} from "@dispatcher/workspace";
import {nativeSnapshotFixture,remoteSnapshotFixture} from "./fixtures/native-snapshot.js";
type Fixture=Awaited<ReturnType<typeof nativeSnapshotFixture>>;
interface Proof {id:string;state:string;reasonCode?:string;snapshot:DeliveryCandidate;commandIds:string[];checks:unknown[];preparation:{checks:unknown[]}}
const proof=(f:Fixture)=>{const pointer=f.service.database.getEntity("run-snapshot-current",f.run.id) as {id:string}|undefined;return pointer?f.service.database.getEntity("run-snapshot-verification",pointer.id) as unknown as Proof:undefined;};
const source=(f:Fixture)=>({head:execFileSync("git",["-C",f.run.worktree!,"rev-parse","HEAD"]).toString(),index:readFileSync(execFileSync("git",["-C",f.run.worktree!,"rev-parse","--path-format=absolute","--git-path","index"]).toString().trim()).toString("base64"),readme:readFileSync(join(f.run.worktree!,"README.md"),"utf8"),result:readFileSync(join(f.run.worktree!,"result.txt"),"utf8"),env:readFileSync(join(f.run.worktree!,"env.txt"),"utf8")});
it("prepares and verifies only the isolated native HUMAN-return snapshot, atomically clears invalidation and completes to REVIEW",async()=>{
 const f=await nativeSnapshotFixture();try{const before=source(f),response=await f.advance();f.facts({before,after:source(f),response:response.json(),proof:proof(f),children:f.children()});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({run:{state:"COMPLETE",verification:{state:"PASSED",commands:["check"]}},task:{state:"REVIEW"}});const p=proof(f)!;expect(p).toMatchObject({state:"VERIFIED",commandIds:["prepare-0","check"],preparation:{checks:[{commandId:"prepare-0",status:"passed",exitCode:0}]}});expect(f.children().map(c=>c.phase)).toEqual(["prepare-0","check"]);for(const c of f.children())expect([c.cwd,c.pwd,c.top]).toEqual([p.snapshot.path,p.snapshot.path,p.snapshot.path]);expect(f.children()[0]!.env).toBeNull();expect(f.children()[1]!.env).toBe("prepared");expect(source(f)).toEqual(before);expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeUndefined();expect(f.starts()).toBe(1);expect((await f.service.localResults.read(f.run.id)).reasonCode).toBe("LOCAL_REVIEW_UNQUALIFIED");}finally{await f.close();}
});
it.each(["profile","marker"])("refuses missing frozen %s without a child or invalidation clearance",async missing=>{const f=await nativeSnapshotFixture({profile:missing!=="profile"});try{if(missing==="marker")f.service.database.handle.prepare("DELETE FROM entities WHERE kind='run-snapshot-verification-config' AND id=?").run(f.run.id);const response=await f.advance();f.facts({response:response.json(),proof:proof(f)});expect(response.statusCode).toBe(409);expect(response.json().code).toBe("VERIFICATION_ENVIRONMENT_UNAVAILABLE");expect(f.children()).toEqual([]);expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();}finally{await f.close();}});
it.each(["failure","timeout","snapshot","source"])("blocks %s preparation and retains actual occurred results",async mode=>{const f=await nativeSnapshotFixture({preparation:[mode==="failure"?"console.error('token=private-value');process.exit(7)":mode==="timeout"?"setTimeout(()=>{},60000)":mode==="snapshot"?"fs.writeFileSync('README.md','changed')":"fs.writeFileSync(root+'/source-path-mutation','requested');fs.writeFileSync(fs.readFileSync(root+'/source-path','utf8')+'/README.md','changed')"],timeoutMs:mode==="timeout"?100:5000});try{if(mode==="source"){const {writeFileSync}=await import("node:fs");writeFileSync(join(f.root,"source-path"),f.run.worktree!);}const response=await f.advance();f.facts({response:response.json(),proof:proof(f),children:f.children()});expect(response.statusCode).toBe(409);expect(f.children()).toHaveLength(1);expect(f.service.database.listEntities("run-verification-command")).toMatchObject([{state:"SETTLED",result:{commandId:"prepare-0"}}]);expect(proof(f)?.state).not.toBe("VERIFIED");expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();expect(f.starts()).toBe(1);}finally{await f.close();}});

const barrier="fs.writeFileSync(root+'/child-entered','yes');const timer=setInterval(()=>{if(fs.existsSync(root+'/child-release')){clearInterval(timer);process.exit(0);}},5);";
const release=(f:Fixture)=>writeFileSync(join(f.root,"child-release"),"go");
// Cleanup attempts are independent: an unexpected HTTP rejection must not skip the owned close.
async function pendingFixture(f:Fixture,pending:PromiseLike<unknown>,body:()=>Promise<void>):Promise<void>{
 const errors:unknown[]=[];const attempt=async(action:()=>unknown|PromiseLike<unknown>)=>{try{await action();}catch(error){if(!errors.includes(error))errors.push(error);}};
 await attempt(body);await attempt(()=>release(f));await attempt(()=>pending);await attempt(()=>f.close());
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,"Native test body, pending work or cleanup failed");
}
const waitChild=(f:Fixture)=>vi.waitFor(()=>expect(existsSync(join(f.root,"child-entered"))).toBe(true),{timeout:3000});
const save=(f:Fixture,kind:string,id:string,value:unknown)=>f.service.database.saveEntity(kind,id,JSON.parse(JSON.stringify(value)) as JsonValue);
const absent=(pid:number)=>{try{process.kill(pid,0);return false;}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;return true;}};
it.each(["task-physical","task-document","control-physical","control-document","checkpoint","observation-document","binding-physical","binding-document","configuration","preparation-definition","contract","selection","model","policy","generation","lease","source","index","snapshot","proof"] as const)("retains the returned actual check and refuses %s authority drift across a child barrier",async drift=>{
 const f=await nativeSnapshotFixture({check:barrier}),pending=f.advance().then(r=>r);
 await pendingFixture(f,pending,async()=>{await waitChild(f);const db=f.service.database,run=f.run,p=proof(f)!;
  if(drift==="task-physical")db.handle.prepare("UPDATE canonical_tasks SET revision=revision+1 WHERE id=?").run(run.taskId);
  if(drift==="task-document")db.handle.prepare("UPDATE canonical_tasks SET document_json=json_set(document_json,'$.description','changed') WHERE id=?").run(run.taskId);
  if(drift==="control-physical")db.handle.prepare("UPDATE session_controls SET active_run_id='foreign' WHERE session_id=?").run(run.sessionId);
  if(drift==="control-document")db.handle.prepare("UPDATE session_controls SET document_json=json_set(document_json,'$.exclusion','native-enforced') WHERE session_id=?").run(run.sessionId);
  if(drift==="checkpoint")db.handle.prepare("UPDATE native_observation_checkpoints SET observer_sequence=observer_sequence+1 WHERE session_id=?").run(run.sessionId);
  if(drift==="observation-document")db.handle.prepare("UPDATE native_observations SET document_json=json_set(document_json,'$.historyRevision','changed') WHERE id=(SELECT observation_id FROM native_observation_checkpoints WHERE session_id=?)").run(run.sessionId);
  if(drift==="binding-physical")db.handle.prepare("UPDATE native_bindings SET profile_id='foreign' WHERE session_id=?").run(run.sessionId);
  if(drift==="binding-document")db.handle.prepare("UPDATE native_bindings SET document_json=json_set(document_json,'$.nativeStoreRef','foreign') WHERE session_id=?").run(run.sessionId);
  if(drift==="configuration"){const config=f.service.configuration.current().config;config.repositories[0]!.snapshotVerification!.id="changed";await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","fixture").id,{confirmed:true});}
  if(drift==="preparation-definition"){const frozen=db.getEntity("run-verification-config",run.id) as unknown as VerificationCommand[];frozen[0]!.args.push("changed");save(f,"run-verification-config",run.id,frozen);}
  if(drift==="contract"){const contract=db.getTaskContract(run.taskId) as Record<string,JsonValue>;db.saveTaskContract(run.taskId,{...contract,goal:"changed"});}
  if(drift==="selection")db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.executionSelection.nativeParameters.changed',json('true')) WHERE kind='run' AND id=?").run(run.id);
  if(drift==="model")db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.model.id','foreign-model') WHERE kind='run' AND id=?").run(run.id);
  if(drift==="policy"){const policy=db.getEntity("native-drift-policy",run.id) as Record<string,JsonValue>;save(f,"native-drift-policy",run.id,{...policy,policy:{...policy.policy as object,permissionFingerprint:"changed"}});}
  if(drift==="generation"||drift==="lease"){const current=db.getEntity("run",run.id) as unknown as Run;save(f,"run",run.id,{...current,...(drift==="generation"?{generation:2}:{leaseId:"foreign"})});}
  if(drift==="source")writeFileSync(join(run.worktree!,"README.md"),"human changed source");
  if(drift==="index")execFileSync("git",["-C",run.worktree!,"update-index","--assume-unchanged","README.md"]);
  if(drift==="snapshot")writeFileSync(join(p.snapshot.path,"README.md"),"snapshot rewritten");
  if(drift==="proof")save(f,"run-snapshot-verification",p.id,{...p,commandIds:["forged"]});
  release(f);const response=await pending;f.facts({drift,response:response.json(),proof:proof(f),children:f.children(),receipts:db.listEntities("run-verification-command")});expect(response.statusCode,response.body).toBe(409);expect(db.listEntities("run-verification-command")).toHaveLength(2);expect(db.listEntities("run-verification-command")).toEqual(expect.arrayContaining([expect.objectContaining({state:"SETTLED",result:expect.objectContaining({commandId:"prepare-0",status:"passed"})}),expect.objectContaining({state:"SETTLED",result:expect.objectContaining({commandId:"check",status:"passed"})})]));expect(db.getEntity("native-verification-invalidation",run.id)).toBeDefined();expect(proof(f)?.state).not.toBe("VERIFIED");expect(f.starts()).toBe(1);for(const child of f.children())expect(absent(child.pid)).toBe(true);
 });
});
it.each(["SENDING","UNKNOWN","malformed"] as const)("blocks old %s source receipts across candidate keys before allocation or a new child",async state=>{const f=await nativeSnapshotFixture();try{const run=f.run,id="old-source-command",fence=f.interactions.fenceFor(run,"old-source");save(f,"run-verification-command",id,state==="malformed"?{version:1,id,runId:run.id,state:"SETTLED"}:{version:1,id,runId:run.id,generation:run.generation,commandId:"check",semanticsHash:"old",fence,state});const response=await f.advance();f.facts({response:response.json(),receipts:f.service.database.listEntities("run-verification-command")});expect(response.statusCode).toBe(409);expect(response.json().code).toBe("VERIFICATION_OUTCOME_UNKNOWN");expect(f.children()).toEqual([]);expect(existsSync(join(f.root,"data/verification-snapshots"))).toBe(false);expect(proof(f)).toBeUndefined();}finally{await f.close();}});
it("does not substitute an actual old SETTLED source-directory result for prepared snapshot checks",async()=>{const f=await nativeSnapshotFixture();try{const registry=new VerificationRegistry(),command=f.service.configuration.current().config.repositories[0]!.verificationCommands.find(c=>c.id==="check")!;registry.register(command);const result=await registry.run(command.id,f.run.worktree!);const id="labelled-source-settled";save(f,"run-verification-command",id,{version:1,id,runId:f.run.id,generation:f.run.generation,commandId:command.id,fence:f.interactions.fenceFor(f.run,"old-source"),semanticsHash:"labelled-old-source",state:"SETTLED",result});const response=await f.advance();expect(response.statusCode,response.body).toBe(200);expect(f.children().map(c=>c.cwd)).toEqual([f.run.worktree,proof(f)!.snapshot.path,proof(f)!.snapshot.path]);expect(proof(f)?.state).toBe("VERIFIED");}finally{await f.close();}});
it.each(["proof","run","invalidation"] as const)("rolls back %s acceptance failure and reuses exact CAPTURED snapshot and occurred receipts without a second child",async fault=>{
 const f=await nativeSnapshotFixture();const db=f.service.database,original=db.saveEntity.bind(db);const saving=vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{if(fault==="proof"&&args[0]==="run-snapshot-verification"&&(args[2] as {state?:string}).state==="VERIFIED"||fault==="run"&&args[0]==="run"&&(args[2] as {state?:string}).state==="DELIVERING")throw Error(`fixture ${fault} transaction fault`);return original(...args);});
 if(fault==="invalidation")db.handle.exec("CREATE TRIGGER fixture_invalidation_fault BEFORE DELETE ON entities WHEN OLD.kind='native-verification-invalidation' BEGIN SELECT RAISE(ABORT,'fixture invalidation delete fault'); END");
 try{const first=await f.advance(),captured=structuredClone(proof(f));expect(first.statusCode).toBe(500);expect(captured?.state).toBe("CAPTURED");expect(db.getEntity("run",f.run.id)).toMatchObject({state:"VERIFYING",verification:{state:"PENDING"}});expect(db.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();expect(db.listEntities("run-verification-command")).toMatchObject([{state:"SETTLED"},{state:"SETTLED"}]);saving.mockRestore();if(fault==="invalidation")db.handle.exec("DROP TRIGGER fixture_invalidation_fault");
  const path=join(f.root,"persisted-readback.sqlite");await backup(db.handle,path);let readback=new DispatcherDatabase(path);expect(readback.getEntity("run-snapshot-verification",captured!.id)).toMatchObject({state:"CAPTURED"});readback.close();readback=new DispatcherDatabase(path);expect(readback.listEntities("run-verification-command")).toHaveLength(2);readback.close();
  const children=f.children(),retry=await f.advance();f.facts({first:first.json(),captured,retry:retry.json(),proof:proof(f),children:f.children()});expect(retry.statusCode,retry.body).toBe(200);expect(proof(f)?.snapshot.id).toBe(captured?.snapshot.id);expect(f.children()).toEqual(children);expect(proof(f)?.state).toBe("VERIFIED");expect(f.service.database.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state:"REVIEW"});
 }finally{saving.mockRestore();if(fault==="invalidation")db.handle.exec("DROP TRIGGER IF EXISTS fixture_invalidation_fault");await f.close();}
});
it.each([false,true])("keeps explicit empty/overlapping preparation order with required overlap=%s",async overlap=>{const f=await nativeSnapshotFixture(overlap?{requiredPreparation:true}:{preparation:[],check:"if(fs.readFileSync('result.txt','utf8')!=='candidate\\n')process.exit(1)"});try{const response=await f.advance();expect(response.statusCode,response.body).toBe(200);expect(proof(f)?.commandIds).toEqual(overlap?["prepare-0","check"]:["check"]);expect(f.children().map(c=>c.phase)).toEqual(proof(f)?.commandIds);}finally{await f.close();}});
it("strict native snapshot commit authors the verified source and completes to REVIEW",async()=>{
 const f=await nativeSnapshotFixture({delivery:"commit"});
 try{
  const before=source(f),main=execFileSync("git",["-C",f.repo,"rev-parse","main"]).toString(),response=await f.advance();
  expect(response.statusCode,response.body).toBe(200);
  expect(response.json()).toMatchObject({run:{state:"COMPLETE"},task:{state:"REVIEW"}});
  const p=proof(f)!,result=f.service.database.getEntity("run-result",f.run.id) as unknown as {commit:{commit:string;created:boolean;files:string[]}};
  const head=source(f).head.trim();
  expect(result.commit).toMatchObject({commit:head,created:true});
  expect(head).not.toBe(p.snapshot.commit);
  expect(execFileSync("git",["-C",f.run.worktree!,"rev-parse","HEAD^{tree}"]).toString().trim()).toBe(p.snapshot.tree);
  expect(execFileSync("git",["-C",f.run.worktree!,"rev-list","--parents","-n","1","HEAD"]).toString().trim().split(" ")).toEqual([head,before.head.trim()]);
  expect(execFileSync("git",["-C",f.run.worktree!,"status","--porcelain"]).toString()).toBe("");
  expect(execFileSync("git",["-C",f.repo,"rev-parse","main"]).toString()).toBe(main);
  expect(proof(f)?.state).toBe("VERIFIED");
  expect(f.service.database.listEntities("native-snapshot-commit")).toMatchObject([{state:"COMPLETE"}]);
  expect(f.service.database.listEntities("local-git-command")).toMatchObject([{state:"SETTLED"},{state:"SETTLED"}]);
  expect(f.starts()).toBe(1);
  expect(f.service.database.listEntities("native-mutation")).not.toContainEqual(expect.objectContaining({state:"unknown"}));
 }finally{await f.close();}
});
it.each(["run-result","task"] as const)("strict native snapshot commit retries observed commit after %s metadata failure without resending",async target=>{
 const f=await nativeSnapshotFixture({delivery:"commit"}),db=f.service.database;
 try{
  db.handle.exec(target==="run-result"?"CREATE TRIGGER strict_completion_fault BEFORE INSERT ON entities WHEN NEW.kind='run-result' BEGIN SELECT RAISE(ABORT,'strict completion fault'); END":"CREATE TRIGGER strict_completion_fault BEFORE UPDATE ON canonical_tasks WHEN json_extract(NEW.document_json,'$.state')='REVIEW' BEGIN SELECT RAISE(ABORT,'strict completion fault'); END");
  const first=await f.advance();expect(first.statusCode,first.body).toBe(500);
  const authored=source(f).head,commands=structuredClone(db.listEntities("local-git-command"));
  expect(commands).toHaveLength(2);expect(db.listEntities("native-snapshot-commit")).toMatchObject([{state:"COMPLETE"}]);
  expect(db.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING"});
  expect(db.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state:"VERIFYING"});
  expect(db.getEntity("run-result",f.run.id)).toBeUndefined();
  db.handle.exec("DROP TRIGGER strict_completion_fault");
  const response=await f.advance();expect(response.statusCode,response.body).toBe(200);
  expect(response.json()).toMatchObject({run:{state:"COMPLETE"},task:{state:"REVIEW"}});
  expect(source(f).head).toBe(authored);expect(db.listEntities("local-git-command")).toEqual(commands);expect(f.starts()).toBe(1);
 }finally{await f.close();}
});
it("cancels and drains only the owned snapshot child while retaining its returned result and invalidation",async()=>{const f=await nativeSnapshotFixture({check:barrier}),pending=f.advance().then(r=>r);await pendingFixture(f,pending,async()=>{await waitChild(f);const command=f.service["localCommands"].get(f.run.id)!;command.controller.abort();const response=await pending;f.facts({response:response.json(),children:f.children(),proof:proof(f)});expect(response.statusCode).toBe(409);expect(f.service.database.listEntities("run-verification-command")).toHaveLength(2);expect(f.service.database.listEntities("run-verification-command")).toEqual(expect.arrayContaining([expect.objectContaining({state:"SETTLED",result:expect.objectContaining({commandId:"prepare-0",status:"passed"})}),expect.objectContaining({state:"SETTLED",result:expect.objectContaining({commandId:"check",status:"failed"})})]));for(const child of f.children())expect(absent(child.pid)).toBe(true);expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();});});
it("retains failed proof, refuses its same epoch, and permits only a real fresh HUMAN return to supersede known failure",async()=>{const f=await nativeSnapshotFixture({preparation:["if(!fs.existsSync(root+'/allow-prepare'))process.exit(7);if(!fs.existsSync('env.txt'))fs.writeFileSync('env.txt','prepared');"]});try{expect((await f.advance()).statusCode).toBe(409);const failed=structuredClone(proof(f)),children=f.children();writeFileSync(join(f.root,"allow-prepare"),"allowed");expect((await f.advance()).statusCode).toBe(409);expect(f.children()).toEqual(children);expect(proof(f)).toEqual(failed);await f.returnHuman();const response=await f.advance();f.facts({failed,response:response.json(),proof:proof(f),children:f.children()});expect(response.statusCode,response.body).toBe(200);expect(proof(f)!.id).not.toBe(failed!.id);expect(f.service.database.getEntity("run-snapshot-verification",failed!.id)).toEqual(failed);expect(f.starts()).toBe(1);}finally{await f.close();}});
it.each(["result","scope"] as const)("treats malformed SETTLED %s as a cross-candidate barrier",async field=>{const f=await nativeSnapshotFixture();try{const id="old-malformed-settled",fence=f.interactions.fenceFor(f.run,"old-command");save(f,"run-verification-command",id,{version:1,id,runId:f.run.id,generation:f.run.generation,commandId:"check",semanticsHash:"old",fence,state:"SETTLED",result:{commandId:"check",required:true,status:"passed",exitCode:field==="result"?7:0,durationMs:1,output:"",truncated:false},...(field==="scope"?{snapshotScope:{version:1,proofId:"missing"}}:{})});const response=await f.advance();f.facts({response:response.json(),children:f.children()});expect(response.statusCode).toBe(409);expect(response.json().code).toBe("VERIFICATION_OUTCOME_UNKNOWN");expect(f.children()).toEqual([]);expect(proof(f)).toBeUndefined();}finally{await f.close();}});
it("refuses genuinely dispatched remote retained invalidation before remote verify or Controller snapshot/Git work",async()=>{const f=await remoteSnapshotFixture();try{const local=vi.spyOn(f.service["verificationSnapshots"],"createDeliveryCandidate"),files=vi.spyOn(f.service.workspaces,"resultFiles"),response=await f.service.app.inject({method:"POST",url:`/api/runs/${f.run.id}/advance`,headers:f.headers});f.record("refusal-result",response.json());expect(response.statusCode,response.body).toBe(409);expect(response.json().code).toBe("VERIFICATION_ENVIRONMENT_UNAVAILABLE");expect(local).not.toHaveBeenCalled();expect(files).not.toHaveBeenCalled();expect(f.observations).not.toContainEqual(expect.objectContaining({kind:"remote-command",value:expect.objectContaining({payload:expect.objectContaining({type:"native.run_verify"})})}));expect(existsSync(join(f.root,"controller/verification-snapshots"))).toBe(false);expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();expect(f.starts()).toBe(1);}finally{await f.close();}});
it("refuses HUMAN PR delivery without a commit/push/PR and preserves the owned bare refs",async()=>{const f=await nativeSnapshotFixture({delivery:"pull-request"});try{const bare=join(f.root,"bare.git"),refs=()=>execFileSync("git",["--git-dir",bare,"show-ref"]).toString(),before=refs(),head=source(f),push=vi.spyOn(f.service["localGitDelivery"],"push"),response=await f.advance();f.facts({before,after:refs(),response:response.json(),proof:proof(f)});expect(response.statusCode,response.body).toBe(409);expect(response.json().code).toBe("VERIFIED_DELIVERY_UNAVAILABLE");expect(push).not.toHaveBeenCalled();expect(refs()).toBe(before);expect(source(f)).toEqual(head);expect(proof(f)?.state).toBe("VERIFIED");expect(f.service.database.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING"});expect(f.service.database.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state:"VERIFYING"});}finally{await f.close();}});
it("refuses an exact invalidation changed by an acceptance write and rolls the full transaction back",async()=>{const f=await nativeSnapshotFixture(),db=f.service.database,original=db.saveEntity.bind(db);const fault=vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{const result=original(...args);if(args[0]==="run"&&(args[2] as {state?:string}).state==="DELIVERING"){const invalidation=db.getEntity("native-verification-invalidation",f.run.id) as Record<string,JsonValue>;original("native-verification-invalidation",f.run.id,{...invalidation,observationRef:"foreign-invalidation"});}return result;});try{const response=await f.advance();f.facts({response:response.json(),proof:proof(f),invalidation:db.getEntity("native-verification-invalidation",f.run.id)});expect(response.statusCode,response.body).toBe(409);expect(proof(f)?.state).toBe("CAPTURED");expect(db.getEntity("run",f.run.id)).toMatchObject({state:"VERIFYING",verification:{state:"PENDING"}});expect(db.getEntity("native-verification-invalidation",f.run.id)).not.toMatchObject({observationRef:"foreign-invalidation"});expect(db.listEntities("run-verification-command")).toHaveLength(2);}finally{fault.mockRestore();await f.close();}});
it("does not overwrite a changed original SENDING row when its real child result cannot be recorded",async()=>{const f=await nativeSnapshotFixture({check:barrier}),pending=f.advance().then(r=>r);let changed:unknown;await pendingFixture(f,pending,async()=>{await waitChild(f);const receipt=(f.service.database.listEntities("run-verification-command") as unknown as Array<{id:string;commandId:string}>).find(r=>r.commandId==="check")!;changed={...receipt,semanticsHash:"out-of-band-authority"};save(f,"run-verification-command",receipt.id,changed);release(f);const response=await pending;f.facts({response:response.json(),changed,proof:proof(f),children:f.children(),receipt:f.service.database.getEntity("run-verification-command",receipt.id)});expect(response.statusCode).toBe(409);expect(f.service.database.getEntity("run-verification-command",receipt.id)).toEqual(changed);expect(proof(f)?.state).toBe("UNKNOWN");expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();});});
it("keeps a result-persistence failure UNKNOWN and refuses every retry without another child",async()=>{const f=await nativeSnapshotFixture(),db=f.service.database,original=db.saveEntity.bind(db);let first=true;const fault=vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{if(first&&args[0]==="run-verification-command"&&(args[2] as {state?:string}).state==="SETTLED"){first=false;throw Error("fixture result persistence failure");}return original(...args);});try{expect((await f.advance()).statusCode).toBe(500);fault.mockRestore();const prior=structuredClone(proof(f)),children=f.children();expect(prior?.state).toBe("UNKNOWN");expect(db.listEntities("run-verification-command")).toMatchObject([{state:"UNKNOWN"}]);expect((await f.advance()).statusCode).toBe(409);expect(f.children()).toEqual(children);expect(proof(f)).toEqual(prior);expect(db.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();}finally{fault.mockRestore();await f.close();}});
it.each(["checks-missing","check-id","check-required","check-status","check-exit","command-order","preparation-check","definitions"] as const)("never uses %s persisted VERIFIED evidence and records no uncertain send for this known preflight refusal",async damage=>{const f=await nativeSnapshotFixture({delivery:"pull-request"});try{expect((await f.advance()).json().code).toBe("VERIFIED_DELIVERY_UNAVAILABLE");const p=proof(f)! as Proof&{verification:VerificationCommand[];checks:VerificationResult[];preparation:{checks:VerificationResult[]}};if(damage==="checks-missing")p.checks=[];if(damage==="check-id")p.checks[1]!.commandId="foreign";if(damage==="check-required")p.checks[1]!.required=false;if(damage==="check-status")p.checks[1]!.status="failed";if(damage==="check-exit")p.checks[1]!.exitCode=7;if(damage==="command-order")p.commandIds.reverse();if(damage==="preparation-check")p.preparation.checks[0]!.output="changed";if(damage==="definitions")p.verification[0]!.args.push("changed");save(f,"run-snapshot-verification",p.id,p);const children=f.children(),response=await f.advance();f.facts({damage,response:response.json(),proof:proof(f)});expect(response.statusCode).toBe(409);expect(f.children()).toEqual(children);expect(f.service.database.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING"});expect(f.service.database.listEntities("native-mutation")).not.toContainEqual(expect.objectContaining({state:"unknown"}));}finally{await f.close();}});
it("rechecks registered repository scope independently of the broad Task scope before allocation",async()=>{const f=await nativeSnapshotFixture();try{const config=f.service.configuration.current().config;config.repositories[0]!.scopePaths=["README.md",".gitignore"];await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","fixture").id,{confirmed:true});const response=await f.advance();expect(response.statusCode).toBe(409);expect(response.json().code).toBe("PATH_OUT_OF_SCOPE");expect(f.children()).toEqual([]);expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();}finally{await f.close();}});
it("real canonical cancellation drains the owned child while unsupported native physical stop remains refused",async()=>{const f=await nativeSnapshotFixture({check:barrier}),pending=f.advance().then(r=>r);await pendingFixture(f,pending,async()=>{await waitChild(f);const cancelled=f.service.semanticTools.execute("run.cancel",{target:f.run.id},{principal:{id:"owner",roles:["operator"],channel:"api"},workflowId:"owned-native-snapshot-cancel",confirmed:true}).catch(error=>error);const response=await pending,outcome=await cancelled;f.facts({response:response.json(),outcome:{code:outcome.code,message:outcome.message},children:f.children(),proof:proof(f)});expect(response.statusCode).toBe(409);expect(outcome).toBeInstanceOf(Error);for(const child of f.children())expect(absent(child.pid)).toBe(true);expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();expect(f.nativeCalls).not.toContain("turn/interrupt");expect(f.starts()).toBe(1);});});
it("does not invent an observation age expiry while its challenged checkpoint and live lease remain current",async()=>{const f=await nativeSnapshotFixture({check:barrier}),pending=f.advance().then(r=>r);await pendingFixture(f,pending,async()=>{await waitChild(f);const future=Date.now()+31_000;f.service.options.clock=()=>new Date(future);release(f);const response=await pending;f.facts({response:response.json(),proof:proof(f)});expect(response.statusCode,response.body).toBe(200);expect(proof(f)?.state).toBe("VERIFIED");});});
it("always closes an owned fixture and retains primary, pending and cleanup errors together",async()=>{const f=await nativeSnapshotFixture(),actual=f.advance().then(r=>r),pending=actual.then(()=>{throw Error("fixture pending rejection");}),close=f.close;f.close=async()=>{await close();throw Error("fixture cleanup diagnostic");};const outcome=await pendingFixture(f,pending,async()=>{throw Error("fixture primary assertion");}).catch(error=>error);f.record("teardown-probe-aggregate",{errors:outcome.errors.map((error:Error)=>({name:error.name,message:error.message}))});expect(outcome).toBeInstanceOf(AggregateError);expect(outcome.errors.map((error:Error)=>error.message)).toEqual(["fixture primary assertion","fixture pending rejection","fixture cleanup diagnostic"]);expect(existsSync(f.root)).toBe(false);});
it("rolls back a synchronous Task write after the acceptance writes through the final full basis fence",async()=>{const f=await nativeSnapshotFixture(),db=f.service.database,original=db.saveEntity.bind(db);const fault=vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{const result=original(...args);if(args[0]==="run"&&(args[2] as {state?:string}).state==="DELIVERING")db.handle.prepare("UPDATE canonical_tasks SET document_json=json_set(document_json,'$.description','transaction-drift') WHERE id=?").run(f.run.taskId);return result;});try{const response=await f.advance();f.facts({response:response.json(),proof:proof(f),task:db.getCanonicalTask(f.run.taskId),invalidation:db.getEntity("native-verification-invalidation",f.run.id)});expect(response.statusCode).toBe(409);expect(proof(f)?.state).toBe("CAPTURED");expect(db.getEntity("run",f.run.id)).toMatchObject({state:"VERIFYING",verification:{state:"PENDING"}});expect(db.getCanonicalTask(f.run.taskId)?.document).not.toMatchObject({description:"transaction-drift"});expect(db.getEntity("native-verification-invalidation",f.run.id)).toBeDefined();expect(db.listEntities("run-verification-command")).toHaveLength(2);}finally{fault.mockRestore();await f.close();}});


// Fix1: these failures occur after snapshot verification and send no native delivery.
async function completionFailureFixture(f: Fixture, body: () => Promise<void>, cleanup: () => void) {
 const errors: unknown[] = [];
 for (const action of [body, cleanup, () => f.close()]) {
  try { await action(); } catch (error) { errors.push(error); }
 }
 if (errors.length === 1) throw errors[0];
 if (errors.length) throw new AggregateError(errors, "Completion failure assertion or cleanup failed", {cause: errors[0]});
}

async function completionFailureHandoff(f: Fixture, commandId: string) {
 const run = f.service.database.getEntity("run", f.run.id) as unknown as Run;
 const principal = {id: "owner", roles: ["operator"], profileId: run.profileId};
 const observed = f.store.observation(run.sessionId)!;
 const receipt = f.interactions.requestHandoff({principal, fence: f.interactions.fenceFor(run, commandId), settlePolicy: "wait"});
 const requestId = `${commandId}:fake-source-read`;
 const observation = {...observed, id: requestId, observedAt: new Date().toISOString(), read: {...observed.read!, requestId, sequence: observed.read!.sequence + 1}};
 const read = f.store.saveObservation({sessionId: run.sessionId, observerGeneration: observation.read.observerGeneration, observerSequence: observation.read.sequence, controlEpoch: f.store.control(run.sessionId)!.epoch, observation, readBarrier: f.store.nativeReadBarrier(run.sessionId)!});
 f.record("fix1-labelled-fake-source-handoff-read", {observation, read});
 const handoff = await f.interactions.advanceHandoff(principal, commandId);
 f.record("fix1-real-completion-failure-handoff", {receipt, handoff});
 return {receipt, read, handoff};
}

it.each(["manifest-error", "manifest-source", "completion-metadata"] as const)("settles known no-send %s after VERIFIED proof and permits the real handoff drain", async fault => {
 const f = await nativeSnapshotFixture();
 const db = f.service.database;
 const commit = vi.spyOn(f.service["localGitDelivery"], "commit");
 const push = vi.spyOn(f.service["localGitDelivery"], "push");
 const resultFiles = f.service.workspaces.resultFiles.bind(f.service.workspaces);
 const manifest = vi.spyOn(f.service.workspaces, "resultFiles").mockImplementation(async workspace => {
  expect(proof(f)?.state).toBe("VERIFIED");
  if (fault === "manifest-error") throw Error("fixture resultFiles rejection after VERIFIED");
  const files = await resultFiles(workspace);
  if (fault === "manifest-source") writeFileSync(join(workspace.path, "result.txt"), "manifest source drift\n");
  return files;
 });
 await completionFailureFixture(f, async () => {
  if (fault === "completion-metadata") db.handle.exec("CREATE TRIGGER fix1_completion_fault BEFORE INSERT ON entities WHEN NEW.kind='run-result' BEGIN SELECT RAISE(ABORT,'fixture completion metadata fault'); END");
  const before = source(f), nativeBefore = [...f.nativeCalls];
  const response = await f.advance();
  const stored = db.getEntity("run", f.run.id), task = db.getCanonicalTask(f.run.taskId), verified = structuredClone(proof(f));
  const receipts = db.listEntities("run-verification-command"), mutations = db.listEntities("native-mutation");
  const handoff = await completionFailureHandoff(f, `fix1-${fault}`);
  f.facts({fault, response: response.json(), stored, task, proof: verified, receipts, mutations, handoff, before, after: source(f), children: f.children(), nativeBefore, nativeAfter: f.nativeCalls, deliveryCalls: {commit: commit.mock.calls.length, push: push.mock.calls.length}});
  expect(response.statusCode, response.body).toBe(fault === "manifest-source" ? 409 : 500);
  expect(verified?.state).toBe("VERIFIED");
  expect(stored).toMatchObject({state: "DELIVERING", verification: {state: "PASSED"}});
  expect(task?.document).toMatchObject({state: "VERIFYING"});
  expect(db.getEntity("run-result", f.run.id)).toBeUndefined();
  expect(receipts).toHaveLength(2);
  expect(receipts).toEqual(expect.arrayContaining([expect.objectContaining({commandId: "prepare-0", state: "SETTLED"}), expect.objectContaining({commandId: "check", state: "SETTLED"})]));
  expect(f.children().map(child => child.phase)).toEqual(["prepare-0", "check"]);
  expect(f.nativeCalls).toEqual(nativeBefore);
  expect(f.starts()).toBe(1);
  expect(commit).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(source(f).head).toBe(before.head);
  expect(source(f).index).toBe(before.index);
  expect(mutations).not.toContainEqual(expect.objectContaining({state: "unknown"}));
  expect(handoff.read.accepted).toBe(true);
  expect(handoff.handoff).toMatchObject({phase: "awaiting-release", drain: "settled"});
 }, () => {
  manifest.mockRestore();
  commit.mockRestore();
  push.mockRestore();
  db.handle.exec("DROP TRIGGER IF EXISTS fix1_completion_fault");
 });
});

it.each(["SENDING", "UNKNOWN", "malformed", "native-unknown"] as const)("preserves the genuine %s barrier during a known no-send manifest failure", async barrier => {
 const f = await nativeSnapshotFixture();
 const db = f.service.database;
 let prior: unknown;
 const manifest = vi.spyOn(f.service.workspaces, "resultFiles").mockImplementation(async () => {
  expect(proof(f)?.state).toBe("VERIFIED");
  prior = barrier === "native-unknown"
   ? {id: "fix1-prior-native-unknown", sessionId: f.run.sessionId, state: "unknown"}
   : barrier === "malformed" ? {version: 1, id: "fix1-prior-command", runId: f.run.id, state: "SETTLED"}
   : {version: 1, id: "fix1-prior-command", runId: f.run.id, generation: f.run.generation, commandId: "check", semanticsHash: "fixture-prior-unreconciled", fence: f.interactions.fenceFor(f.run, "fix1-prior-command"), state: barrier};
  save(f, barrier === "native-unknown" ? "native-mutation" : "run-verification-command", barrier === "native-unknown" ? "fix1-prior-native-unknown" : "fix1-prior-command", prior);
  throw Error("fixture manifest rejection with retained prior uncertainty");
 });
 await completionFailureFixture(f, async () => {
  const response = await f.advance();
  const stored = db.getEntity("run", f.run.id), verified = structuredClone(proof(f));
  const mutations = db.listEntities("native-mutation");
  const handoff = await completionFailureHandoff(f, `fix1-barrier-${barrier}`);
  f.facts({barrier, prior, response: response.json(), stored, proof: verified, mutations, handoff, children: f.children()});
  expect(response.statusCode).toBe(500);
  expect(verified?.state).toBe("VERIFIED");
  expect(stored).toMatchObject({state: "DELIVERING", verification: {state: "PASSED"}});
  expect(db.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state: "VERIFYING"});
  expect(db.getEntity(barrier === "native-unknown" ? "native-mutation" : "run-verification-command", barrier === "native-unknown" ? "fix1-prior-native-unknown" : "fix1-prior-command")).toEqual(prior);
  expect(mutations).toContainEqual(expect.objectContaining({state: "unknown"}));
  expect(handoff.handoff).toMatchObject({phase: "conflict", drain: "unknown", code: "INFLIGHT_OUTCOME_UNKNOWN"});
  expect(f.children()).toHaveLength(2);
  expect(f.starts()).toBe(1);
 }, () => manifest.mockRestore());
});

// G2c starts each second cycle from an actually accepted first proof.
async function deliveringCycle(delivery:"none"|"commit"|"pull-request"="pull-request",options:Parameters<typeof nativeSnapshotFixture>[0]={}){
 const f=await nativeSnapshotFixture({...options,delivery});
 try{
  // Stage the actual native result, so HUMAN changes a tracked candidate without a new commit.
  execFileSync("git",["-C",f.run.worktree!,"add","result.txt"]);
  if(delivery!=="pull-request")f.service.database.handle.exec("CREATE TRIGGER g2c_initial_completion BEFORE INSERT ON entities WHEN NEW.kind='run-result' BEGIN SELECT RAISE(ABORT,'g2c initial completion fault'); END");
  const first=await f.advance();
  if(delivery!=="pull-request"){expect(first.statusCode,first.body).toBe(500);f.service.database.handle.exec("DROP TRIGGER g2c_initial_completion");}
  else expect(first.json().code).toBe("VERIFIED_DELIVERY_UNAVAILABLE");
  expect(f.service.database.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING",verification:{state:"PASSED"}});
  expect(proof(f)?.state).toBe("VERIFIED");expect(f.children()).toHaveLength(2);
  f.record("g2c-first-delivering",{run:f.service.database.getEntity("run",f.run.id),proof:proof(f),source:source(f),children:f.children()});
  return f;
 }catch(error){await f.close();throw error;}
}
const cycleState=(f:Fixture)=>({run:f.service.database.getEntity("run",f.run.id),actions:f.service.database.listEntities("native-reclaim-action"),invalidation:f.service.database.getEntity("native-verification-invalidation",f.run.id),pointer:f.service.database.getEntity("run-snapshot-current",f.run.id),proofs:f.service.database.listEntities("run-snapshot-verification"),returns:f.service.database.listEntities("native-reclaim"),children:f.children(),native:[...f.nativeCalls],source:source(f)});
it.each(["none","commit","pull-request"] as const)("re-verifies a genuine %s delivery after explicit HUMAN edits with fresh snapshot commands",async delivery=>{
 const f=await deliveringCycle(delivery);try{
  const old=structuredClone(proof(f))!,receipts=structuredClone(f.service.database.listEntities("run-verification-command")) as unknown as {id:string}[],before=source(f),native=[...f.nativeCalls],bare=delivery==="pull-request"?execFileSync("git",["--git-dir",join(f.root,"bare.git"),"show-ref"]).toString():undefined;
  const commit=vi.spyOn(f.service["localGitDelivery"],"commit"),push=vi.spyOn(f.service["localGitDelivery"],"push");
  await f.returnHuman({duringHuman:()=>{expect(f.store.control(f.run.sessionId)?.state).toBe("HUMAN");writeFileSync(join(f.run.worktree!,"result.txt"),"human second candidate\n");}});
  const invalidation=f.service.database.getEntity("native-verification-invalidation",f.run.id),response=await f.advance(),fresh=proof(f)!;
  f.facts({delivery,before,old,invalidation,response:response.json(),fresh,state:cycleState(f)});
  expect(response.statusCode,response.body).toBe(delivery==="pull-request"?409:200);
  if(delivery==="pull-request")expect(response.json().code).toBe("VERIFIED_DELIVERY_UNAVAILABLE");
  expect(fresh.id).not.toBe(old.id);expect(fresh.snapshot.id).not.toBe(old.snapshot.id);expect(fresh.state).toBe("VERIFIED");
  expect((fresh as unknown as {basis:{controlEpoch:number}}).basis.controlEpoch).toBeGreaterThan((old as unknown as {basis:{controlEpoch:number}}).basis.controlEpoch);
  expect(readFileSync(join(fresh.snapshot.path,"result.txt"),"utf8")).toBe("human second candidate\n");
  expect(f.service.database.getEntity("run-snapshot-verification",old.id)).toEqual(old);
  for(const receipt of receipts)expect(f.service.database.getEntity("run-verification-command",receipt.id)).toEqual(receipt);
  expect(f.children().map(c=>c.phase)).toEqual(["prepare-0","check","prepare-0","check"]);
  for(const c of f.children().slice(2))expect([c.cwd,c.pwd,c.top]).toEqual([fresh.snapshot.path,fresh.snapshot.path,fresh.snapshot.path]);
  expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toBeUndefined();
  expect(f.nativeCalls).toEqual(native);expect(f.starts()).toBe(1);expect(native.filter(x=>x==="initialize")).toHaveLength(1);expect(native.filter(x=>x==="thread/start")).toHaveLength(1);expect(native.filter(x=>x==="turn/start")).toHaveLength(1);
  if(delivery==="commit"){
   const after=source(f);expect(after.result).toBe("human second candidate\n");expect(after.head).not.toBe(before.head);
   expect(execFileSync("git",["-C",f.run.worktree!,"rev-parse","HEAD^"]).toString()).toBe(before.head);
   expect(f.service.database.listEntities("native-snapshot-commit")).toHaveLength(2);
   expect(f.service.database.listEntities("local-git-command")).toHaveLength(4);
  }else expect(source(f)).toEqual({...before,result:"human second candidate\n"});
  expect(commit).not.toHaveBeenCalled();expect(push).not.toHaveBeenCalled();
  if(bare)expect(execFileSync("git",["--git-dir",join(f.root,"bare.git"),"show-ref"]).toString()).toBe(bare);
  expect(f.service.database.getEntity("run",f.run.id)).toMatchObject({state:delivery!=="pull-request"?"COMPLETE":"DELIVERING",verification:{state:"PASSED"}});
  expect(f.service.database.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state:delivery!=="pull-request"?"REVIEW":"VERIFYING"});
 }finally{await f.close();}
});

it.each(["continue","missing","duplicate","consumed","action-version","action-session","action-epoch","action-observation","action-command","action-report","action-shape","action-run","record","record-policy","record-policy-changed","record-control","record-binding","invalidation-version","invalidation-run","invalidation-session","invalidation-epoch","invalidation-observation","invalidation-code"] as const)("refuses delivery reentry with %s without consuming authority or sending work",async damage=>{
 const f=await deliveringCycle();try{
  await f.returnHuman({action:damage==="continue"?"continue":"verify"});
  const db=f.service.database,id="reclaim-2",action=db.getEntity("native-reclaim-action",id) as Record<string,JsonValue>;
  if(damage==="missing")db.handle.prepare("DELETE FROM entities WHERE kind='native-reclaim-action' AND id=?").run(id);
  if(damage==="duplicate")save(f,"native-reclaim-action","duplicate",{...action,commandId:"duplicate"});
  if(damage==="consumed")save(f,"native-reclaim-action",id,{...action,state:"consumed"});
  const actionFields:Record<string,object>={"action-version":{version:2},"action-run":{runId:"foreign"},"action-shape":{state:null,reportId:null},"action-session":{sessionId:"foreign"},"action-epoch":{controlEpoch:0},"action-observation":{observationRef:"foreign"},"action-command":{commandId:"foreign"},"action-report":{reportId:"foreign"}};
  if(actionFields[damage])save(f,"native-reclaim-action",id,{...action,...actionFields[damage]});
  if(damage==="record")db.handle.prepare("DELETE FROM entities WHERE kind='native-reclaim' AND id=?").run(id);
  if(damage==="record-policy")db.handle.prepare("UPDATE entities SET document_json=json_remove(document_json,'$.driftPolicy') WHERE kind='native-reclaim' AND id=?").run(id);
  if(damage==="record-policy-changed")db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.driftPolicy.permissionFingerprint','foreign') WHERE kind='native-reclaim' AND id=?").run(id);
  if(damage==="record-control")db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.commit.control.revision',999) WHERE kind='native-reclaim' AND id=?").run(id);
  if(damage==="record-binding")db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.binding.nativeSessionId','foreign') WHERE kind='native-reclaim' AND id=?").run(id);
  const invalidation=db.getEntity("native-verification-invalidation",f.run.id) as Record<string,JsonValue>,fields:Record<string,object>={"invalidation-version":{version:2},"invalidation-run":{runId:"foreign"},"invalidation-session":{sessionId:"foreign"},"invalidation-epoch":{controlEpoch:0},"invalidation-observation":{observationRef:"foreign"},"invalidation-code":{code:"foreign"}};
  if(fields[damage])save(f,"native-verification-invalidation",f.run.id,{...invalidation,...fields[damage]});
  const before=cycleState(f),response=await f.advance();f.facts({damage,before,response:response.json(),after:cycleState(f)});
  expect(response.statusCode,response.body).toBe(409);expect(cycleState(f)).toEqual(before);
  expect(db.listEntities("native-mutation")).not.toContainEqual(expect.objectContaining({state:"unknown"}));
 }finally{await f.close();}
});
it.each(["task-physical","task-document","control-physical","control-document","checkpoint","binding-physical","binding-document","configuration","frozen-commands","policy","lease-expiry","lease-revocation"] as const)("retains delivery PASSED and explicit verify choice when %s authority rejects reentry",async drift=>{
 const f=await deliveringCycle();try{
  await f.returnHuman();const db=f.service.database,run=f.run;
  if(drift==="task-physical")db.handle.prepare("UPDATE canonical_tasks SET revision=revision+1 WHERE id=?").run(run.taskId);
  if(drift==="task-document")db.handle.prepare("UPDATE canonical_tasks SET document_json=json_set(document_json,'$.id','foreign') WHERE id=?").run(run.taskId);
  if(drift==="control-physical")db.handle.prepare("UPDATE session_controls SET active_run_id='foreign' WHERE session_id=?").run(run.sessionId);
  if(drift==="control-document")db.handle.prepare("UPDATE session_controls SET document_json=json_set(document_json,'$.exclusion','native-enforced') WHERE session_id=?").run(run.sessionId);
  if(drift==="checkpoint")db.handle.prepare("UPDATE native_observation_checkpoints SET observer_sequence=observer_sequence+1 WHERE session_id=?").run(run.sessionId);
  if(drift==="binding-physical")db.handle.prepare("UPDATE native_bindings SET profile_id='foreign' WHERE session_id=?").run(run.sessionId);
  if(drift==="binding-document")db.handle.prepare("UPDATE native_bindings SET document_json=json_set(document_json,'$.nativeStoreRef','foreign') WHERE session_id=?").run(run.sessionId);
  if(drift==="configuration"){const config=f.service.configuration.current().config;config.repositories[0]!.snapshotVerification!.id="changed";await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","fixture").id,{confirmed:true});}
  if(drift==="frozen-commands"){const frozen=db.getEntity("run-verification-config",run.id) as unknown as VerificationCommand[];frozen[0]!.args.push("changed");save(f,"run-verification-config",run.id,frozen);}
  if(drift==="policy"){const policy=db.getEntity("native-drift-policy",run.id) as Record<string,JsonValue>;save(f,"native-drift-policy",run.id,{...policy,policy:{...policy.policy as object,permissionFingerprint:"changed"}});}
  if(drift==="lease-expiry"){const current=db.getEntity("run",run.id) as unknown as Run;f.service.options.clock=()=>new Date(Date.parse(current.leaseExpiresAt!)+1);}
  if(drift==="lease-revocation")f.service["leaseAuthority"].revoke(run.id,run.leaseId,run.generation,"fixture reentry revocation",new Date().toISOString());
  const before=cycleState(f),response=await f.advance();f.facts({drift,before,response:response.json(),after:cycleState(f)});
  expect(response.statusCode,response.body).toBe(409);expect(cycleState(f)).toEqual(before);
  expect(db.getEntity("run",run.id)).toMatchObject({state:"DELIVERING",verification:{state:"PASSED"}});
 }finally{await f.close();}
});
it.each(["SENDING","UNKNOWN","malformed","native-unknown","native-active","native-malformed","native-id-mismatch"] as const)("does not bypass a labelled old %s barrier after a second actual HUMAN return",async barrier=>{
 const f=await deliveringCycle();try{
  await f.returnHuman();const id="g2c-old-uncertainty",kind=barrier.startsWith("native-")?"native-mutation":"run-verification-command";
  const prior=barrier.startsWith("native-")?{id:barrier==="native-id-mismatch"?"foreign-document":id,sessionId:f.run.sessionId,...(barrier==="native-malformed"?{}:{state:barrier==="native-id-mismatch"?"settled":barrier==="native-unknown"?"unknown":"active"})}:barrier==="malformed"?{version:1,id,runId:f.run.id,state:"SETTLED"}:{version:1,id,runId:f.run.id,generation:f.run.generation,commandId:"check",semanticsHash:"labelled-old-proof",fence:f.interactions.fenceFor(f.run,id),state:barrier};
  save(f,kind,id,prior);const before=cycleState(f),response=await f.advance();f.facts({barrier,prior,before,response:response.json(),after:cycleState(f)});
  expect(response.statusCode,response.body).toBe(409);if(barrier.startsWith("native-"))expect(response.json().code).toBe("NATIVE_COMMAND_OUTCOME_UNKNOWN");expect(cycleState(f)).toEqual(before);expect(f.service.database.getEntity(kind,id)).toEqual(prior);
 }finally{await f.close();}
});
it.each(["run-write","action-write","action-ignored","return-during-consume","task-during-consume","control-during-consume"] as const)("rolls back %s atomically and retries the same explicit choice once without duplicate children",async fault=>{
 const f=await deliveringCycle("pull-request");try{
  await f.returnHuman({duringHuman:()=>writeFileSync(join(f.run.worktree!,"result.txt"),"rollback retry candidate\n")});const db=f.service.database,before=cycleState(f);
  const condition=fault==="run-write"?"NEW.kind='run' AND json_extract(NEW.document_json,'$.state')='VERIFYING'":"NEW.kind='native-reclaim-action' AND json_extract(NEW.document_json,'$.state')='consumed'";
  const effect=fault==="return-during-consume"?"UPDATE entities SET document_json=json_set(document_json,'$.commit.reportId','foreign') WHERE kind='native-reclaim' AND id='reclaim-2';":fault==="action-ignored"?"SELECT RAISE(IGNORE);":fault==="task-during-consume"?"UPDATE canonical_tasks SET document_json=json_set(document_json,'$.id','foreign');":fault==="control-during-consume"?"UPDATE session_controls SET revision=revision+1;":"SELECT RAISE(ABORT,'g2c transactional write fault');";
  db.handle.exec(`CREATE TRIGGER g2c_reentry_fault ${fault.endsWith("during-consume")?"AFTER UPDATE":fault==="action-ignored"?"BEFORE UPDATE":"BEFORE INSERT"} ON entities WHEN ${condition} BEGIN ${effect} END`);
  const rejected=await f.advance();expect(rejected.statusCode,rejected.body).toBe(fault.endsWith("during-consume")||fault==="action-ignored"?409:500);expect(cycleState(f)).toEqual(before);
  expect(db.listEntities("native-mutation")).not.toContainEqual(expect.objectContaining({state:"unknown"}));
  db.handle.exec("DROP TRIGGER g2c_reentry_fault");const retry=await f.advance();f.facts({fault,before,rejected:rejected.json(),retry:retry.json(),after:cycleState(f)});
  expect(retry.json().code).toBe("VERIFIED_DELIVERY_UNAVAILABLE");expect(f.children()).toHaveLength(4);expect(proof(f)!.id).not.toBe((before.pointer as unknown as {id:string}).id);
  const children=f.children(),again=await f.advance();expect(again.json().code).toBe("VERIFIED_DELIVERY_UNAVAILABLE");expect(f.children()).toEqual(children);
 }finally{f.service.database.handle.exec("DROP TRIGGER IF EXISTS g2c_reentry_fault");await f.close();}
});
it.each(["preparation","verification"] as const)("a failing new %s cannot retain operative old PASSED authority",async phase=>{
 const fail="if(fs.existsSync(root+'/fail-second'))process.exit(7);",prepare="if(!fs.existsSync('env.txt'))fs.writeFileSync('env.txt','prepared');",f=await deliveringCycle("pull-request",phase==="preparation"?{preparation:[fail+prepare]}:{check:fail+"if(fs.readFileSync('env.txt','utf8')!=='prepared')process.exit(9);"});
 try{
  const old=structuredClone(proof(f))!;await f.returnHuman({duringHuman:()=>{writeFileSync(join(f.root,"fail-second"),"fail");writeFileSync(join(f.run.worktree!,"result.txt"),"failing HUMAN candidate\n");}});
  const invalidation=f.service.database.getEntity("native-verification-invalidation",f.run.id),response=await f.advance();f.facts({phase,old,invalidation,response:response.json(),after:cycleState(f)});
  expect(response.statusCode).toBe(409);expect(f.service.database.getEntity("run",f.run.id)).toMatchObject({state:"VERIFYING",verification:{state:"PENDING",commands:["check"]}});
  expect((f.service.database.getEntity("run",f.run.id) as unknown as Run).verification.summary).toBeUndefined();expect(proof(f)?.state).toBe("FAILED");expect(proof(f)?.id).not.toBe(old.id);
  expect(f.service.database.getEntity("run-snapshot-verification",old.id)).toEqual(old);expect(f.service.database.getEntity("native-verification-invalidation",f.run.id)).toEqual(invalidation);
  expect(f.children()).toHaveLength(phase==="preparation"?3:4);expect(f.service.database.listEntities("run-verification-command")).toEqual(expect.arrayContaining([expect.objectContaining({state:"SETTLED",result:expect.objectContaining({status:"failed",exitCode:7})})]));
 }finally{await f.close();}
});

it.each(["missing","id","session","state"] as const)("refuses an actual owned mutation marker %s fault before delivery reentry",async fault=>{
 const f=await deliveringCycle();try{
  await f.returnHuman();const db=f.service.database,before=cycleState(f),original=db.saveEntity.bind(db);let injected=false;
  const saving=vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{
   const result=original(...args),marker=args[2] as {state?:string};
   if(!injected&&args[0]==="native-mutation"&&marker.state==="active"){
    injected=true;f.record("g2c-owned-marker-fault",{fault,id:args[1],before:args[2]});
    if(fault==="missing")db.handle.prepare("DELETE FROM entities WHERE kind='native-mutation' AND id=?").run(args[1]);
    else db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,?,?) WHERE kind='native-mutation' AND id=?").run(fault==="id"?"$.id":fault==="session"?"$.sessionId":"$.state",fault==="state"?"unknown":"foreign",args[1]);
   }
   return result;
  });
  try{const response=await f.advance();f.facts({fault,injected,before,response:response.json(),after:cycleState(f)});expect(injected).toBe(true);expect(response.json().code).toBe("MUTATION_LANE_REQUIRED");expect(cycleState(f)).toEqual(before);expect(db.listEntities("native-mutation")).not.toContainEqual(expect.objectContaining({state:"unknown"}));}
  finally{saving.mockRestore();}
 }finally{await f.close();}
});


it.each(["prior-unknown", "returned-policy"] as const)(
 "pins actual return before initial snapshot verification: %s",
 async fault => {
  const f = await nativeSnapshotFixture();
  await pendingFixture(f, Promise.resolve(), async () => {
   const db = f.service.database;
   if (fault === "prior-unknown") {
    // Labelled persistence fault after a real return; this does not prove a prior send.
    save(f, "native-mutation", "g2d-labelled-prior", {
     id: "g2d-labelled-prior", sessionId: f.run.sessionId, state: "unknown",
    });
   } else {
    const frozen = db.getEntity("native-drift-policy", f.run.id) as Record<string, JsonValue>;
    save(f, "native-drift-policy", f.run.id, {
     ...frozen, policy: {...frozen.policy as object, permissionFingerprint: "g2d-changed"},
    });
   }
   const before = cycleState(f);
   const rows = db.listEntities("native-mutation");
   const response = await f.advance();
   f.facts({fault, before, response: response.json(), after: cycleState(f), rows});
   expect(response.statusCode, response.body).toBe(409);
   expect(response.json().code).toBe(fault === "prior-unknown"
    ? "NATIVE_COMMAND_OUTCOME_UNKNOWN" : "NATIVE_DRIFT_POLICY_CHANGED");
   expect(f.children()).toEqual([]);
   expect(existsSync(join(f.root, "data/verification-snapshots"))).toBe(false);
   expect(proof(f)).toBeUndefined();
   expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(before.invalidation);
   expect(db.listEntities("native-reclaim-action")).toEqual(before.actions);
   for (const row of rows as {id: string}[]) expect(db.getEntity("native-mutation", row.id)).toEqual(row);
   expect(source(f)).toEqual(before.source);
   expect(f.starts()).toBe(1);
  });
 },
);

it.each([
 "missing-action", "duplicate-action", "action-session", "action-run", "action-epoch",
 "action-command", "action-report", "action-version", "action-state", "missing-return",
 "return-command", "return-phase", "return-control", "return-binding", "return-observation",
 "return-not-ready", "return-report-id", "fence-run", "fence-session", "fence-generation",
 "fence-lease", "consumed-missing-return", "consumed-mismatching-return",
] as const)("requires the actual initial return grant for %s", async fault => {
 const f = await nativeSnapshotFixture();
 await pendingFixture(f, Promise.resolve(), async () => {
  const db = f.service.database, id = "reclaim-1";
  const action = db.getEntity("native-reclaim-action", id) as Record<string, JsonValue>;
  if (fault === "missing-action") db.handle.prepare("DELETE FROM entities WHERE kind='native-reclaim-action' AND id=?").run(id);
  if (fault === "duplicate-action") save(f, "native-reclaim-action", "g2d-duplicate", {...action, commandId: "g2d-duplicate"});
  const fields: Record<string, object> = {
   "action-session": {sessionId: "foreign"}, "action-run": {runId: "foreign"},
   "action-epoch": {controlEpoch: 0}, "action-command": {commandId: "foreign"},
   "action-report": {reportId: "foreign"}, "action-version": {version: 2}, "action-state": {state: null},
  };
  if (fields[fault]) save(f, "native-reclaim-action", id, {...action, ...fields[fault]});
  if (fault.startsWith("consumed-")) save(f, "native-reclaim-action", id, {...action, state: "consumed"});
  if (fault === "missing-return" || fault === "consumed-missing-return") {
   db.handle.prepare("DELETE FROM entities WHERE kind='native-reclaim' AND id=?").run(id);
  }
  const returnedFields: Record<string, [string, string | number]> = {
   "return-command": ["$.commandId", "foreign"], "return-phase": ["$.phase", "checking"],
   "return-control": ["$.commit.control.revision", 999], "return-binding": ["$.binding.nativeSessionId", "foreign"],
   "return-observation": ["$.report.observation.id", "foreign"], "return-not-ready": ["$.report.ready", 0],
   "return-report-id": ["$.report.id", ""], "fence-run": ["$.commit.fence.runId", "foreign"],
   "fence-session": ["$.commit.fence.sessionId", "foreign"], "fence-generation": ["$.commit.fence.generation", 99],
   "fence-lease": ["$.commit.fence.leaseId", "foreign"], "consumed-mismatching-return": ["$.commit.reportId", "foreign"],
  };
  const field = returnedFields[fault];
  if (field) db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,?,?) WHERE kind='native-reclaim' AND id=?").run(...field, id);
  const before = cycleState(f), response = await f.advance();
  f.facts({fault, before, response: response.json(), after: cycleState(f)});
  expect(response.statusCode, response.body).toBe(409);
  expect(response.json().code).toBe("NATIVE_RECLAIM_ACTION_MISMATCH");
  expect(f.children()).toEqual([]);
  expect(existsSync(join(f.root, "data/verification-snapshots"))).toBe(false);
  expect(db.getEntity("run-snapshot-current", f.run.id)).toBeUndefined();
  expect(db.listEntities("native-reclaim-action")).toEqual(before.actions);
  expect(db.listEntities("native-reclaim")).toEqual(before.returns);
  expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(before.invalidation);
  expect(db.listEntities("run-verification-command")).toEqual([]);
  expect(source(f)).toEqual(before.source);
  expect(f.starts()).toBe(1);
 });
});

it.each(["allocation-callback", "no-child-retry"] as const)(
 "accepts a legitimately consumed actual return during %s before any CAPTURED pointer",
 async mode => {
  const f = await nativeSnapshotFixture();
  const snapshots = f.service["verificationSnapshots"], original = snapshots.createDeliveryCandidate.bind(snapshots);
  let checked = false;
  const allocation = vi.spyOn(snapshots, "createDeliveryCandidate").mockImplementation(async (input, assertAuthority) => {
   expect(f.service.database.getEntity("native-reclaim-action", "reclaim-1")).toMatchObject({state: "consumed"});
   expect(f.service.database.getEntity("run-snapshot-current", f.run.id)).toBeUndefined();
   assertAuthority(); assertAuthority(); checked = true;
   if (mode === "no-child-retry") throw Error("g2d known allocation refusal before any child");
   return original(input, assertAuthority);
  });
  await pendingFixture(f, Promise.resolve(), async () => {
   try {
    const before = source(f), first = await f.advance();
    expect(checked).toBe(true);
    if (mode === "no-child-retry") {
     expect(first.statusCode).toBe(500);
     expect(f.children()).toEqual([]);
     expect(proof(f)).toBeUndefined();
     expect(f.service.database.getEntity("native-reclaim-action", "reclaim-1")).toMatchObject({state: "consumed"});
     expect(f.service.database.listEntities("native-mutation")).not.toContainEqual(expect.objectContaining({state: "unknown"}));
     allocation.mockRestore();
    }
    const response = mode === "no-child-retry" ? await f.advance() : first;
    f.facts({mode, checked, response: response.json(), proof: proof(f), children: f.children()});
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({run: {state: "COMPLETE"}, task: {state: "REVIEW"}});
    expect(proof(f)?.state).toBe("VERIFIED");
    expect(f.children()).toHaveLength(2);
    expect(source(f)).toEqual(before);
    expect(f.starts()).toBe(1);
   } finally { allocation.mockRestore(); }
  });
 },
);

it.each(["active", "unknown", "missing-state", "null-state", "malformed-id"] as const)(
 "keeps labelled prior %s mutation as an initial snapshot barrier",
 async state => {
  const f = await nativeSnapshotFixture();
  await pendingFixture(f, Promise.resolve(), async () => {
   const id = "g2d-labelled-prior", db = f.service.database;
   const prior = {id: state === "malformed-id" ? "foreign" : id, sessionId: f.run.sessionId,
    ...(state === "missing-state" ? {} : {state: state === "null-state" ? null : state === "malformed-id" ? "settled" : state})};
   save(f, "native-mutation", id, prior);
   const before = cycleState(f), response = await f.advance();
   f.facts({state, prior, before, response: response.json(), after: cycleState(f)});
   expect(response.json().code).toBe("NATIVE_COMMAND_OUTCOME_UNKNOWN");
   expect(db.getEntity("native-mutation", id)).toEqual(prior);
   expect(db.listEntities("native-reclaim-action")).toEqual(before.actions);
   expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(before.invalidation);
   expect(proof(f)).toBeUndefined(); expect(f.children()).toEqual([]);
   expect(existsSync(join(f.root, "data/verification-snapshots"))).toBe(false);
   expect(source(f)).toEqual(before.source); expect(f.starts()).toBe(1);
  });
 },
);

it.each(["missing", "id", "session", "state"] as const)(
 "refuses actual owned marker %s corruption before initial snapshot allocation",
 async fault => {
  const f = await nativeSnapshotFixture(), db = f.service.database, original = db.saveEntity.bind(db);
  let injected = false;
  const saving = vi.spyOn(db, "saveEntity").mockImplementation((...args) => {
   const result = original(...args);
   if (!injected && args[0] === "native-mutation" && (args[2] as {state?: string}).state === "active") {
    injected = true; f.record("g2d-owned-marker-corruption", {fault, id: args[1], before: args[2]});
    if (fault === "missing") db.handle.prepare("DELETE FROM entities WHERE kind='native-mutation' AND id=?").run(args[1]);
    else db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,?,?) WHERE kind='native-mutation' AND id=?")
     .run(fault === "id" ? "$.id" : fault === "session" ? "$.sessionId" : "$.state", fault === "state" ? "unknown" : "foreign", args[1]);
   }
   return result;
  });
  await pendingFixture(f, Promise.resolve(), async () => {
   try {
    const before = cycleState(f), response = await f.advance();
    f.facts({fault, injected, before, response: response.json(), after: cycleState(f)});
    expect(injected).toBe(true); expect(response.json().code).toBe("MUTATION_LANE_REQUIRED");
    expect(proof(f)).toBeUndefined(); expect(f.children()).toEqual([]);
    expect(db.listEntities("native-reclaim-action")).toEqual(before.actions);
    expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(before.invalidation);
    expect(source(f)).toEqual(before.source); expect(f.starts()).toBe(1);
   } finally { saving.mockRestore(); }
  });
 },
);

it.each(["return", "return-document", "action-document", "policy", "policy-document", "foreign-unknown"] as const)(
 "settles an occurred preparation before refusing %s drift through a real child barrier",
 async drift => {
  const f = await nativeSnapshotFixture({preparation: [barrier]}), pending = f.advance();
  await pendingFixture(f, pending, async () => {
   await waitChild(f);
   const db = f.service.database, before = source(f), invalidation = db.getEntity("native-verification-invalidation", f.run.id);
   const receipts = db.listEntities("run-verification-command") as unknown as {id: string;state: string}[];
   expect(receipts).toHaveLength(1); expect(receipts[0]!.state).toBe("SENDING");
   if (drift === "foreign-unknown") save(f, "native-mutation", "g2d-during-child", {id: "g2d-during-child", sessionId: f.run.sessionId, state: "unknown"});
   else {
    const kind = drift.startsWith("policy") ? "native-drift-policy" : drift === "action-document" ? "native-reclaim-action" : "native-reclaim";
    const path = drift === "return" ? "$.commit.reportId" : drift === "return-document" ? "$.actorId" : drift === "policy" ? "$.policy.permissionFingerprint" : "$.g2dLabelledDrift";
    db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,?,?) WHERE kind=? AND id=?")
     .run(path, "g2d-drift", kind, kind === "native-drift-policy" ? f.run.id : "reclaim-1");
   }
   const changed = {actions: db.listEntities("native-reclaim-action"), returned: db.listEntities("native-reclaim"),
    policy: db.getEntity("native-drift-policy", f.run.id), foreign: db.getEntity("native-mutation", "g2d-during-child")};
   release(f); const response = await pending;
   f.facts({drift, invalidation, changed, response: response.json(), proof: proof(f), receipts: db.listEntities("run-verification-command"), children: f.children()});
   expect(response.statusCode, response.body).toBe(409);
   expect(response.json().code).toBe(drift === "foreign-unknown" ? "NATIVE_COMMAND_OUTCOME_UNKNOWN"
    : drift === "policy" ? "NATIVE_DRIFT_POLICY_CHANGED" : drift === "return" ? "NATIVE_RECLAIM_ACTION_MISMATCH" : "LOCAL_REVIEW_CONTEXT_CHANGED");
   expect(db.getEntity("run-verification-command", receipts[0]!.id)).toMatchObject({state: "SETTLED", result: {commandId: "prepare-0", status: "passed", exitCode: 0}});
   expect(f.children()).toHaveLength(1); expect(absent(f.children()[0]!.pid)).toBe(true);
   expect(proof(f)?.state).toBe("FAILED");
   expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(invalidation);
   expect(db.listEntities("native-reclaim-action")).toEqual(changed.actions);
   expect(db.listEntities("native-reclaim")).toEqual(changed.returned);
   expect(db.getEntity("native-drift-policy", f.run.id)).toEqual(changed.policy);
   expect(db.getEntity("native-mutation", "g2d-during-child")).toEqual(changed.foreign);
   expect(source(f)).toEqual(before); expect(f.starts()).toBe(1);
  });
 },
);

it.each(["return", "action", "policy", "return-document", "foreign-unknown", "ignored-action"] as const)(
 "rolls back initial %s trigger during consumption and retries the same real return",
 async fault => {
  const f = await nativeSnapshotFixture(), db = f.service.database;
  await pendingFixture(f, Promise.resolve(), async () => {
   const before = cycleState(f), frozen = db.getEntity("native-drift-policy", f.run.id);
   const effects: Record<string, string> = {
    return: "UPDATE entities SET document_json=json_set(document_json,'$.commit.reportId','foreign') WHERE kind='native-reclaim' AND id='reclaim-1';",
    action: "UPDATE entities SET document_json=json_set(document_json,'$.reportId','foreign') WHERE kind='native-reclaim-action' AND id='reclaim-1';",
    policy: "UPDATE entities SET document_json=json_set(document_json,'$.policy.permissionFingerprint','foreign') WHERE kind='native-drift-policy';",
    "return-document": "UPDATE entities SET document_json=json_set(document_json,'$.actorId','foreign') WHERE kind='native-reclaim' AND id='reclaim-1';",
    "foreign-unknown": `INSERT INTO entities(kind,id,document_json,updated_at) VALUES('native-mutation','g2d-trigger-prior','${JSON.stringify({id: "g2d-trigger-prior", sessionId: f.run.sessionId, state: "unknown"})}','g2d');`,
    "ignored-action": "SELECT RAISE(IGNORE);",
   };
   db.handle.exec(`CREATE TRIGGER g2d_consume_fault ${fault === "ignored-action" ? "BEFORE" : "AFTER"} UPDATE ON entities WHEN NEW.kind='native-reclaim-action' AND json_extract(NEW.document_json,'$.state')='consumed' BEGIN ${effects[fault]} END`);
   try {
    const refused = await f.advance();
    f.facts({fault, before, refused: refused.json(), afterRefusal: cycleState(f)});
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().code).toBe(fault === "policy" ? "NATIVE_DRIFT_POLICY_CHANGED"
     : fault === "foreign-unknown" ? "NATIVE_COMMAND_OUTCOME_UNKNOWN" : "NATIVE_RECLAIM_ACTION_MISMATCH");
    expect(db.listEntities("native-reclaim-action")).toEqual(before.actions);
    expect(db.listEntities("native-reclaim")).toEqual(before.returns);
    expect(db.getEntity("native-drift-policy", f.run.id)).toEqual(frozen);
    expect(db.getEntity("native-mutation", "g2d-trigger-prior")).toBeUndefined();
    expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(before.invalidation);
    expect(proof(f)).toBeUndefined(); expect(f.children()).toEqual([]);
    expect(db.listEntities("run-verification-command")).toEqual([]);
    expect(existsSync(join(f.root, "data/verification-snapshots"))).toBe(false);
    db.handle.exec("DROP TRIGGER g2d_consume_fault");
    const response = await f.advance();
    f.record("g2d-trigger-retry", {fault, response: response.json(), proof: proof(f), children: f.children()});
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({run: {state: "COMPLETE"}, task: {state: "REVIEW"}});
    expect(proof(f)?.state).toBe("VERIFIED"); expect(f.children()).toHaveLength(2);
    expect(source(f)).toEqual(before.source); expect(f.starts()).toBe(1);
   } finally { db.handle.exec("DROP TRIGGER IF EXISTS g2d_consume_fault"); }
  });
 },
);

it.each(["VERIFIED", "CAPTURED"] as const)(
 "retains a legacy %s policy hash as history, refuses reuse and requires a fresh actual HUMAN return",
 async state => {
  const f = state === "VERIFIED" ? await deliveringCycle("pull-request") : await nativeSnapshotFixture({delivery: "pull-request"});
  await pendingFixture(f, Promise.resolve(), async () => {
   const db = f.service.database;
   if (state === "CAPTURED") {
    db.handle.exec("CREATE TRIGGER g2d_legacy_capture BEFORE INSERT ON entities WHEN NEW.kind='run-snapshot-verification' AND json_extract(NEW.document_json,'$.state')='VERIFIED' BEGIN SELECT RAISE(ABORT,'g2d capture acceptance fault'); END");
    try {
     const first = await f.advance();
     expect(first.statusCode).toBe(500); expect(proof(f)?.state).toBe("CAPTURED");
    } finally { db.handle.exec("DROP TRIGGER g2d_legacy_capture"); }
   }
   const {contentHash} = await import("../src/task-publications.js");
   const legacy = structuredClone(proof(f)) as unknown as {id: string;basis: {policyHash: string};state: string};
   const configured = f.service.configuration.current().config.agentProfiles.find(p => p.id === f.run.profileId)!.nativeInteraction;
   legacy.basis.policyHash = contentHash({frozen: db.getEntity("native-drift-policy", f.run.id), configured});
   save(f, "run-snapshot-verification", legacy.id, legacy);
   const before = cycleState(f), commit = vi.spyOn(f.service["localGitDelivery"], "commit"), response = await f.advance();
   try {
    f.facts({state, legacy, before, response: response.json(), after: cycleState(f)});
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().code).toBe("LOCAL_REVIEW_CONTEXT_CHANGED");
    expect(db.getEntity("run-snapshot-verification", legacy.id)).toEqual(legacy);
    expect(f.children()).toEqual(before.children); expect(source(f)).toEqual(before.source);
    expect(commit).not.toHaveBeenCalled();
    await f.returnHuman({duringHuman: () => writeFileSync(join(f.run.worktree!, "result.txt"), "fresh HUMAN legacy replacement\n")});
    const fresh = await f.advance();
    f.record("g2d-legacy-fresh-return", {state, fresh: fresh.json(), proof: proof(f), legacy: db.getEntity("run-snapshot-verification", legacy.id)});
    expect(fresh.json().code).toBe("VERIFIED_DELIVERY_UNAVAILABLE");
    expect(proof(f)?.state).toBe("VERIFIED"); expect(proof(f)?.id).not.toBe(legacy.id);
    expect(db.getEntity("run-snapshot-verification", legacy.id)).toEqual(legacy);
    expect(f.children()).toHaveLength(4); expect(commit).not.toHaveBeenCalled(); expect(f.starts()).toBe(1);
   } finally { commit.mockRestore(); }
  });
 },
);

it("never replays an UNKNOWN legacy proof after a genuine fresh explicit HUMAN return", async () => {
 const f = await deliveringCycle();
 await pendingFixture(f, Promise.resolve(), async () => {
  const db = f.service.database, {contentHash} = await import("../src/task-publications.js");
  const previous = structuredClone(proof(f)) as unknown as {id: string;state: string;basis: {policyHash: string}};
  previous.state = "UNKNOWN";
  previous.basis.policyHash = contentHash({frozen: db.getEntity("native-drift-policy", f.run.id), configured: f.service.configuration.current().config.agentProfiles[0]!.nativeInteraction});
  save(f, "run-snapshot-verification", previous.id, previous);
  await f.returnHuman();
  const before = cycleState(f), response = await f.advance();
  f.facts({previous, before, response: response.json(), after: cycleState(f)});
  expect(response.statusCode, response.body).toBe(409);
  expect(db.getEntity("run-snapshot-verification", previous.id)).toEqual(previous);
  expect(f.children()).toEqual(before.children);
  expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(before.invalidation);
  expect(source(f)).toEqual(before.source); expect(f.starts()).toBe(1);
 });
});

it.each(["profile", "marker", "binding-physical"] as const)(
 "rolls back valid initial verify authority after late synchronous %s refusal",
 async fault => {
  const f = await nativeSnapshotFixture({profile: fault !== "profile"});
  await pendingFixture(f, Promise.resolve(), async () => {
   const db = f.service.database;
   if (fault === "marker") db.handle.prepare("DELETE FROM entities WHERE kind='run-snapshot-verification-config' AND id=?").run(f.run.id);
   if (fault === "binding-physical") db.handle.prepare("UPDATE native_bindings SET binding_key='foreign' WHERE session_id=?").run(f.run.sessionId);
   const before = cycleState(f), response = await f.advance();
   f.facts({fault, before, response: response.json(), after: cycleState(f)});
   expect(response.statusCode, response.body).toBe(409);
   expect(response.json().code).toBe(fault === "binding-physical" ? "NATIVE_IDENTITY_CHANGED" : "VERIFICATION_ENVIRONMENT_UNAVAILABLE");
   expect(db.listEntities("native-reclaim-action")).toEqual(before.actions);
   expect(db.listEntities("native-reclaim")).toEqual(before.returns);
   expect(db.getEntity("native-verification-invalidation", f.run.id)).toEqual(before.invalidation);
   expect(db.getEntity("run", f.run.id)).toMatchObject({state: "VERIFYING", verification: {state: "PENDING"}});
   expect(db.listEntities("run-snapshot-verification")).toEqual([]);
   expect(db.listEntities("run-verification-command")).toEqual([]);
   expect(f.children()).toEqual([]);
   expect(existsSync(join(f.root, "data/verification-snapshots"))).toBe(false);
   expect(source(f)).toEqual(before.source); expect(f.starts()).toBe(1);
  });
 },
);

// Raw TEXT observations must not decode the deliberately corrupted grant document.
const rawNativeGrants=(f:Fixture)=>f.service.database.handle.prepare("SELECT kind,id,document_json,updated_at FROM entities WHERE kind IN ('native-reclaim-action','native-reclaim') ORDER BY kind,id").all();

it.each([
 {phase:"initial",kind:"native-reclaim-action"},
 {phase:"initial",kind:"native-reclaim"},
 {phase:"reentry",kind:"native-reclaim-action"},
 {phase:"reentry",kind:"native-reclaim"},
] as const)("normalizes malformed persisted native grant before $phase children: $kind",async({phase,kind})=>{
 const f=phase==="reentry"?await deliveringCycle():await nativeSnapshotFixture();
 await pendingFixture(f,Promise.resolve(),async()=>{
  if(phase==="reentry")await f.returnHuman();
  const db=f.service.database,id=phase==="reentry"?"reclaim-2":"reclaim-1",corrupt="{r1-labelled-invalid-json";
  const oldProofs=db.listEntities("run-snapshot-verification"),pointer=db.getEntity("run-snapshot-current",f.run.id),oldRun=db.getEntity("run",f.run.id);
  db.handle.prepare("UPDATE entities SET document_json=? WHERE kind=? AND id=?").run(corrupt,kind,id);
  const grants=rawNativeGrants(f),invalidation=db.getEntity("native-verification-invalidation",f.run.id),before=source(f),children=f.children();
  const allocation=vi.spyOn(f.service["verificationSnapshots"],"createDeliveryCandidate");
  try{
   const response=await f.advance();
   f.facts({phase,kind,id,corrupt,grants,response:response.json(),afterGrants:rawNativeGrants(f),proofs:db.listEntities("run-snapshot-verification"),children:f.children()});
   expect(response.statusCode,response.body).toBe(409);
   expect(response.json().code).toBe("NATIVE_RECLAIM_ACTION_MISMATCH");
   expect(rawNativeGrants(f)).toEqual(grants);
   expect(db.getEntity("native-verification-invalidation",f.run.id)).toEqual(invalidation);
   expect(db.getEntity("run-snapshot-current",f.run.id)).toEqual(pointer);
   expect(db.listEntities("run-snapshot-verification")).toEqual(oldProofs);
   if(phase==="reentry")expect(db.getEntity("run",f.run.id)).toEqual(oldRun);
   else expect(existsSync(join(f.root,"data/verification-snapshots"))).toBe(false);
   expect(allocation).not.toHaveBeenCalled();expect(f.children()).toEqual(children);
   expect(source(f)).toEqual(before);expect(f.starts()).toBe(1);
  }finally{allocation.mockRestore();}
 });
});

it.each(["native-reclaim-action","native-reclaim"] as const)("normalizes malformed persisted native grant after a real child: %s",async kind=>{
 const f=await nativeSnapshotFixture({preparation:[barrier]}),pending=f.advance();
 await pendingFixture(f,pending,async()=>{
  await waitChild(f);
  const db=f.service.database,before=source(f),corrupt="[r1-labelled-child-corruption",invalidation=db.getEntity("native-verification-invalidation",f.run.id);
  const sending=db.listEntities("run-verification-command") as unknown as {id:string;state:string;result?:unknown}[];
  expect(sending).toHaveLength(1);expect(sending[0]!.state).toBe("SENDING");
  db.handle.prepare("UPDATE entities SET document_json=? WHERE kind=? AND id='reclaim-1'").run(corrupt,kind);
  const grants=rawNativeGrants(f);release(f);const response=await pending;
  const returned=db.getEntity("run-verification-command",sending[0]!.id) as unknown as {state:string;result?:unknown};
  f.facts({kind,corrupt,grants,response:response.json(),returned,proof:proof(f),children:f.children()});
  expect(response.statusCode,response.body).toBe(409);
  expect(response.json().code).toBe("NATIVE_RECLAIM_ACTION_MISMATCH");
  expect(returned).toMatchObject({state:"SETTLED",result:{commandId:"prepare-0",status:"passed",exitCode:0}});
  expect({...returned,state:"SENDING",result:undefined}).toEqual({...sending[0],result:undefined});
  expect(rawNativeGrants(f)).toEqual(grants);
  expect(db.getEntity("native-verification-invalidation",f.run.id)).toEqual(invalidation);
  expect(proof(f)?.state).toBe("FAILED");expect(f.children()).toHaveLength(1);
  expect(absent(f.children()[0]!.pid)).toBe(true);expect(source(f)).toEqual(before);expect(f.starts()).toBe(1);
 });
});

it.each(["000-r1-corrupt","zzz-r1-corrupt"] as const)("does not skip malformed persisted native grant %s alongside a valid current grant",async id=>{
 const f=await nativeSnapshotFixture();
 await pendingFixture(f,Promise.resolve(),async()=>{
  const db=f.service.database,corrupt="r1-unscopable-invalid-json";
  // Labelled corrupt storage only; this is not another Run, grant or prior native send.
  db.handle.prepare("INSERT INTO entities(kind,id,document_json,updated_at) VALUES('native-reclaim-action',?,?,?)").run(id,corrupt,"labelled-r1-fault");
  const grants=rawNativeGrants(f),invalidation=db.getEntity("native-verification-invalidation",f.run.id),before=source(f),response=await f.advance();
  f.facts({id,corrupt,grants,response:response.json(),afterGrants:rawNativeGrants(f)});
  expect(response.statusCode,response.body).toBe(409);expect(response.json().code).toBe("NATIVE_RECLAIM_ACTION_MISMATCH");
  expect(rawNativeGrants(f)).toEqual(grants);expect(db.getEntity("native-verification-invalidation",f.run.id)).toEqual(invalidation);
  expect(proof(f)).toBeUndefined();expect(f.children()).toEqual([]);
  expect(existsSync(join(f.root,"data/verification-snapshots"))).toBe(false);
  expect(source(f)).toEqual(before);expect(f.starts()).toBe(1);
 });
});

it("normalizes malformed persisted native grant historical return TEXT during actual reentry",async()=>{
 const f=await deliveringCycle();
 await pendingFixture(f,Promise.resolve(),async()=>{
  await f.returnHuman();const db=f.service.database,corrupt="{r1-labelled-corrupt-old-return";
  db.handle.prepare("UPDATE entities SET document_json=? WHERE kind='native-reclaim' AND id='reclaim-1'").run(corrupt);
  const grants=rawNativeGrants(f),oldRun=db.getEntity("run",f.run.id),oldProofs=db.listEntities("run-snapshot-verification"),pointer=db.getEntity("run-snapshot-current",f.run.id),receipts=db.listEntities("run-verification-command"),invalidation=db.getEntity("native-verification-invalidation",f.run.id),before=source(f),children=f.children();
  const response=await f.advance();
  f.facts({corrupt,grants,response:response.json(),afterGrants:rawNativeGrants(f),proofs:db.listEntities("run-snapshot-verification"),children:f.children()});
  expect(response.statusCode,response.body).toBe(409);expect(response.json().code).toBe("NATIVE_RECLAIM_ACTION_MISMATCH");
  expect(rawNativeGrants(f)).toEqual(grants);expect(db.getEntity("run",f.run.id)).toEqual(oldRun);
  expect(db.listEntities("run-snapshot-verification")).toEqual(oldProofs);expect(db.getEntity("run-snapshot-current",f.run.id)).toEqual(pointer);
  expect(db.listEntities("run-verification-command")).toEqual(receipts);
  expect(db.getEntity("native-verification-invalidation",f.run.id)).toEqual(invalidation);
  expect(f.children()).toEqual(children);expect(source(f)).toEqual(before);expect(f.starts()).toBe(1);
 });
});

it.each(["owner","matching-return","historical-return"] as const)("does not normalize unrelated native grant storage errors at %s",async boundary=>{
 const f=boundary==="historical-return"?await deliveringCycle():await nativeSnapshotFixture();
 await pendingFixture(f,Promise.resolve(),async()=>{
  if(boundary==="historical-return")await f.returnHuman();
  const db=f.service.database,prepare=db.handle.prepare.bind(db.handle),fault=Object.assign(new SyntaxError("labelled unrelated storage read failure"),{code:"R1_INJECTED_STORAGE_FAILURE"});
  const grants=rawNativeGrants(f),invalidation=db.getEntity("native-verification-invalidation",f.run.id),proofs=db.listEntities("run-snapshot-verification"),before=source(f),children=f.children();
  let injected=false;
  const reading=vi.spyOn(db.handle,"prepare").mockImplementation((...args)=>{
   const sql=args[0],target=boundary==="owner"?sql.includes("kind='native-reclaim-action'")&&sql.includes("LIMIT 1"):boundary==="matching-return"?sql.includes("kind='native-reclaim' AND id=?"):sql.includes("kind='native-reclaim' ORDER BY");
   // A reader-origin SyntaxError is not an actual malformed JSON document.
   if(target){injected=true;throw fault;}
   return prepare(...args);
  });
  try{
   const response=await f.advance();
   f.facts({boundary,injected,fault:{name:fault.name,message:fault.message,code:fault.code},response:response.json(),grants,afterGrants:rawNativeGrants(f)});
   expect(injected).toBe(true);expect(response.statusCode,response.body).toBe(500);
   expect(response.json().code).not.toBe("NATIVE_RECLAIM_ACTION_MISMATCH");
   expect(rawNativeGrants(f)).toEqual(grants);expect(db.getEntity("native-verification-invalidation",f.run.id)).toEqual(invalidation);
   expect(db.listEntities("run-snapshot-verification")).toEqual(proofs);expect(f.children()).toEqual(children);
   expect(source(f)).toEqual(before);expect(f.starts()).toBe(1);
  }finally{reading.mockRestore();}
 });
});


it("strict native snapshot commit clean unchanged candidate creates no Git command",async()=>{
 const f=await nativeSnapshotFixture({delivery:"commit"});
 try{
  execFileSync("git",["-C",f.run.worktree!,"add","--all"]);
  execFileSync("git",["-C",f.run.worktree!,"commit","-m","fixture already authored"]);
  const before=source(f),response=await f.advance();expect(response.statusCode,response.body).toBe(200);
  expect(f.service.database.getEntity("run-result",f.run.id)).toMatchObject({commit:{created:false,commit:before.head.trim()}});
  expect(f.service.database.listEntities("local-git-command")).toEqual([]);expect(source(f)).toEqual(before);
 }finally{await f.close();}
});
it("strict native snapshot commit unknown authored readback preserves the native barrier",async()=>{
 const f=await nativeSnapshotFixture({delivery:"commit"});
 try{
  const before=source(f).head,observe=f.service.workspaces.observeSnapshotCommit.bind(f.service.workspaces);
  vi.spyOn(f.service.workspaces,"observeSnapshotCommit").mockImplementation(async(...args)=>{
   if(source(f).head!==before)throw Error("fixture authored readback unavailable");return observe(...args);
  });
  const first=await f.advance();expect(first.statusCode,first.body).toBe(500);
  const head=source(f).head,commands=structuredClone(f.service.database.listEntities("local-git-command"));expect(commands).toHaveLength(2);
  expect(f.service.database.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING"});
  expect(f.service.database.listEntities("native-mutation")).toContainEqual(expect.objectContaining({state:"unknown"}));
  const retry=await f.advance();expect(retry.statusCode,retry.body).toBe(409);
  expect(source(f).head).toBe(head);expect(f.service.database.listEntities("local-git-command")).toEqual(commands);
 }finally{await f.close();}
});
it.each(["proof","control","task"] as const)("strict native snapshot commit rolls back late %s drift in completion",async drift=>{
 const f=await nativeSnapshotFixture({delivery:"commit"}),db=f.service.database,saveEntity=db.saveEntity.bind(db);
 try{
  const fault=vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{
   const result=saveEntity(...args);
   if(args[0]==="run-result"){
    if(drift==="proof")db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.basis.policyHash','foreign') WHERE kind='run-snapshot-verification'").run();
    if(drift==="control")db.handle.exec("UPDATE session_controls SET revision=revision+1");
    if(drift==="task")db.handle.exec("UPDATE canonical_tasks SET document_json=json_set(document_json,'$.description','foreign')");
   }
   return result;
  });
  const response=await f.advance();expect(response.statusCode,response.body).toBe(409);fault.mockRestore();
  expect(db.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING"});
  expect(db.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state:"VERIFYING"});
  expect(db.getEntity("run-result",f.run.id)).toBeUndefined();
  expect(db.listEntities("native-snapshot-commit")).toMatchObject([{state:"COMPLETE"}]);
  expect(db.listEntities("local-git-command")).toHaveLength(2);
 }finally{vi.restoreAllMocks();await f.close();}
});

it.each(["lease-revoked","lease-expired","cancelled","runner-revoked","native-blocker"] as const)("strict native completion refuses late %s authority loss",async loss=>{
 const f=await nativeSnapshotFixture({delivery:"commit"}),db=f.service.database,original=db.saveEntity.bind(db);
 try{
  vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{
   const result=original(...args);
   if(args[0]==="run-result"){
    if(loss==="lease-revoked")f.service["leaseAuthority"].revoke(f.run.id,f.run.leaseId,f.run.generation,"fixture late revoke");
    if(loss==="lease-expired")f.service.options.clock=()=>new Date(Date.now()+16*60_000);
    if(loss==="cancelled")f.service["cancelledRunIds"].add(f.run.id);
    if(loss==="runner-revoked")f.service["revokedRunnerCredentials"].add(f.run.runnerId);
    if(loss==="native-blocker")original("native-external-write-blocker",f.run.sessionId,{version:1,sessionId:f.run.sessionId,runId:f.run.id,generation:f.run.generation,leaseId:f.run.leaseId,code:"fixture blocker"});
   }
   return result;
  });
  const response=await f.advance();expect(response.statusCode,response.body).toBe(409);
  expect(db.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING"});
  expect(db.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state:"VERIFYING"});
  expect(db.getEntity("run-result",f.run.id)).toBeUndefined();
  expect(db.listEntities("native-snapshot-commit")).toMatchObject([{state:"COMPLETE"}]);
  expect(db.listEntities("local-git-command")).toHaveLength(2);
 }finally{vi.restoreAllMocks();await f.close();}
});
it("strict native completion accepts a real heartbeat renewal during commit await",async()=>{
 const f=await nativeSnapshotFixture({delivery:"commit"}),owner=f.service["localGitDelivery"],commit=owner.commitSnapshot.bind(owner);
 let renewed="";
 try{
  vi.spyOn(owner,"commitSnapshot").mockImplementation(async input=>{
   const result=await commit(input);
   const current=f.service.database.getEntity("run",f.run.id) as unknown as Run;
   const lease=f.service["leaseAuthority"].renew(f.run.id,f.run.leaseId,f.run.generation,new Date(Date.now()+30*60_000).toISOString());
   renewed=lease.expiresAt;save(f,"run",f.run.id,{...current,leaseExpiresAt:renewed});
   return result;
  });
  const response=await f.advance();expect(response.statusCode,response.body).toBe(200);
  expect(response.json()).toMatchObject({run:{state:"COMPLETE",leaseExpiresAt:renewed},task:{state:"REVIEW"}});
  expect(f.service.database.listEntities("local-git-command")).toHaveLength(2);
 }finally{vi.restoreAllMocks();await f.close();}
});

it.each(["native-blocker","lease-revoked"] as const)("strict native final audit cannot hide a late %s",async loss=>{
 const f=await nativeSnapshotFixture({delivery:"commit"}),db=f.service.database,original=db.saveEntity.bind(db);let injected=false;
 try{
  vi.spyOn(db,"saveEntity").mockImplementation((...args)=>{
   const result=original(...args);
   if(!injected&&args[0]==="lease-audit"&&(db.getEntity("run",f.run.id) as unknown as Run).state==="COMPLETE"&&(db.getCanonicalTask(f.run.taskId)?.document as {state:string}).state==="REVIEW"){
    injected=true;
    if(loss==="native-blocker")original("native-external-write-blocker",f.run.sessionId,{version:1,sessionId:f.run.sessionId,runId:f.run.id,generation:f.run.generation,leaseId:f.run.leaseId,code:"fixture final-audit blocker"});
    else f.service["leaseAuthority"].revoke(f.run.id,f.run.leaseId,f.run.generation,"fixture final-audit revoke");
   }
   return result;
  });
  const response=await f.advance();expect(injected).toBe(true);expect(response.statusCode,response.body).toBe(409);
  expect(db.getEntity("run",f.run.id)).toMatchObject({state:"DELIVERING"});
  expect(db.getCanonicalTask(f.run.taskId)?.document).toMatchObject({state:"VERIFYING"});
  expect(db.getEntity("run-result",f.run.id)).toBeUndefined();
  expect(db.listEntities("native-snapshot-commit")).toMatchObject([{state:"COMPLETE"}]);
  expect(db.listEntities("local-git-command")).toHaveLength(2);
 }finally{vi.restoreAllMocks();await f.close();}
});
