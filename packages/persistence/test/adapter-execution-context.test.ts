import {expect,it} from "vitest";
import {DispatcherDatabase,type JsonValue} from "../src/index.js";
it.each(["execution","executionRef"])("keeps an adapter's established %s immutable without blocking ordinary lifecycle updates",field=>{
 const db=new DispatcherDatabase(":memory:");
 const session={id:"s",runId:"r",profileId:"p",backendId:"cli",workspacePath:"/work",state:"RUNNING",legacyModel:{},execution:{generation:2,attempt:3,leaseId:"lease"},executionRef:{version:1,id:"e",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"work",pathRef:"workspace:work",branch:"task/r",baseRevision:"base"}};
 try{db.saveEntity("adapter-session","s",session);const changed=structuredClone(session) as Record<string,JsonValue>;delete changed[field];
  expect(()=>db.saveEntity("adapter-session","s",changed)).toThrowError(expect.objectContaining({code:"IMMUTABLE_EXECUTION_CONTEXT"}));
  expect(db.getEntity("adapter-session","s")).toEqual(session);
  db.saveEntity("adapter-session","s",{...session,state:"PAUSED"});expect(db.getEntity("adapter-session","s")).toMatchObject({state:"PAUSED",execution:session.execution,executionRef:session.executionRef});
 }finally{db.close();}
});
