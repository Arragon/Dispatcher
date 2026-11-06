import {expect,it} from "vitest";
import {DispatcherDatabase} from "../src/index.js";

it("selects maintenance candidates before decoding while preserving global order and unknown active states",()=>{
  const database=new DispatcherDatabase(":memory:");
  try{
    const rows=[
      {id:"waiting",state:"WAITING_USER",runnerId:"local",profileId:"usage"},
      {id:"complete-pr",state:"COMPLETE",prUrl:"https://example.invalid/pr/1",profileId:"usage"},
      {id:"complete",state:"COMPLETE",profileId:"usage"},
      {id:"failed",state:"FAILED",runnerId:"local"},
      {id:"foreign",state:"ACTIVE",runnerId:"remote"},
      {id:"unknown",runnerId:"local"},
      {id:"empty-pr",state:"COMPLETE",prUrl:""},
    ];
    rows.forEach((row,index)=>database.saveEntity("run",row.id,row,new Date(Date.UTC(2026,9,22,0,index)).toISOString()));
    database.saveEntity("session","not-a-run",{id:"not-a-run",state:"WAITING_USER"});
    const ids=(filters:Parameters<typeof database.listRunsMatching>[0])=>database.listRunsMatching<{id:string}>(filters).map(row=>row.id);
    expect(ids([{states:["WAITING_USER","RESOURCE_BLOCKED","FAILED"]},{states:["COMPLETE"],hasPullRequest:true}])).toEqual(["failed","complete-pr","waiting"]);
    expect(ids([{excludedStates:["COMPLETE","FAILED","CANCELLED","SUPERSEDED"],runnerId:"local"}])).toEqual(["unknown","waiting"]);
    expect(ids([{profileIds:["usage"]}])).toEqual(["complete","complete-pr","waiting"]);
    expect(ids([{states:["COMPLETE"],hasPullRequest:true}])).toEqual(["complete-pr"]);
    expect(ids([{states:["WAITING_USER"]},{profileIds:["usage"]}])).toEqual(["complete","complete-pr","waiting"]);
    expect(ids([{profileIds:[]}])).toEqual([]);
    expect(ids([{states:[]}])).toEqual([]);
    expect(ids([])).toEqual([]);
    expect(ids([{profileIds:["usage') OR 1=1 --"]}])).toEqual([]);
  }finally{database.close();}
});
