import {afterEach,expect,it} from "vitest";
import {admitCatalogPricing,samePricingTerms,type PricingSnapshotV1,type ExecutionSelection} from "@dispatcher/domain";
import type {RhizaSubmitRequestV1} from "@dispatcher/protocol";
import {rhizaAdmissionFixture} from "./fixtures/rhiza-admission.js";
import {RhizaJobs} from "../src/rhiza-jobs.js";
import {CodexAdapter,OpenCodeAdapter,MemorySessionStore} from "@dispatcher/adapters";
import {ModelInvocationStore} from "@dispatcher/persistence";
const fixtures:Array<Awaited<ReturnType<typeof rhizaAdmissionFixture>>>=[];afterEach(async()=>{for(const f of fixtures.splice(0))await f.close();});
async function priced(){
 const f=await rhizaAdmissionFixture();fixtures.push(f);const price:PricingSnapshotV1={version:1,id:"synthetic-native-price",source:"native/account-model",collectedAt:f.clock.now.toISOString(),validUntil:new Date(f.clock.now.getTime()+120000).toISOString(),unit:"credits",rates:{per:"1000",input:"0.1",output:"2",includesMultiplier:true}};
 const entry=f.facts.catalog!.entries[0]!;entry.billing={mode:"metered",pricing:{version:1,basis:"native-account-model",nativeParameters:{},snapshot:structuredClone(price)}};
 const prepare=f.runtime.prepare;f.runtime.prepare=async(...args:unknown[])=>{const selection=await prepare(),context=args[3] as {reviewed?:ExecutionSelection}|undefined,current=admitCatalogPricing(f.facts.catalog!,f.request.workOrder.target.modelId,{},f.clock.now.toISOString());const snapshot=current.status==="available"?context?.reviewed?.pricingSnapshot&&samePricingTerms(context.reviewed.pricingSnapshot,current.snapshot)?structuredClone(context.reviewed.pricingSnapshot):current.snapshot:undefined;return {...selection,...(snapshot?{pricingSnapshot:snapshot}:{})};};
 const preflight=await f.targets.preflight(f.principal,f.request.workOrder),request:RhizaSubmitRequestV1={...f.request,preflightId:preflight.preflightId,targetHash:preflight.target.targetHash};
 return {...f,price,preflight,request,entry};
}
it("freezes native price privately without adding price fields to the public preflight or target",async()=>{
 const f=await priced(),stored=f.targets.review(f.principal,f.request);expect(stored.selection.pricingSnapshot).toEqual(f.price);expect(JSON.stringify(f.preflight)).not.toContain(f.price.id);expect(JSON.stringify(f.preflight)).not.toContain("pricingSnapshot");
});
it("admits the complete priced selection through canonical publication and replays exactly once",async()=>{
 const f=await priced(),receipt=await f.jobs.submit(f.principal,f.request),job=f.service.database.getEntity("rhiza-job",receipt.jobId) as {publicationId:string},record=f.publications.record(f.principal.id,job.publicationId);expect(record.selection?.pricingSnapshot).toEqual(f.price);expect(await f.jobs.submit(f.principal,f.request)).toEqual(receipt);expect(f.scheduled).toHaveLength(1);await f.scheduled[0]!();expect(f.starts).toHaveLength(1);
});
it("retains reviewed price on collection-time-only refresh through preflight, publication and native dispatch review",async()=>{
 const f=await priced();f.clock.now=new Date(f.clock.now.getTime()+30000);f.entry.billing!.pricing!.snapshot={...f.price,collectedAt:f.clock.now.toISOString()};f.facts.catalog!.fetchedAt=f.clock.now.toISOString();
 expect(f.targets.review(f.principal,f.request).selection.pricingSnapshot).toEqual(f.price);const receipt=await f.jobs.submit(f.principal,f.request),job=f.service.database.getEntity("rhiza-job",receipt.jobId) as {publicationId:string};expect(f.publications.record(f.principal.id,job.publicationId).selection?.pricingSnapshot).toEqual(f.price);await f.scheduled[0]!();expect(f.starts).toHaveLength(1);
});
it.each(["drift","expired","missing"] as const)("blocks %s native price despite unchanged catalog revision and keeps the original receipt queryable",async reason=>{
 const f=await priced(),receipt=await f.jobs.submit(f.principal,f.request),revision=f.facts.catalog!.revision;
 if(reason==="drift")f.entry.billing!.pricing!.snapshot={...f.price,rates:{...f.price.rates!,input:"0.2"}};if(reason==="expired")f.clock.now=new Date(Date.parse(f.price.validUntil!)+1);if(reason==="missing")delete f.entry.billing;
 expect(f.facts.catalog!.revision).toBe(revision);expect(()=>f.targets.review(f.principal,f.request)).toThrow(expect.objectContaining({code:"TARGET_CHANGED"}));await f.scheduled[0]!();expect(f.starts).toEqual([]);expect(await f.jobs.submit(f.principal,f.request)).toEqual(receipt);
 const restarted=new RhizaJobs(f.service.database,f.auth,f.targets,f.publications,f.options);restarted.reconcile();expect(await restarted.submit(f.principal,f.request)).toEqual(receipt);expect(f.scheduled).toHaveLength(1);expect(f.starts).toEqual([]);
});
it("preserves the existing explicitly unpriced canonical path",async()=>{
 const f=await rhizaAdmissionFixture();fixtures.push(f);expect(f.targets.review(f.principal,f.request).selection.pricingSnapshot).toBeUndefined();const receipt=await f.jobs.submit(f.principal,f.request);expect(receipt.state).toBe("accepted");await f.scheduled[0]!();expect(f.starts).toHaveLength(1);
});
it.each(["drift","expired","missing"] as const)("rejects %s terms at private preflight review before any canonical Task exists",async reason=>{
 const f=await priced();if(reason==="drift")f.entry.billing!.pricing!.snapshot={...f.price,rates:{...f.price.rates!,input:"0.2"}};if(reason==="expired")f.clock.now=new Date(Date.parse(f.price.validUntil!)+1);if(reason==="missing")delete f.entry.billing;
 expect(()=>f.targets.review(f.principal,f.request)).toThrow(expect.objectContaining({code:"TARGET_CHANGED"}));expect(f.service.database.listCanonicalTasks()).toEqual([]);expect(f.starts).toEqual([]);
});
it.each(["drift","refresh"] as const)("rechecks %s terms across filesystem-only preflight inspection",async change=>{
 const f=await priced(),inspect=f.targets["options"].inspectScope,before=f.service.database.listEntities("rhiza-preflight").length;
 f.targets["options"].inspectScope=async(...args)=>{f.clock.now=new Date(f.clock.now.getTime()+30000);f.facts.catalog!.fetchedAt=f.clock.now.toISOString();f.entry.billing!.pricing!.snapshot=change==="drift"?{...f.price,rates:{...f.price.rates!,input:"0.2"}}:{...f.price,collectedAt:f.clock.now.toISOString()};return inspect(...args);};
 if(change==="drift"){await expect(f.targets.preflight(f.principal,f.request.workOrder)).rejects.toMatchObject({code:"TARGET_CHANGED"});expect(f.service.database.listEntities("rhiza-preflight")).toHaveLength(before);}else{const receipt=await f.targets.preflight(f.principal,f.request.workOrder);expect(f.targets.review(f.principal,{...f.request,preflightId:receipt.preflightId}).selection.pricingSnapshot).toEqual(f.price);}
 expect(f.service.database.listCanonicalTasks()).toEqual([]);expect(f.starts).toEqual([]);
});
it.each(["codex","opencode"] as const)("persists complete priced %s synchronous invocation capture without stripping the reviewed quote",async provider=>{
 const f=await priced(),selection={...f.targets.review(f.principal,f.request).selection,providerId:provider,backendId:provider==="codex"?"codex-exec-json":"opencode-cli-json"},store=new MemorySessionStore(),invocations=new ModelInvocationStore(f.service.database);
 Object.assign(store,{recordModelInvocation:invocations.append.bind(invocations)});
 const backend={start:()=>({status:()=>"completed" as const,cancel:async()=>undefined,result:async()=>({state:"completed" as const,summary:"synthetic only",events:[],providerSessionId:"synthetic-session"})})},profile={id:selection.profileId,alias:"Synthetic",codexHome:f.native},adapter=provider==="codex"?new CodexAdapter(profile,backend,store):new OpenCodeAdapter(profile,backend,store);
 const session=await adapter.start({runId:"priced-sync-run",workspacePath:f.repository,executionSelection:selection,execution:{generation:1,attempt:1,leaseId:"synthetic-lease"}});
 expect(invocations.get(session.modelInvocationId!)?.executionSelection).toEqual(selection);expect(invocations.get(session.modelInvocationId!)?.model).toEqual({id:selection.requestedModel,options:{}});expect(invocations.list("priced-sync-run")).toHaveLength(1);
});
