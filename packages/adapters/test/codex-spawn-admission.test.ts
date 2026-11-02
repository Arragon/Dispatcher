import {chmodSync,existsSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {CodexAppServerBackend,codexAppServerProtocolVersion} from "../src/codex-app-server.js";
import * as versionProbe from "../src/native-version-probe.js";

it.each(["revoked","async"] as const)("retains exact default backend %s spawn admission without acquiring a probe",async mode=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"codex-spawn-admission-"))),executable=join(root,"native.cjs"),marker=join(root,"started"),held=Promise.withResolvers<void>();
 writeFileSync(executable,"#!"+process.execPath+"\nrequire('node:fs').writeFileSync("+JSON.stringify(marker)+",'started');\n");chmodSync(executable,0o700);
 const callback=()=>{if(mode==="revoked")throw Error("revoked");return held.promise;};
 const backend=new CodexAppServerBackend({profileId:"p",runnerId:"local",nativeStoreRef:"store",scopeFingerprint:"scope",executionRefId:"execution",codexHome:root,workspacePath:root,executable,approvalPolicy:"on-request",sandbox:"workspace-write"},undefined,undefined,callback);
 const probe=vi.spyOn(versionProbe,"readOwnedNativeVersion").mockResolvedValue(`codex-cli ${codexAppServerProtocolVersion}`);
 const turn=backend.start({executable,codexHome:root,workspacePath:root,prompt:"fixture",model:"model",commandId:"command",executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"codex/run",baseRevision:"sha"},executionSelection:{version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",profileId:"p",providerId:"codex",backendId:"codex-app-server",runnerId:"local",requestedModel:"model",nativeParameters:{},contextFingerprint:"scope",configRevision:1,selectedAt:"2026-10-24T00:00:00Z"},beforePrompt:()=>{},onBinding:()=>{},onNativeEvent:()=>{}});
 try{await expect(turn.ready()).rejects.toThrow();await expect(turn.result()).resolves.toMatchObject({state:"failed"});expect(probe.mock.calls.length).toBe(0);expect(existsSync(marker)).toBe(false);if(mode==="async"){expect(backend.hasActiveOperations()).toBe(true);expect((await backend.disconnectLocal()).callbacks).toBe("unknown");held.resolve();await vi.waitFor(()=>expect(backend.hasActiveOperations()).toBe(false));expect((await backend.disconnectLocal()).callbacks).toBe("unknown");}}
 finally{held.resolve();await backend.disconnectLocal();probe.mockRestore();rmSync(root,{recursive:true,force:true});}
});
