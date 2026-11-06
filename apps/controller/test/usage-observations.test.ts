import {expect,it} from "vitest";
import {DispatcherDatabase,migrations} from "@dispatcher/persistence";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {UsageObservations} from "../src/usage-observations.js";
import {contentHash} from "../src/task-publications.js";
const context={profileId:"p",runId:"r",sessionId:"s",generation:1};
const sample={version:1,eventId:"event-1",...context,turnId:"turn-1",scope:"turn",mode:"snapshot",observedAt:"2026-10-16T12:00:00Z",source:"native-event",completeness:"complete",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens",includedIn:"input"},{name:"output",value:"0",unit:"tokens"}]} as const;
it("deduplicates replay, replaces snapshots and keeps actual zero distinct from missing metrics",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([sample],context);store.record([sample],context);expect(store.query({runId:"r"}).observations).toHaveLength(1);
 store.record([{...sample,eventId:"event-2",observedAt:"2026-10-16T12:01:00Z",metrics:[{name:"input",value:"120",unit:"tokens"}]}],context);
 const result=store.query({runId:"r"});expect(result.observations).toHaveLength(2);expect(result.totals).toEqual([{profileId:"p",scope:"turn",name:"input",unit:"tokens",value:"120"}]);expect(result.totals.some(metric=>metric.name==="output")).toBe(false);expect(store.query({to:sample.observedAt}).totals).toContainEqual({profileId:"p",scope:"turn",name:"output",unit:"tokens",value:"0"});db.close();
});
it("separates units and account periods from task usage and sums decimal deltas exactly",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);for(const [eventId,value] of [["a","0.1"],["b","0.2"]])store.record([{...sample,eventId,mode:"delta",metrics:[{name:"cost",value,unit:"USD"}]}],context);
 store.record([{...sample,eventId:"account",runId:undefined,sessionId:undefined,generation:undefined,turnId:undefined,scope:"account-period",metrics:[{name:"remaining",value:"900",unit:"credits"}]}],context);
 expect(store.query({runId:"r"}).totals).toEqual([{profileId:"p",scope:"turn",name:"cost",unit:"USD",value:"0.3"}]);expect(store.query({profileId:"p"}).totals).toContainEqual({profileId:"p",scope:"account-period",name:"remaining",unit:"credits",value:"900"});expect(store.query({from:"2026-10-16T13:00:00Z"}).observations).toEqual([]);db.close();
});
it("rejects foreign identities, conflicting event replay and invalid inclusion without persisting a partial batch",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([sample],context);expect(()=>store.record([{...sample,eventId:"new-valid"},{...sample,metrics:[{name:"input",value:"999",unit:"tokens"}]}],context)).toThrow();
 for(const invalid of [{...sample,profileId:"foreign"},{...sample,eventId:"bad",metrics:[{name:"cachedInput",value:"20",unit:"tokens",includedIn:"input"},{name:"input",value:"10",unit:"tokens"}]}])expect(()=>store.record([{...sample,eventId:"partial"},invalid],context)).toThrow();
 expect(db.listEntities("usage-observation")).toHaveLength(1);db.close();
});
it("orders snapshot timestamps by their instant rather than their written time zone",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([sample,{...sample,eventId:"earlier",observedAt:"2026-10-16T13:30:00+02:00",metrics:[{name:"input",value:"50",unit:"tokens"}]}],context);expect(store.query({runId:"r"}).totals).toContainEqual({profileId:"p",scope:"turn",name:"input",unit:"tokens",value:"100"});db.close();
});
it("binds standalone observations to their real session without inventing canonical Run or generation",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db),standalone={profileId:"p",runId:"native-operation",sessionId:"s",standalone:true as const},event={...sample,runId:"native-operation",generation:undefined};store.record([event],standalone);store.record([event],standalone);const saved=store.query({sessionId:"s"}).observations;expect(saved).toHaveLength(1);expect(saved[0]).toMatchObject({sessionId:"s",turnId:"turn-1"});expect(saved[0]).not.toHaveProperty("runId");expect(saved[0]).not.toHaveProperty("generation");expect(store.query({runId:"native-operation"}).observations).toHaveLength(0);expect(()=>store.record([{...event,eventId:"foreign",runId:"foreign"}],standalone)).toThrow();expect(()=>store.record([{...event,eventId:"run-scope",scope:"run"}],standalone)).toThrow();db.close();
});

const producer={id:"codex-exec:account-store-1",scope:"turn" as const};
const attributedContext={...context,attempt:1,nativeSessionId:"native-1",producer};
const attributed={...sample,attempt:1,nativeSessionId:"native-1",producerOrigin:{producerId:producer.id,eventId:"native-event-1"},occurredAt:"2026-10-16T11:59:00Z"};
const frozenPrice={version:1,id:"price",source:"native/account-model",collectedAt:"2026-10-16T11:00:00Z",unit:"credits",rates:{per:"1000",input:"0.1",output:"2",includesMultiplier:true}} as const;
function pricedRun(db:DispatcherDatabase,price:unknown=frozenPrice){const run={id:"r",taskId:"task",profileId:"p",providerId:"codex",runnerId:"local",sessionId:"s",providerSessionId:"native-1",generation:1,attempt:1,leaseId:"lease",state:"ACTIVE",executionSelection:{version:1,mode:"manual",source:"explicit",profileId:"p",providerId:"codex",runnerId:"local",backendId:"codex-exec-json",selectionType:"explicit-model",requestedModel:"model",nativeParameters:{},contextFingerprint:"original-account",catalogRevision:"original-catalog",configRevision:1,selectedAt:"2026-10-16T11:00:00Z",...(price?{pricingSnapshot:price}:{})}};db.saveEntity("run","r",run as never);return run;}
it("projects a frozen Run estimate from the canonical ledger alongside actual cost without reading current prices",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);const run=pricedRun(db);store.record([{...sample,metrics:[{name:"input",value:"100",unit:"tokens"},{name:"output",value:"0",unit:"tokens"},{name:"cost",value:"0",unit:"USD"}]}],context);db.saveEntity("model-catalog","current",{pricingSnapshot:{...frozenPrice,rates:{per:"1000",input:"999",includesMultiplier:true}}});db.saveEntity("resource-snapshot","p",{state:"QUOTA_EXHAUSTED"});
 const result=store.query({runId:"r"});expect(result.estimation).toMatchObject({status:"partial",estimate:{value:"0.01",unit:"credits",formulaVersion:"native-usage-decimal-v1",pricingSnapshot:frozenPrice,inputs:[{eventId:sample.eventId}],rounding:{scale:18,mode:"half-up"}}});expect(result.totals).toContainEqual({profileId:"p",scope:"turn",name:"cost",value:"0",unit:"USD"});expect(db.getEntity("resource-snapshot","p")).toEqual({state:"QUOTA_EXHAUSTED"});
 expect(()=>db.saveEntity("run","r",{...run,executionSelection:{...run.executionSelection,pricingSnapshot:undefined}} as never)).toThrow();db.close();
});
it("maps only admitted native occurrence to the frozen price interval and rejects foreign attempt facts",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);pricedRun(db,{...frozenPrice,validFrom:"2026-10-16T11:00:00Z",validUntil:"2026-10-16T12:00:00Z"});store.record([{...attributed,observedAt:"2026-10-17T12:00:00Z",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"output",value:"0",unit:"tokens"}]}],attributedContext);expect(store.query({runId:"r"}).estimation).toMatchObject({estimate:{value:"0.01",billingTimes:[{occurredAt:attributed.occurredAt}]}});db.close();
 const missing=new DispatcherDatabase(":memory:"),legacy=new UsageObservations(missing);pricedRun(missing,{...frozenPrice,validUntil:"2026-10-17T00:00:00Z"});legacy.record([sample],context);expect(legacy.query({runId:"r"}).estimation).toMatchObject({status:"unavailable",reasonCode:"PRICE_TIME_UNPROVEN"});expect(legacy.query({runId:"r",profileId:"another"}).estimation).toMatchObject({status:"unavailable",reasonCode:"RUN_USAGE_CONTEXT_MISMATCH"});missing.close();
});
it("downgrades a complete frozen estimate while native collection fails and restores it only after resolution",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);try{pricedRun(db);store.record([{...sample,scope:"run",turnId:undefined,metrics:[{name:"input",value:"100",unit:"tokens"},{name:"output",value:"0",unit:"tokens"}]}],context);
  expect(store.query({runId:"r"}).estimation).toMatchObject({status:"available",estimate:{value:"0.01",completeness:"complete"}});
  db.saveEntity("usage-error","other",{runId:"other",profileId:"p",status:"unknown",reasonCode:"USAGE_EVENT_CONFLICT"});expect(store.query({runId:"r"}).estimation.status).toBe("available");
  for(const reasonCode of ["USAGE_PARTIAL","USAGE_UNAVAILABLE","USAGE_NOT_REPORTED","USAGE_SHUTDOWN_PENDING"]){db.saveEntity("usage-error","r",{runId:"r",profileId:"p",status:"unknown",reasonCode,observedAt:"2026-10-16T12:01:00Z"});expect(store.query({runId:"r"}).estimation).toMatchObject({status:"partial",reasonCode,estimate:{value:"0.01",completeness:"partial",reason:reasonCode,inputs:[{eventId:sample.eventId}]}});}
  db.saveEntity("usage-error","r",{runId:"r",profileId:"p",status:"resolved",observedAt:"2026-10-16T12:02:00Z"});expect(store.query({runId:"r"}).estimation).toMatchObject({status:"available",estimate:{value:"0.01",completeness:"complete"}});
 }finally{db.close();}
});
it("withholds an estimate while unresolved usage identity or event conflicts undermine its basis",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);try{pricedRun(db);store.record([{...sample,scope:"run",turnId:undefined}],context);
  for(const reasonCode of ["USAGE_INVALID","USAGE_EVENT_CONFLICT","USAGE_SOURCE_CHANGED"]){db.saveEntity("usage-error","r",{runId:"r",profileId:"p",status:"unknown",reasonCode});expect(store.query({runId:"r"}).estimation).toEqual({status:"unavailable",reasonCode});}
  db.saveEntity("usage-error","r",{runId:"r",profileId:"p",status:"resolved"});expect(store.query({runId:"r"}).estimation.status).toBe("available");
 }finally{db.close();}
});
it("does not label previous Run usage complete while a new read is pending or its source changed",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);try{pricedRun(db);store.record([{...sample,scope:"run",turnId:undefined}],context);
  db.saveEntity("usage-read-state","r",{runId:"r",profileId:"p",sessionId:"s",state:"pending"});expect(store.query({runId:"r"}).estimation).toMatchObject({status:"partial",reasonCode:"USAGE_READ_PENDING",estimate:{value:"0.01",completeness:"partial"}});
  db.saveEntity("usage-error","r",{runId:"r",profileId:"p",status:"unknown",reasonCode:"USAGE_PARTIAL"});
  db.saveEntity("usage-read-state","r",{runId:"r",profileId:"p",sessionId:"s",state:"unknown",reasonCode:"USAGE_SOURCE_CHANGED"});expect(store.query({runId:"r"}).estimation).toEqual({status:"unavailable",reasonCode:"USAGE_SOURCE_CHANGED"});
  db.saveEntity("usage-read-state","r",{runId:"r",profileId:"p",sessionId:"s",state:"complete"});db.saveEntity("usage-error","r",{status:"resolved"});expect(store.query({runId:"r"}).estimation.status).toBe("available");
 }finally{db.close();}
});
it("retains admitted producer, attempt and native billing time separately from collection time",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db,()=>new Date("2026-10-22T12:00:00Z"));
 store.record([attributed],attributedContext);
 expect(store.query({runId:"r"}).observations).toEqual([{...attributed,collectedAt:"2026-10-22T12:00:00.000Z"}]);
 store.record([{...attributed,eventId:"no-billing-time",producerOrigin:{...attributed.producerOrigin,eventId:"native-event-2"},occurredAt:undefined}],attributedContext);
 expect(store.query({runId:"r"}).observations.find(value=>value.eventId==="no-billing-time")).not.toHaveProperty("occurredAt");db.close();
});
it("deduplicates proven producer origins across collectors without rewriting the first observation",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);expect(store.record([attributed],attributedContext)).toBe(1);
 const original=db.listEntities("usage-observation");
 const restored=new UsageObservations(db);
 expect(restored.record([{...attributed,eventId:"query-copy",source:"native-query",observedAt:"2026-10-22T12:01:00Z"}],attributedContext)).toBe(0);
 expect(db.listEntities("usage-observation")).toEqual(original);
 expect(restored.query({runId:"r"}).totals).toContainEqual({profileId:"p",scope:"turn",name:"input",unit:"tokens",value:"100",producerId:producer.id});db.close();
});
it("rejects producer replay with conflicting quantity or execution ownership atomically",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([attributed],attributedContext);
 const original=db.listEntities("usage-observation");
 const valid={...attributed,eventId:"new",producerOrigin:{...attributed.producerOrigin,eventId:"new-origin"}};
 expect(()=>store.record([valid,{...attributed,eventId:"conflict",metrics:[{name:"input",value:"999",unit:"tokens"}]}],attributedContext)).toThrowError(expect.objectContaining({code:"USAGE_EVENT_CONFLICT"}));
 expect(()=>store.record([{...attributed,eventId:"other-attempt",attempt:2}],{...attributedContext,attempt:2})).toThrowError(expect.objectContaining({code:"USAGE_EVENT_CONFLICT"}));
 expect(db.listEntities("usage-observation")).toEqual(original);db.close();
});
it("requires owning producer and execution evidence instead of trusting fields supplied by a collector",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);
 expect(()=>store.record([attributed],context)).toThrow();
 for(const value of [
  {...attributed,attempt:2},{...attributed,nativeSessionId:"foreign"},
  {...attributed,producerOrigin:{producerId:"foreign",eventId:"native-event-1"}},
  {...attributed,producerOrigin:{producerId:producer.id,eventId:"native-event-1",extra:true}},
  {...attributed,scope:"run"},{...attributed,occurredAt:"invalid"},
  {...attributed,attempt:0},{...attributed,runId:"foreign"},{...attributed,generation:2},
 ])expect(()=>store.record([value],attributedContext)).toThrow();
 expect(db.listEntities("usage-observation")).toEqual([]);db.close();
});
it("keeps cumulative snapshots from separate attempts and native producers from replacing one another",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([attributed],attributedContext);
 store.record([{...attributed,eventId:"attempt-2",attempt:2,producerOrigin:{...attributed.producerOrigin,eventId:"native-event-2"},observedAt:"2026-10-16T12:01:00Z",metrics:[{name:"input",value:"120",unit:"tokens"}]}],{...attributedContext,attempt:2});
 store.record([{...attributed,eventId:"other-producer",producerOrigin:{producerId:"other-producer",eventId:"native-event-1"},metrics:[{name:"input",value:"7",unit:"tokens"}]}],{...attributedContext,producer:{...producer,id:"other-producer"}});
 const totals=store.query({runId:"r"}).totals.filter(value=>value.name==="input");
 expect(totals).toEqual(expect.arrayContaining([
  {profileId:"p",scope:"turn",name:"input",unit:"tokens",value:"220",producerId:producer.id},
  {profileId:"p",scope:"turn",name:"input",unit:"tokens",value:"7",producerId:"other-producer"},
 ]));expect(totals).toHaveLength(2);db.close();
});
it("never enriches or aliases an immutable historical event with unproven producer identity",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([sample],context);const original=db.listEntities("usage-observation");
 expect(()=>store.record([attributed],attributedContext)).toThrowError(expect.objectContaining({code:"USAGE_EVENT_CONFLICT"}));
 expect(db.listEntities("usage-observation")).toEqual(original);expect(store.query().observations[0]).not.toHaveProperty("attempt");expect(store.query().observations[0]).not.toHaveProperty("producerOrigin");db.close();
});
it("rejects run provenance on account or standalone scope without fabricating canonical ownership",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);
 const account={...attributed,scope:"account-period",runId:undefined,sessionId:undefined,generation:undefined,turnId:undefined};
 expect(()=>store.record([account],{...attributedContext,producer:{...producer,scope:"account-period" as const}})).toThrow();
 const standalone={profileId:"p",runId:"r",sessionId:"s",standalone:true as const,producer,nativeSessionId:"native-1"};
 expect(()=>store.record([{...attributed,generation:undefined}],standalone)).toThrow();
 expect(db.listEntities("usage-observation")).toEqual([]);db.close();
});
it("does not count one native producer event again when another canonical session claims it",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([attributed],attributedContext);
 expect(()=>store.record([{...attributed,eventId:"another-session-copy",sessionId:"s2"}],{...attributedContext,sessionId:"s2"})).toThrowError(expect.objectContaining({code:"USAGE_EVENT_CONFLICT"}));
 expect(store.query().observations).toHaveLength(1);db.close();
});
it("retains the historical canonical event address for provenance-bearing observations",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new UsageObservations(db);store.record([attributed],attributedContext);
 // Existing readers locate an event by this unchanged profile/session/event contract.
 const legacyAddress=contentHash({profileId:"p",sessionId:"s",eventId:"event-1"});
 expect(db.getEntity("usage-observation",legacyAddress)).toMatchObject({eventId:"event-1",producerOrigin:attributed.producerOrigin});db.close();
});
it("prevents an already-open pre-origin writer from materializing a deduplicated collector alias",()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-usage-alias-writer-")),path=join(root,"db.sqlite"),old=new DispatcherDatabase(path,migrations.filter(m=>m.version<=9));
 try{const db=new DispatcherDatabase(path);try{const store=new UsageObservations(db),copy={...attributed,eventId:"query-copy",source:"native-query" as const};expect(store.record([attributed,copy],attributedContext)).toBe(1);
  expect(()=>old.saveEntity("usage-observation",contentHash({profileId:"p",sessionId:"s",eventId:copy.eventId}),{...copy,collectedAt:sample.observedAt})).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(store.query().observations).toHaveLength(1);
 }finally{db.close();}}finally{old.close();rmSync(root,{recursive:true,force:true});}
});
it("uses producer occurrence for snapshot replacement regardless of which collector arrives first",()=>{
 const copy={...attributed,eventId:"query-copy",source:"native-query",observedAt:"2026-10-16T12:03:00Z"},delta={...attributed,eventId:"delta",producerOrigin:{...attributed.producerOrigin,eventId:"native-delta"},mode:"delta",occurredAt:"2026-10-16T12:01:00Z",observedAt:"2026-10-16T12:02:00Z",metrics:[{name:"input",value:"20",unit:"tokens"}]};
 for(const first of [[attributed,copy],[copy,attributed]]){const db=new DispatcherDatabase(":memory:");try{const store=new UsageObservations(db);store.record([...first,delta],attributedContext);expect(store.query().totals).toContainEqual({profileId:"p",scope:"turn",name:"input",unit:"tokens",value:"120",producerId:producer.id});}finally{db.close();}}
});
it("withholds totals with ambiguous native snapshot order instead of ordering by collector time",()=>{
 for(const occurredAt of [undefined,attributed.occurredAt]){const db=new DispatcherDatabase(":memory:");try{const store=new UsageObservations(db);store.record([attributed,{...attributed,eventId:"delta",producerOrigin:{...attributed.producerOrigin,eventId:"native-delta"},mode:"delta",occurredAt,observedAt:"2026-10-16T12:02:00Z"}],attributedContext);expect(store.query()).toMatchObject({totals:[],estimation:{status:"unavailable",reasonCode:"USAGE_ORDER_UNPROVEN"}});expect(store.query().observations).toHaveLength(2);}finally{db.close();}}
});
