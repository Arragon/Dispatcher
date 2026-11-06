import {execFileSync} from "node:child_process";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {EncryptedLocalSecretStore} from "@dispatcher/config";
import {ControllerService} from "../src/service.js";

it("keeps a retained native execution pinned through the Controller while retiring an independent worktree",async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-retention-owner-"))),repo=join(root,"repo");mkdirSync(repo);
 const git=(args:string[])=>execFileSync("git",["-C",repo,...args],{encoding:"utf8",stdio:"pipe"});
 git(["init","-b","main"]);git(["config","user.name","Dispatcher Test"]);git(["config","user.email","test@example.invalid"]);writeFileSync(join(repo,"file.txt"),"baseline\n");git(["add","file.txt"]);git(["commit","-m","fixture"]);
 const service=new ControllerService({dataDirectory:join(root,"data"),ownerToken:"fixture-owner",secretStore:new EncryptedLocalSecretStore(join(root,"vault"),"fixture-retention-master")});
 try{
  await service.start({listen:false});
  const config=structuredClone(service.configuration.current().config);config.repositories=[{id:"repo",root:repo,defaultBaseRef:"main",scopePaths:["."],verificationCommands:[]}];service.configuration.applyPlan(service.configuration.buildPlan(config,"owner","retention fixture").id,{confirmed:true});
  const workspace=await service.workspaces.create({repositoryId:"repo",taskId:"native",runId:"native",attempt:1,baseRef:"main",scopePaths:["."]});
  service.database.saveEntity("adapter-session","retained-session",{id:"retained-session",runId:"native",profileId:"retained",providerSessionId:"native-existing",state:"COMPLETE"});
  const preview=await service.workspaces.cleanupPlan(workspace);expect(preview).toMatchObject({safe:false,pins:[{workspaceId:"native",sessionId:"retained-session",reason:"NATIVE_SESSION_REFERENCE"}]});
  await expect(service.workspaces.cleanup({...preview,safe:true})).rejects.toMatchObject({code:"UNSAFE_CLEANUP"});expect(readFileSync(join(workspace.path,"file.txt"),"utf8")).toBe("baseline\n");
  const independent=await service.workspaces.create({repositoryId:"repo",taskId:"verification",runId:"independent",attempt:1,baseRef:"main",scopePaths:["."]});
  const retired=await service.workspaces.cleanup(await service.workspaces.cleanupPlan(independent));expect(retired.state).toBe("retained");expect(existsSync(independent.path)).toBe(false);expect(readFileSync(join(retired.retainedPath,"file.txt"),"utf8")).toBe("baseline\n");expect(existsSync(workspace.path)).toBe(true);
 }finally{await service.stop();rmSync(root,{recursive:true,force:true});}
});
