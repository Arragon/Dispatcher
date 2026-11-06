import {expect,it} from "vitest";
import {readLegacyUsageMeasurement} from "../src/index.js";
const record={version:1,profileId:"p",runId:"r",sessionId:"s",nativeSessionId:"native",generation:2,attempt:3,eventId:"old-event",turnId:"old-turn",source:"codex-exec-json/turn.completed",collectedAt:"2026-10-20T00:00:00Z",occurredAt:"2026-10-19T23:59:00Z",unit:"tokens",scope:"turn",semantics:"cumulative",completeness:"complete",input:100,output:0,cacheRead:25,cacheReadIncludedInInput:true};
const read=(value:unknown=record)=>readLegacyUsageMeasurement({format:"legacy-usage-measurement-v1",recordId:"run-metering/r:g2:a3/0",record:value});
it("preserves historical source facts without making a second writable ledger",()=>{
 const original=structuredClone(record),result=read();expect(result.status).toBe("read-only");
 expect(result.evidence).toMatchObject({profileId:"p",runId:"r",sessionId:"s",nativeSessionId:"native",generation:2,attempt:3,eventId:"old-event",turnId:"old-turn",source:record.source,collectedAt:record.collectedAt,occurredAt:record.occurredAt,scope:"turn",mode:"snapshot"});
 expect(result.evidence?.metrics).toEqual([{name:"input",value:"100",unit:"tokens"},{name:"output",value:"0",unit:"tokens"},{name:"cacheRead",value:"25",unit:"tokens",includedIn:"input"}]);
 expect(result.diagnostics).toContain("LEGACY_NATIVE_EVENT_IDENTITY_UNPROVEN");expect(result.raw).toEqual(original);expect(record).toEqual(original);
 expect(result).not.toHaveProperty("observation");expect(result).not.toHaveProperty("total");
});
it("keeps collection time distinct from missing billing occurrence and metrics",()=>{
 const {occurredAt,output,cacheReadIncludedInInput,...incomplete}=record;void occurredAt;void output;void cacheReadIncludedInInput;
 const result=read(incomplete);expect(result.status).toBe("read-only");expect(result.evidence).not.toHaveProperty("occurredAt");expect(result.evidence?.metrics).not.toEqual(expect.arrayContaining([expect.objectContaining({name:"output"})]));
 expect(result.evidence?.metrics.find(metric=>metric.name==="cacheRead")).not.toHaveProperty("includedIn");expect(result.diagnostics).toContain("LEGACY_BILLING_TIME_UNKNOWN");
});
it("converts only the stored numeric representation and expands exponent notation without float arithmetic",()=>{
 const result=read({...record,unit:"credits",input:0.1+0.2,output:1e-7,cacheRead:undefined,cacheReadIncludedInInput:undefined,other:{smallest:1e-18}});
 expect(result.status).toBe("read-only");expect(result.evidence?.metrics).toEqual([{name:"input",value:"0.30000000000000004",unit:"credits"},{name:"output",value:"0.0000001",unit:"credits"},{name:"other.smallest",value:"0.000000000000000001",unit:"credits"}]);
 expect(result.diagnostics).toContain("LEGACY_STORED_NUMERIC_PRECISION_ONLY");
});
it("rejects ambiguous v1 shapes, foreign formats, unsafe numbers and invalid inclusion",()=>{
 for(const value of [{version:1,eventId:"v3",metrics:[]},{...record,input:Number.MAX_SAFE_INTEGER+1},{...record,input:NaN},{...record,output:Infinity},{...record,input:-1},{...record,input:0.5,cacheRead:undefined,cacheReadIncludedInInput:undefined},{...record,input:1e-19},{...record,cacheRead:101},{...record,cacheReadIncludedInInput:"true"},{...record,attempt:0},{...record,semantics:"delta"},{...record,occurredAt:"no-time"}]){const result=read(value);expect(result.status).toBe("invalid");expect(result.evidence).toBeUndefined();}
 expect(readLegacyUsageMeasurement({format:"usage-observation-v1" as "legacy-usage-measurement-v1",recordId:"x",record})).toMatchObject({status:"invalid",diagnostics:["LEGACY_SOURCE_FORMAT_REQUIRED"]});
});
it("freezes raw evidence and retains different source/attempt records for later origin reconciliation",()=>{
 const mutable={...record},first=read(mutable);mutable.input=999;expect(first.raw).toMatchObject({input:100});
 const second=read({...record,attempt:4,source:"second-collector",semantics:"incremental"});expect(second.status).toBe("read-only");expect(second.evidence).toMatchObject({attempt:4,source:"second-collector",mode:"delta"});
 expect(second.diagnostics).toContain("LEGACY_NATIVE_EVENT_IDENTITY_UNPROVEN");expect(first.reference).toEqual({format:"legacy-usage-measurement-v1",recordId:"run-metering/r:g2:a3/0"});
});
