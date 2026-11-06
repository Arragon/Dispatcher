import {expect,it} from "vitest";
import {estimateCost,type PricingSnapshotV1,type BillingTimeEvidence} from "../src/metering.js";
import type {UsageObservationV1} from "../src/usage.js";
const at="2026-10-20T12:00:00Z";
const usage=(change:Partial<UsageObservationV1>={}):UsageObservationV1=>({version:1,eventId:"e",profileId:"p",runId:"r",sessionId:"s",generation:1,turnId:"t",scope:"turn",mode:"snapshot",source:"native-event",observedAt:at,collectedAt:at,completeness:"complete",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens",includedIn:"input"},{name:"output",value:"10",unit:"tokens"}],...change});
const price=(change:Partial<PricingSnapshotV1>={}):PricingSnapshotV1=>({version:1,id:"price",source:"native/model",collectedAt:at,unit:"USD",currency:"USD",rates:{per:"1000",input:"2",output:"4",cacheRead:"0.5",includesMultiplier:true},...change});
const calc=(measurements=[usage()],pricing:PricingSnapshotV1|undefined=price(),extras:Partial<Parameters<typeof estimateCost>[0]>={})=>estimateCost({runId:"r",observations:measurements,pricing,calculatedAt:at,...extras});
const time=(eventId:string,occurredAt=at):BillingTimeEvidence=>({eventId,profileId:"p",sessionId:"s",occurredAt,source:"native/billed-event"});
it("reuses separate cache rates without double billing and never reapplies final multipliers",()=>{
 expect(calc([usage()],price({multiplier:"10"}))).toMatchObject({value:"0.135",completeness:"partial",formulaVersion:"native-usage-decimal-v1",pricingSnapshot:{id:"price"}});
 expect(calc([usage()],price({rates:{per:"1000000",input:"2",output:"4",includesMultiplier:true}})).value).toBe("0.00024");
 expect(calc([usage()],price({multiplier:"3",rates:{per:"1000",input:"2",output:"4",cacheRead:"0.5",includesMultiplier:false}})).value).toBe("0.405");
});
it("preserves exact large amounts and rounds only once at the result boundary",()=>{
 const u=usage({scope:"run",metrics:[{name:"input",value:"9007199254740993",unit:"tokens"}]});
 expect(calc([u],price({rates:{per:"1",input:"0.1",includesMultiplier:true}}))).toMatchObject({value:"900719925474099.3",rounding:{scale:18,mode:"half-up",applied:false}});
 const third=price({rates:{per:"3",input:"1",includesMultiplier:true}}),one=usage({metrics:[{name:"input",value:"1",unit:"tokens"}]});
 expect(calc([one],third)).toMatchObject({value:"0.333333333333333333",rounding:{applied:true}});
 expect(calc([one,usage({...one,eventId:"two",turnId:"t2"}),usage({...one,eventId:"three",turnId:"t3"})],third).value).toBe("1");
});
it("deduplicates replay, rejects changed identity and replaces older snapshots without adding overlapping deltas",()=>{
 expect(calc([usage(),usage()]).value).toBe("0.135");
 expect(calc([usage(),usage({metrics:[]})])).toMatchObject({completeness:"unavailable",reason:"EVENT_ID_CONFLICT"});
 expect(calc([usage({eventId:"older",observedAt:"2026-10-20T11:00:00Z"}),usage(),usage({eventId:"overlap",mode:"delta",observedAt:"2026-10-20T11:30:00Z"})]).value).toBe("0.135");
});
it("sums identified turns and later deltas but excludes session/account data and overlapping run/turn scopes",()=>{
 expect(calc([usage(),usage({eventId:"later",mode:"delta",observedAt:"2026-10-20T12:01:00Z"})]).value).toBe("0.27");
 expect(calc([usage(),usage({eventId:"t2",turnId:"two"})]).value).toBe("0.27");
 expect(calc([usage(),usage({eventId:"session",scope:"session"}),usage({eventId:"account",scope:"account-period",runId:undefined,sessionId:undefined,generation:undefined})]).value).toBe("0.135");
 expect(calc([usage(),usage({eventId:"run",scope:"run",turnId:undefined})])).toMatchObject({value:"0.135",completeness:"partial"});
});
it("preserves missing versus zero and keeps missing price/basis/multiplier unavailable",()=>{
 expect(calc([usage()],undefined,{pricing:undefined})).toMatchObject({completeness:"unavailable",reason:"PRICE_NOT_PROVIDED"});
 expect(calc([])).toMatchObject({completeness:"unavailable",reason:"USAGE_NOT_PROVIDED"});
 expect(calc([usage({metrics:[]})])).toMatchObject({completeness:"unavailable",reason:"USAGE_DIMENSIONS_NOT_PROVIDED"});
 expect(calc([usage({metrics:[{name:"output",value:"0",unit:"tokens"}]})])).toMatchObject({value:"0",completeness:"partial",missingDimensions:expect.arrayContaining(["input","cacheRead"])});
 expect(calc([usage()],price({rates:undefined,multiplier:"2"}))).toMatchObject({reason:"BILLING_BASIS_NOT_PROVIDED"});
 expect(calc([usage()],price({rates:{per:"1000",input:"2",includesMultiplier:false}}))).toMatchObject({reason:"MULTIPLIER_NOT_PROVIDED"});
});
it("uses explicit base consumption and conditional free evidence",()=>{
 const base=usage({scope:"run",metrics:[{name:"baseConsumption",value:"3",unit:"credits"}]});
 expect(calc([base],price({unit:"credits",currency:undefined,rates:undefined,multiplier:"2"}))).toMatchObject({value:"6",completeness:"complete"});
 const free=price({free:true,conditions:["allowance remains"]});
 expect(calc([usage()],free)).toMatchObject({reason:"CONDITIONS_UNCONFIRMED"});
 expect(calc([usage()],free,{conditionEvidence:[{condition:"allowance remains",source:"native/allowance",collectedAt:at}]}).value).toBe("0");
 expect(calc([usage()],free,{conditionEvidence:[{condition:"allowance remains",source:"native/allowance",collectedAt:"now"}]})).toMatchObject({reason:"CONDITIONS_UNCONFIRMED"});
});
it("requires explicit cache inclusion and validates quantities, units and context",()=>{
 expect(calc([usage({metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens"}]})])).toMatchObject({reason:"CACHE_INCLUSION_UNCONFIRMED"});
 for(const change of [{runId:"foreign"},{metrics:[{name:"input",value:"NaN",unit:"tokens"}]},{metrics:[{name:"input",value:"1",unit:"tokens"},{name:"cachedInput",value:"2",unit:"tokens",includedIn:"input"}]},{metrics:[{name:"input",value:"1",unit:"credits"}]}])expect(calc([usage(change)])).toMatchObject({completeness:"unavailable"});
 expect(calc([usage(),usage({eventId:"other-source",turnId:"t2",source:"native-query"})])).toMatchObject({reason:"USAGE_BASIS_AMBIGUOUS"});
});
it("refuses duplicate metrics, incomparable attempts and tied conflicting snapshots",()=>{
 expect(calc([usage({metrics:[{name:"input",value:"1",unit:"tokens"},{name:"input",value:"1",unit:"tokens"}]})])).toMatchObject({reason:"USAGE_INVALID"});
 expect(calc([usage(),usage({eventId:"generation2",generation:2})])).toMatchObject({reason:"USAGE_BASIS_AMBIGUOUS"});
 expect(calc([usage(),usage({eventId:"tie",metrics:[{name:"input",value:"150",unit:"tokens"}]})])).toMatchObject({reason:"SNAPSHOT_ORDER_AMBIGUOUS"});
});
it("maps actual billing instants into nonoverlapping intervals without using observation time",()=>{
 const segments=[{startsAt:"2026-10-20T11:00:00Z",endsAt:"2026-10-20T12:01:00Z",source:"native/change",pricing:price()},{startsAt:"2026-10-20T12:01:00Z",source:"native/change",pricing:price({id:"new",rates:{per:"1000",input:"4",output:"8",cacheRead:"1",includesMultiplier:true}})}];
 expect(calc([usage()],price(),{segments})).toMatchObject({reason:"RATE_INTERVAL_UNMAPPED"});
 expect(calc([usage(),usage({eventId:"e2",turnId:"t2"})],price(),{segments,billingTimes:[time("e"),time("e2","2026-10-20T12:02:00Z")]})).toMatchObject({value:"0.405",segments:expect.arrayContaining([expect.objectContaining({eventIds:["e2"],value:"0.27"})])});
 expect(calc([usage()],price(),{segments:[segments[0]!,{...segments[1]!,startsAt:"2026-10-20T11:30:00Z"}],billingTimes:[time("e")]})).toMatchObject({reason:"RATE_INTERVAL_UNMAPPED"});
 expect(calc([usage()],price(),{segments:[segments[0]!,{...segments[1]!,pricing:price({unit:"EUR",currency:"EUR"})}],billingTimes:[time("e")]})).toMatchObject({reason:"RATE_INTERVAL_BASIS_INCOMPLETE"});
});
it("rejects expired/unmapped price validity and malformed decimal rate inputs",()=>{
 const dated=price({validUntil:"2026-10-20T12:00:00Z"});
 expect(calc([usage()],dated)).toMatchObject({reason:"PRICE_TIME_UNPROVEN"});
 expect(calc([usage()],dated,{billingTimes:[time("e")]})).toMatchObject({reason:"PRICE_OUTSIDE_VALIDITY"});
 for(const per of ["0","-1","1e3","1.1234567890123456789"])expect(calc([usage()],price({rates:{per,input:"2",includesMultiplier:true}}))).toMatchObject({reason:"INVALID_PRICE"});
});

it("keeps explicit excluded-cache evidence distinct from omitted inclusion and rejects conflicting proofs",()=>{
 const u=usage({metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens"},{name:"output",value:"10",unit:"tokens"}]});
 const proof={eventId:"e",profileId:"p",sessionId:"s",source:"native/billing",metric:"cachedInput" as const,includedInInput:false};
 expect(calc([u],price(),{cacheInclusion:[proof]}).value).toBe("0.275");
 expect(calc([usage()],price(),{cacheInclusion:[proof]})).toMatchObject({reason:"CACHE_INCLUSION_UNCONFIRMED"});
});

it("bills separate cache write quantities once and refuses impossible combined inclusion",()=>{
 const p=price({rates:{per:"1000",input:"2",cacheRead:"0.5",cacheWrite:"1",includesMultiplier:true}});
 const u=usage({metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"60",unit:"tokens",includedIn:"input"},{name:"cacheWrite",value:"10",unit:"tokens",includedIn:"input"}]});
 expect(calc([u],p).value).toBe("0.1");
 expect(calc([usage({...u,metrics:[...u.metrics.slice(0,2),{name:"cacheWrite",value:"50",unit:"tokens",includedIn:"input"}]})],p)).toMatchObject({reason:"CACHE_EXCEEDS_INPUT"});
});

it("refuses cost aggregation across attempt, native session or producer provenance",()=>{
 const first={...usage(),attempt:1,nativeSessionId:"native-1",producerOrigin:{producerId:"producer-1",eventId:"native-event-1"}};
 for(const change of [{attempt:2},{nativeSessionId:"native-2"},{producerOrigin:{producerId:"producer-2",eventId:"native-event-2"}}]){
  expect(calc([first,{...first,eventId:"second",turnId:"second",...change}])).toMatchObject({completeness:"unavailable",reason:"USAGE_BASIS_AMBIGUOUS"});
 }
 expect(calc([first]).inputs).toEqual([first]);
});
it("refuses malformed or unproven optional usage provenance instead of calculating from it",()=>{
 for(const change of [{attempt:0},{attempt:1.5},{nativeSessionId:""},{producerOrigin:{producerId:"",eventId:"native-event"}},{producerOrigin:{producerId:"producer",eventId:"native-event",extra:true}},{occurredAt:at},{producerOrigin:{producerId:"producer",eventId:"native-event"},occurredAt:"invalid"}]){
  expect(calc([{...usage(),...change}])).toMatchObject({completeness:"unavailable",reason:"USAGE_INVALID"});
 }
});
it("counts proven producer aliases once and rejects conflicting same-origin quantities",()=>{
 const first=usage({mode:"delta",attempt:1,nativeSessionId:"native-1",producerOrigin:{producerId:"producer",eventId:"native-event"}}),copy={...first,eventId:"query-copy",observedAt:"2026-10-20T12:03:00Z"};
 for(const source of ["native-event","native-query"] as const)for(const observations of [[first,{...copy,source}],[{...copy,source},first]])expect(calc(observations).value).toBe("0.135");
 expect(calc([first,{...copy,metrics:[{name:"input",value:"999",unit:"tokens"}]}])).toMatchObject({completeness:"unavailable",reason:"EVENT_ID_CONFLICT"});
});
it("uses occurrence order for proven native snapshots and refuses missing or tied occurrence",()=>{
 const first=usage({producerOrigin:{producerId:"producer",eventId:"native-snapshot"},occurredAt:"2026-10-20T11:59:00Z"}),copy={...first,eventId:"query-copy",source:"native-query" as const,observedAt:"2026-10-20T12:03:00Z"},delta=usage({eventId:"delta",mode:"delta",producerOrigin:{producerId:"producer",eventId:"native-delta"},occurredAt:"2026-10-20T12:01:00Z",observedAt:"2026-10-20T12:02:00Z"});
 for(const observations of [[first,copy,delta],[copy,first,delta]])expect(calc(observations).value).toBe("0.27");
 for(const occurredAt of [undefined,first.occurredAt])expect(calc([first,{...delta,occurredAt}])).toMatchObject({completeness:"unavailable",reason:"USAGE_ORDER_UNPROVEN"});
});
