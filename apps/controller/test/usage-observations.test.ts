import {expect,it} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {UsageObservations} from "../src/usage-observations.js";
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
