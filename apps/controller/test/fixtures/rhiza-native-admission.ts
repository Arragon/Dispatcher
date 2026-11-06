import {expect,vi} from "vitest";
import type {AgentAdapter} from "@dispatcher/adapters";
import type {AccountModelCatalog,ScmDeliverySelection} from "@dispatcher/domain";
import {workOrder} from "../../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {rhizaApprovalDigest,rhizaInputHash} from "../../src/rhiza-semantics.js";
import type {ControllerService} from "../../src/service.js";
import {clientToken,clientHeaders,grant} from "./rhiza-service.js";

/** Actual auth/admission/compiler/dispatch; only account qualification and SCM inspection are synthetic. */
export async function admitRhizaNative(service:ControllerService,catalog:NonNullable<AgentAdapter["modelCatalog"]>,profileId="p"){
 await service["secrets"].put(grant.credentialRef,clientToken);
 const config=structuredClone(service.configuration.current().config);
 config.repositories[0]!.scopePaths=["."];config.repositories[0]!.verificationCommands=[{id:"verify",file:process.execPath,args:["-e","process.exit(0)"],required:true,timeoutMs:5000,outputLimitBytes:1024}];
 config.rhizaIngress={enabled:true,clients:[{...structuredClone(grant),repositoryIds:["repo"],profileIds:[profileId],expiresAt:"2100-01-01T00:00:00Z"}]};
 service.configuration.applyPlan(service.configuration.buildPlan(config,"owner","synthetic native ingress fixture").id,{confirmed:true});
 service["agentAdapters"].get(profileId)!.modelCatalog=async context=>{
  const result=await catalog(context);result.contextFingerprint=service["resolveProfileExecutionContext"](profileId,"repo","catalog").fingerprint;return result;
 };
 const facts=service["rhizaTargetFacts"].bind(service);
 vi.spyOn(service,"rhizaTargetFacts" as never).mockImplementation(((repositoryId:string,profileId:string)=>({...facts(repositoryId,profileId),ready:true,cliVersion:"synthetic-only",evidenceCapabilities:["configuration_confirmed"]})) as never);
 vi.spyOn(service,"prepareScmDelivery" as never).mockImplementation((async(draft:{delivery:{scmConnectorId:string;targetRepository:string;baseBranch:string}}):Promise<ScmDeliverySelection>=>({version:1,scmConnectorId:draft.delivery.scmConnectorId,repository:draft.delivery.targetRepository,baseBranch:draft.delivery.baseBranch,target:{version:1,host:"github.com",repository:draft.delivery.targetRepository,remoteFingerprint:"e".repeat(64)},contextFingerprint:"synthetic-scm",configRevision:service.configuration.current().revision,reviewedAt:new Date().toISOString()})) as never);
 const owner={authorization:"Bearer fixture-owner"};
 const models=await service.app.inject({url:`/api/agents/profiles/${profileId}/models?repositoryId=repo`,headers:owner});expect(models.statusCode,models.body).toBe(200);
 const targets=await service.app.inject({url:"/api/integrations/rhiza/v1/targets?repositoryId=repo",headers:clientHeaders});expect(targets.statusCode,targets.body).toBe(200);
 const row=targets.json().targets[0],model=(models.json() as AccountModelCatalog).entries[0]!;
 const order={...structuredClone(workOrder),repositoryId:"repo",origin:{...workOrder.origin,authorityId:grant.authorityId},scopePaths:["."],verificationCommandIds:["verify"],evidencePolicy:{minimum:"configuration_confirmed" as const},context:{packetId:"native-packet",formatVersion:"1",content:"Synthetic native authority regression",inputHash:rhizaInputHash("Synthetic native authority regression")},target:{executorRef:row.executorRef,runnerId:row.runnerId,profileId:row.profileId,harnessId:row.harnessId,backendId:row.backendId,modelId:model.id,modelOptions:{},catalogRevision:row.catalogRevision,contextFingerprint:row.contextFingerprint,profileRevision:row.profileRevision,adapterVersion:row.adapterVersion,cliVersion:row.cliVersion},approval:{reference:"synthetic-native-approval",digest:"a".repeat(64),expiresAt:"2100-01-01T00:00:00Z"},deadline:"2100-01-02T00:00:00Z"};
 order.approval.digest=rhizaApprovalDigest(order);
 const preflight=await service.app.inject({method:"POST",url:"/api/integrations/rhiza/v1/jobs/preflights",headers:clientHeaders,payload:{workOrder:order}});expect(preflight.statusCode,preflight.body).toBe(200);
 const request={requestId:"synthetic-native-request",workOrder:order,preflightId:preflight.json().preflightId,targetHash:preflight.json().target.targetHash};
 const accepted=await service.app.inject({method:"POST",url:"/api/integrations/rhiza/v1/jobs",headers:clientHeaders,payload:request});expect(accepted.statusCode,accepted.body).toBe(202);
 return {receipt:accepted.json(),request};
}
