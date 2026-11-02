import {expect,it,vi} from "vitest";
import {clientHeaders} from "./fixtures/rhiza-service.js";
import {waitingRhizaJob as waitingJob} from "./fixtures/rhiza-waiting-job.js";
it("shares the canonical sender and retains the explicit model and original provider session",async()=>{
 const {f,run,job,payload}=await waitingJob();try{
  const accepted=await f.service.app.inject({method:"POST",url:`/api/integrations/rhiza/v1/jobs/${job.jobId}/inputs`,headers:clientHeaders,payload});expect(accepted.statusCode,accepted.body).toBe(202);await f.service["rhizaInputs"].drain();expect(f.service.database.getEntity("run",run.id),JSON.stringify({nativeInputs:f.nativeInputs,inputs:f.service.database.listEntities("run-input"),observations:f.service.database.handle.prepare("SELECT state,proof_json FROM rhiza_command_observations").all()})).toMatchObject({state:"ACTIVE",sessionId:run.sessionId});expect(f.nativeInputs).toEqual([{model:"fixture-model",reasoningEffort:"medium",providerSessionId:undefined},{model:"fixture-model",reasoningEffort:"medium",providerSessionId:"native-fixture"}]);
  const replay=await f.service.app.inject({method:"POST",url:`/api/integrations/rhiza/v1/jobs/${job.jobId}/inputs`,headers:clientHeaders,payload});expect(replay.statusCode,replay.body).toBe(202);expect(replay.json()).toEqual(accepted.json());expect(f.starts()).toBe(2);
 }finally{await f.close();}
});

it("rejects an owner send when external input reserves during asynchronous selection validation",async()=>{
 const {f,run,job,payload}=await waitingJob();let release=()=>{};
 try{
  let entered=()=>{};const atValidation=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{release=resolve;});
  const service=f.service as unknown as {validateRunSelection(run:Run):Promise<void>},original=service.validateRunSelection.bind(f.service);
  const delayed=vi.spyOn(service,"validateRunSelection").mockImplementationOnce(async current=>{entered();await pending;return original(current);});
  const owner=f.service.app.inject({method:"POST",url:`/api/agents/profiles/codex/sessions/${run.sessionId}/input`,headers:f.headers,payload:{message:"Owner competing reply",inputId:"owner-race-input",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,lastActivityAt:run.lastActivityAt,taskRevision:payload.taskRevision}}}).then(response=>response);
  await atValidation;
  const accepted=await f.service.app.inject({method:"POST",url:`/api/integrations/rhiza/v1/jobs/${job.jobId}/inputs`,headers:clientHeaders,payload});expect(accepted.statusCode,accepted.body).toBe(202);await f.service["rhizaInputs"].drain();
  release();const response=await owner;delayed.mockRestore();expect(response.statusCode,response.body).toBe(409);expect(response.json().code).toBe("INPUT_OUTCOME_UNKNOWN");expect(f.starts()).toBe(1);
 }finally{release();vi.restoreAllMocks();await f.close();}
});
it("withdraws new input and its intervention while disabled but retains cleanup reads and cancellation",async()=>{
 const {f,job,payload}=await waitingJob();try{
  const config=f.service.configuration.current().config;config.rhizaIngress!.enabled=false;await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});
  const snapshot=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${job.jobId}`,headers:clientHeaders});expect(snapshot.statusCode,snapshot.body).toBe(200);expect(snapshot.json().allowedOperations).not.toContain("jobs:input");expect(snapshot.json().intervention).toBeUndefined();expect(snapshot.json().allowedOperations).toContain("jobs:read");expect(snapshot.json().allowedOperations).toContain("jobs:cancel");
  const response=await f.service.app.inject({method:"POST",url:`/api/integrations/rhiza/v1/jobs/${job.jobId}/inputs`,headers:clientHeaders,payload});expect(response.statusCode,response.body).toBe(503);expect(response.json().code).toBe("INGRESS_DISABLED");expect(f.starts()).toBe(1);
 }finally{await f.close();}
});
