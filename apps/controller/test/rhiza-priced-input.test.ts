import {expect,it} from "vitest";
import type {PricingSnapshotV1} from "@dispatcher/domain";
import {ModelInvocationStore,RhizaCommandStore} from "@dispatcher/persistence";
import {waitingRhizaJob} from "./fixtures/rhiza-waiting-job.js";
import {clientHeaders} from "./fixtures/rhiza-service.js";

it.each(["drift","expired","missing","refresh"] as const)("revalidates %s native terms before original-session RHIZA input without weakening the frozen quote",async reason=>{
 const clock={now:new Date()},price:PricingSnapshotV1={version:1,id:"synthetic-continuation-price",source:"native/account-model",collectedAt:clock.now.toISOString(),validUntil:new Date(clock.now.getTime()+600000).toISOString(),unit:"credits",rates:{per:"1000",input:"0.1",output:"2",includesMultiplier:true}},original=structuredClone(price);
 const {f,run,job,payload}=await waitingRhizaJob({nativePricing:price,clock:()=>clock.now});
 try{
  expect(run.executionSelection?.pricingSnapshot).toEqual(original);expect(new ModelInvocationStore(f.service.database).list(run.id)[0]?.executionSelection?.pricingSnapshot).toEqual(original);const revision=run.executionSelection!.catalogRevision;
  if(reason==="drift")price.rates!.input="999";if(reason==="expired")clock.now=new Date(Date.parse(price.validUntil!)+1);if(reason==="refresh"){clock.now=new Date(clock.now.getTime()+30000);price.collectedAt=clock.now.toISOString();}
  if(reason==="missing"){const adapter=f.service["agentAdapters"].get("codex")!,read=adapter.modelCatalog!.bind(adapter);adapter.modelCatalog=async context=>{const result=await read(context);for(const entry of result.entries)delete entry.billing;return result;};}
  const response=await f.service.app.inject({method:"POST",url:`/api/integrations/rhiza/v1/jobs/${job.jobId}/inputs`,headers:clientHeaders,payload});expect(response.statusCode,response.body).toBe(202);await f.service["rhizaInputs"].drain();
  expect((f.service.database.getEntity("run",run.id) as unknown as typeof run).executionSelection).toEqual(run.executionSelection);expect(run.executionSelection!.catalogRevision).toBe(revision);
  const observation=new RhizaCommandStore(f.service.database).latest(response.json().commandId);
  if(reason==="refresh"){expect(f.starts()).toBe(2);expect(observation).toMatchObject({state:"confirmed",proof:{kind:"input_accepted"}});expect(new ModelInvocationStore(f.service.database).list(run.id)[1]?.executionSelection?.pricingSnapshot).toEqual(original);}
  else{expect(f.starts()).toBe(1);expect(observation).toMatchObject({state:"confirmed",proof:{kind:"not_sent",reasonCode:"SELECTION_CHANGED"}});expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"WAITING_USER"});}
 }finally{await f.close();}
});
