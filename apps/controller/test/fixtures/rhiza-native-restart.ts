import {expect} from "vitest";
import type {Run} from "@dispatcher/domain";
import type {RhizaReceiptV1,RhizaSubmitRequestV1,RhizaSnapshotV1} from "@dispatcher/protocol";
import type {ControllerService} from "../../src/service.js";
import {clientHeaders} from "./rhiza-service.js";

/** Shared HTTP acceptance for two real stored native providers; no live source is restored. */
export async function assertRhizaUnknownRestart(service:ControllerService,accepted:{receipt:RhizaReceiptV1;request:RhizaSubmitRequestV1},original:Run,before:RhizaSnapshotV1){
 const {receipt,request}=accepted,base="/api/integrations/rhiza/v1";
 const query=await service.app.inject({url:`${base}/operations/by-key/${request.requestId}`,headers:clientHeaders});expect(query.statusCode,query.body).toBe(200);expect(query.json()).toEqual(receipt);
 const replay=await service.app.inject({method:"POST",url:`${base}/jobs`,headers:clientHeaders,payload:request});expect(replay.statusCode,replay.body).toBe(202);expect(replay.json()).toEqual(receipt);
 const read=await service.app.inject({url:`${base}/jobs/${receipt.jobId}`,headers:clientHeaders});expect(read.statusCode,read.body).toBe(200);const snapshot=read.json<RhizaSnapshotV1>();
 expect(snapshot).toMatchObject({jobId:receipt.jobId,taskId:receipt.taskId,runId:original.id,runGeneration:original.generation,state:"unknown",processObservation:"unknown",origin:receipt.origin,target:{...request.workOrder.target,targetHash:request.targetHash},inputHash:receipt.inputHash,modelEvidence:{status:"unverified",reported:null}});
 expect(snapshot.revision).toBeGreaterThan(before.revision);expect(snapshot.allowedOperations).not.toContain("jobs:input");expect(snapshot.allowedOperations).not.toContain("jobs:cancel");expect(snapshot.intervention).toBeUndefined();
 expect(service.database.getEntity("run",original.id)).toEqual({...original,state:"RUNNER_UNAVAILABLE",recoveryState:original.state,recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual",activitySummary:"Native process liveness is unknown after Controller restart; inspect the original native session and worktree before further execution"});
 const events=await service.app.inject({url:`${base}/events?cursor=${encodeURIComponent(before.cursor)}`,headers:clientHeaders});expect(events.statusCode,events.body).toBe(200);expect(events.json().events.length).toBeGreaterThan(0);expect(events.json().events.every((e:{jobId:string;revision:number})=>e.jobId===receipt.jobId&&e.revision>before.revision)).toBe(true);
 const artifacts=await service.app.inject({url:`${base}/jobs/${receipt.jobId}/artifacts`,headers:clientHeaders});expect(artifacts.statusCode,artifacts.body).toBe(200);expect(artifacts.json()).toEqual({schemaVersion:1,jobId:receipt.jobId,artifacts:[]});
 const cancel=await service.app.inject({method:"POST",url:`${base}/jobs/${receipt.jobId}/cancellations`,headers:clientHeaders,payload:{requestId:"unqualified-restart-stop",expectedJobRevision:snapshot.revision,runId:original.id,runGeneration:original.generation,generation:receipt.origin.generation}});expect(cancel.statusCode,cancel.body).toBe(409);expect(cancel.json().code).toBe("OPERATION_UNSUPPORTED");
 const advance=await service.app.inject({method:"POST",url:`/api/runs/${original.id}/advance`,headers:{authorization:"Bearer fixture-owner"}});expect(advance.statusCode,advance.body).toBe(409);
 expect(service.database.handle.prepare("SELECT COUNT(*) AS n FROM native_model_invocations").get()?.n).toBe(0);expect(service.database.handle.prepare("SELECT COUNT(*) AS n FROM native_turn_completions").get()?.n).toBe(0);
 const config=structuredClone(service.configuration.current().config);config.rhizaIngress!.enabled=false;service.configuration.applyPlan(service.configuration.buildPlan(config,"owner","disable synthetic restart ingress").id,{confirmed:true});
 const disabled=await service.app.inject({url:`${base}/operations/by-key/${request.requestId}`,headers:clientHeaders});expect(disabled.statusCode,disabled.body).toBe(200);expect(disabled.json()).toEqual(receipt);
 const expired=await service.app.inject({url:`${base}/events?cursor=${encodeURIComponent(snapshot.cursor)}`,headers:clientHeaders});expect(expired.statusCode,expired.body).toBe(409);expect(expired.json().code).toBe("CURSOR_EXPIRED");
 config.rhizaIngress!.clients[0]!.enabled=false;service.configuration.applyPlan(service.configuration.buildPlan(config,"owner","revoke synthetic restart client").id,{confirmed:true});
 const revoked=await service.app.inject({url:`${base}/operations/by-key/${request.requestId}`,headers:clientHeaders});expect(revoked.statusCode,revoked.body).toBe(401);
}
