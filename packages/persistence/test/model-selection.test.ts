import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { DispatcherDatabase, migrations, type JsonValue } from "../src/index.js";
import type { LegacyRunModelSelection } from "@dispatcher/domain";

const selection:LegacyRunModelSelection={version:1,profileId:"account",providerId:"codex",backendId:"codex-exec-json",nativeSelectionId:"model",kind:"model",source:"explicit",context:{repositoryId:"repo",baseRevision:"abc",configRevision:1},catalogVersion:"catalog",selectedAt:"now",reasoning:{mode:"native-default"}};
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;

it("preserves old database records and frozen selection across restart without inventing missing values",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-model-db-"));const path=join(directory,"dispatcher.sqlite");
  try{
    const old=new DispatcherDatabase(path,[migrations[0]!,migrations[1]!]);old.saveEntity("run","legacy",{id:"legacy",state:"ACTIVE"});old.close();
    const upgraded=new DispatcherDatabase(path);expect(upgraded.getEntity("run","legacy")).toEqual({id:"legacy",state:"ACTIVE"});
    upgraded.saveEntity("run","selected",json({id:"selected",state:"STARTING",modelSelection:selection}));
    upgraded.saveEntity("run","selected",json({id:"selected",state:"ACTIVE",modelSelection:selection}));
    expect(()=>upgraded.saveEntity("run","selected",json({id:"selected",state:"ACTIVE",modelSelection:{...selection,nativeSelectionId:"changed"}}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_RUN_SELECTION"}));
    expect(()=>upgraded.saveEntity("run","selected",{id:"selected",state:"ACTIVE"})).toThrowError(expect.objectContaining({code:"IMMUTABLE_RUN_SELECTION"}));
    upgraded.close();const restored=new DispatcherDatabase(path);
    expect(restored.getEntity("run","selected")).toEqual(json({id:"selected",state:"ACTIVE",modelSelection:selection}));
    expect(restored.schemaVersion()).toBe(18);expect(restored.integrityCheck()).toBe(true);restored.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("freezes decision input and consumption history with its Run reference",()=>{
  const database=new DispatcherDatabase(":memory:");
  try{
    const decision={id:"decision",status:"ready",inputDigest:"raw",selection};database.saveEntity("model-routing-decision","decision",json(decision));
    expect(()=>database.saveEntity("model-routing-decision","decision",json({...decision,inputDigest:"changed"}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_ROUTING_DECISION"}));
    const consumed={...decision,status:"consumed",runId:"run",consumedAt:"now",confirmation:{mode:"explicit-selection"}};database.saveEntity("model-routing-decision","decision",json(consumed));
    expect(()=>database.saveEntity("model-routing-decision","decision",json({...consumed,runId:"another"}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_ROUTING_DECISION"}));
    database.saveEntity("run","run",{id:"run",modelRoutingDecision:{id:"decision",source:"keyword"}});
    expect(()=>database.saveEntity("run","run",{id:"run",modelRoutingDecision:{id:"other",source:"keyword"}})).toThrowError(expect.objectContaining({code:"IMMUTABLE_ROUTING_DECISION"}));
  }finally{database.close();}
});
it("freezes new execution context while allowing old Runs to remain without one",()=>{
  const database=new DispatcherDatabase(":memory:");
  const executionRef={version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"};
  try{
    database.saveEntity("run","run",json({id:"run",state:"STARTING",executionRef}));
    database.saveEntity("run","run",json({id:"run",state:"ACTIVE",executionRef}));
    expect(()=>database.saveEntity("run","run",json({id:"run",state:"ACTIVE",executionRef:{...executionRef,pathRef:"changed"}}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_EXECUTION_CONTEXT"}));
    expect(()=>database.saveEntity("run","run",{id:"run",state:"ACTIVE"})).toThrowError(expect.objectContaining({code:"IMMUTABLE_EXECUTION_CONTEXT"}));
    database.saveEntity("run","legacy",{id:"legacy",state:"ACTIVE"});expect(database.getEntity("run","legacy")).toEqual({id:"legacy",state:"ACTIVE"});
  }finally{database.close();}
});
