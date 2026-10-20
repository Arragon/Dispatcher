import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { ControllerService } from "../src/service.js";

it.each(["execution-context","control","binding","legacy-selection"])("does not restore native authority from %s before the control runtime is composed",kind=>{
  const dataDirectory=mkdtempSync(join(tmpdir(),"dispatcher-native-recovery-"));
  try {
    const db=new DispatcherDatabase(join(dataDirectory,"dispatcher.sqlite"));
    const run={id:"native-run",taskId:"task",runnerId:"local",providerId:"codex",profileId:"p",sessionId:"native-session",state:"ACTIVE",generation:1,attempt:1,leaseId:"lease",verification:{required:[],passed:[],failed:[],state:"PENDING"},...(kind==="execution-context"?{executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/native",baseRevision:"sha"}}:{})};
    db.saveEntity("session","native-session",{id:"native-session",profileId:"p"});
    if(kind==="control")db.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,2,2,'HUMAN','{}')").run("native-session","native-run");
    if(kind==="binding")db.handle.prepare("INSERT INTO native_bindings(session_id,binding_key,profile_id,execution_ref_id,document_json) VALUES(?,?,?,?,?)").run("native-session","key","p","execution","{}");
    const expectedRun={...run,...(kind==="legacy-selection"?{modelSelection:{version:1,profileId:"p",providerId:"codex",backendId:"exec",nativeSelectionId:"frozen-model",kind:"model",source:"explicit",catalogVersion:"catalog",selectedAt:"2026-10-20T00:00:00Z",reasoning:{mode:"native-default"},context:{repositoryId:"repo",baseRevision:"sha",configRevision:1}}}:{})};
    db.saveEntity("run","native-run",expectedRun);db.close();
    let service:ControllerService|undefined;
    try {
      expect(()=>{service=new ControllerService({dataDirectory,ownerToken:"test-owner",withRunner:true});}).toThrowError(expect.objectContaining({code:"NATIVE_CONTROL_RUNTIME_UNAVAILABLE"}));
    } finally {service?.database.close();}
    const verified=new DispatcherDatabase(join(dataDirectory,"dispatcher.sqlite"));
    try {expect(verified.getEntity("run","native-run")).toEqual(expectedRun);}finally{verified.close();}
  } finally {rmSync(dataDirectory,{recursive:true,force:true});}
});
