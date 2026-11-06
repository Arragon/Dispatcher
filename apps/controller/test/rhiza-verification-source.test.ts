import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import type {Run} from "@dispatcher/domain";
import {RhizaAdmissionStore,RhizaVerificationStore,type JsonValue} from "@dispatcher/persistence";
import {VerificationRegistry} from "@dispatcher/runner";
import {workOrder} from "../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {localReviewFixture} from "./fixtures/local-review.js";
import {rhizaSubmissionHash} from "../src/rhiza-operations.js";
import type {RhizaJobRecord} from "../src/rhiza-jobs.js";
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as JsonValue;
/** Synthetic admission attached to an owned fixture Run: tests verifier persistence, not provider qualification. */
function bind(f:Awaited<ReturnType<typeof localReviewFixture>>):Run {
 const run=f.service.database.getEntity<JsonValue>("run",f.receipt.runId) as unknown as Run;
 const request={requestId:"synthetic-verification",preflightId:"synthetic",targetHash:"a".repeat(64),workOrder:{...structuredClone(workOrder),verificationCommandIds:["check"]}};
 const job:RhizaJobRecord={version:1,jobId:"synthetic-job",taskId:run.taskId,publicationId:"synthetic-publication",owner:"rhiza:synthetic",principal:{id:"rhiza:synthetic",roles:[],service:{clientId:"synthetic"}} as RhizaJobRecord["principal"],request,dispatch:{state:"observed",runId:run.id}};
 f.service.database.transaction(()=>{new RhizaAdmissionStore(f.service.database).accept({clientId:"synthetic",commandScope:"jobs.submit",requestId:request.requestId},rhizaSubmissionHash(request),()=>{f.service.database.saveEntity("rhiza-job",job.jobId,json(job));f.service.database.saveEntity("task-rhiza-binding",run.taskId,{version:1,jobId:job.jobId,clientId:"synthetic",origin:json(request.workOrder.origin)});return {jobId:job.jobId,taskId:run.taskId,repositoryId:"repo",profileId:run.profileId,authorityId:"synthetic",receipt:{state:"accepted"}};});});return run;
}
it("records content identity only after actual registered commands pass on unchanged managed source",async()=>{
 const f=await localReviewFixture({advance:false});try{
  const run=bind(f);await f.service.app.inject({method:"POST",url:`/api/runs/${run.id}/advance`,headers:f.headers});
  const proof=new RhizaVerificationStore(f.service.database).get(run.id,run.generation,"source");expect(proof).toMatchObject({runId:run.id,runGeneration:run.generation,sessionId:run.sessionId,commandIds:["check"],targetHash:"a".repeat(64)});expect(proof?.tree).toMatch(/^[a-f0-9]{40}$/);expect(proof?.commit).toBeUndefined();
  expect(f.service.database.listEntities("run-verification-command")).toContainEqual(expect.objectContaining({state:"SETTLED",result:expect.objectContaining({status:"passed"})}));expect(new RhizaVerificationStore(f.service.database).get(run.id,run.generation,"commit")).toBeUndefined();
 }finally{await f.close();}
});
it("refuses a source mutation after a successful command without manufacturing a verification receipt",async()=>{
 const f=await localReviewFixture({advance:false}),original=VerificationRegistry.prototype.run,execute=vi.spyOn(VerificationRegistry.prototype,"run").mockImplementation(async function(...args){const result=await original.apply(this,args);writeFileSync(join(args[1],"result.txt"),"unverified mutation\n");return result;});try{
  const run=bind(f),response=await f.service.app.inject({method:"POST",url:`/api/runs/${run.id}/advance`,headers:f.headers});expect(response.statusCode,response.body).toBe(409);expect(new RhizaVerificationStore(f.service.database).get(run.id,run.generation,"source")).toBeUndefined();expect(f.service.database.getEntity("run",run.id)).not.toMatchObject({verification:{state:"PASSED"}});expect(execute).toHaveBeenCalledTimes(1);
 }finally{execute.mockRestore();await f.close();}
});
