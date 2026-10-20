import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installLaunchAgent, launchdPlist,readLaunchAgent,statusLaunchAgent, startLaunchAgent,stopLaunchAgent,restartLaunchAgent,uninstallLaunchAgent,LaunchctlError,type LaunchctlExecutor } from "../src/launchd.js";
import {acquireInstanceLock} from "@dispatcher/persistence";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("launchd prototype", () => {
  it("generates a throttled Embedded Runner service without a crash loop", () => {
    const plist = launchdPlist({ nodePath: "/usr/local/bin/node", cliPath: "/opt/dispatcher/cli.js", dataDirectory: "/tmp/data", logDirectory: "/tmp/logs" });
    expect(plist).toContain("--with-runner");
    expect(plist).toContain("ThrottleInterval");
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
    expect(plist).toContain("<key>WorkingDirectory</key><string>/tmp/data</string>");
    expect(plist).toContain("<key>ExitTimeOut</key><integer>60</integer>");
  });

  it("writes the fixture and bootstraps the exact plist", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatcher-launchd-"));
    directories.push(root);
    const plistPath = join(root, "LaunchAgents", "dispatcher.plist");
    const executor = vi.fn(async (args:string[]) => {if(args[0]==="print")throw new LaunchctlError("print",113);return {stdout:"",stderr:""};});
    await installLaunchAgent({
      plistPath,
      nodePath: "/usr/local/bin/node",
      cliPath: "/opt/dispatcher/cli.js",
      dataDirectory: join(root, "data"),
      logDirectory: join(root, "logs"),
      executor,
    });
    expect(readFileSync(plistPath, "utf8")).toContain("dev.dispatcher.controller");
    expect(executor.mock.calls.map(([args])=>args[0])).toEqual(["print","enable","bootstrap"]);
  });

  it("retains a failed bootstrap for inspection instead of blindly stopping another service", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatcher-launchd-upgrade-"));
    directories.push(root);
    const plistPath = join(root, "LaunchAgents", "dispatcher.plist");
    const executor = vi.fn(async(args:string[])=>{if(args[0]==="print")throw new LaunchctlError("print",113);if(args[0]==="bootstrap")throw new LaunchctlError("bootstrap",5);return {stdout:"",stderr:""};});
    await expect(installLaunchAgent({
      plistPath,
      nodePath: "/usr/local/bin/node",
      cliPath: "/opt/dispatcher/cli.js",
      dataDirectory: join(root, "data"),
      logDirectory: join(root, "logs"),
      executor,
    })).rejects.toThrow("LAUNCHCTL_BOOTSTRAP_FAILED");
    expect(readFileSync(plistPath,"utf8")).toContain("dev.dispatcher.controller");
    expect(executor.mock.calls.map(([args]) => args[0])).toEqual(["print","enable","bootstrap"]);
  });

  function fixture(){const root=mkdtempSync(join(tmpdir(),"dispatcher-launchd-lifecycle-"));directories.push(root);return {plistPath:join(root,"controller.plist"),nodePath:"/usr/local/bin/node",cliPath:"/opt/dispatcher/cli.js",dataDirectory:join(root,"data"),logDirectory:join(root,"logs")};}
  function supervisor(plistPath:string,loaded=true){
    const calls:string[][]=[];let running=loaded;
    const executor:LaunchctlExecutor=async args=>{calls.push(args);if(args[0]==="print"){if(!running)throw new LaunchctlError("print",113);return {stdout:`service = {\n path = ${plistPath}\n state = running\n pid = 99999\n last exit code = 0\n}`,stderr:""};}if(args[0]==="bootout")running=false;if(args[0]==="bootstrap")running=true;return {stdout:"",stderr:""};};return {calls,executor};
  }
  it("starts an already loaded service without kill or bootstrap",async()=>{
    const input=fixture(),s=supervisor(input.plistPath);await installLaunchAgent({...input,executor:s.executor});s.calls.length=0;await startLaunchAgent({...input,executor:s.executor});expect(s.calls.map(args=>args[0])).toEqual(["print","enable","kickstart"]);expect(s.calls.flat()).not.toContain("-k");
  });
  it("persists explicit stop and confirms exit before a restart can bootstrap",async()=>{
    const input=fixture(),s=supervisor(input.plistPath);await installLaunchAgent({...input,executor:s.executor});s.calls.length=0;const waiting=Promise.withResolvers<void>();const pending=restartLaunchAgent({...input,executor:s.executor,waitForExit:async pid=>{expect(pid).toBe(99999);await waiting.promise;}});
    await vi.waitFor(()=>expect(s.calls.map(args=>args[0])).toEqual(["print","disable","bootout"]));waiting.resolve();await pending;expect(s.calls.map(args=>args[0])).toEqual(["print","disable","bootout","print","print","enable","bootstrap"]);expect(s.calls.flat()).not.toContain("-k");
  });
  it("keeps a stopped plist for login policy and never restarts after a failed exit wait",async()=>{
    const input=fixture(),s=supervisor(input.plistPath);await installLaunchAgent({...input,executor:s.executor});s.calls.length=0;
    await expect(restartLaunchAgent({...input,executor:s.executor,waitForExit:async()=>{throw Error("CONTROLLER_EXIT_UNCONFIRMED");}})).rejects.toThrow("EXIT_UNCONFIRMED");expect(s.calls.map(args=>args[0])).toEqual(["print","disable","bootout"]);expect(readFileSync(input.plistPath,"utf8")).toContain("dev.dispatcher.controller");
  });
  it("does not replace a different installed runtime or data directory",async()=>{
    const input=fixture(),s=supervisor(input.plistPath,false);await installLaunchAgent({...input,executor:s.executor});s.calls.length=0;const before=readFileSync(input.plistPath,"utf8");await expect(installLaunchAgent({...input,cliPath:"/opt/other/cli.js",executor:s.executor})).rejects.toThrow("SERVICE_UPGRADE_REQUIRED");expect(readFileSync(input.plistPath,"utf8")).toBe(before);expect(s.calls).toHaveLength(0);
  });
  it("retains the plist when uninstall cannot confirm stop",async()=>{
    const input=fixture(),s=supervisor(input.plistPath);await installLaunchAgent({...input,executor:s.executor});await expect(uninstallLaunchAgent({...input,executor:s.executor,waitForExit:async()=>{throw Error("CONTROLLER_EXIT_UNCONFIRMED");}})).rejects.toThrow("EXIT_UNCONFIRMED");expect(readFileSync(input.plistPath,"utf8")).toContain("dev.dispatcher.controller");
  });
  it("rejects a loaded service owned by a different plist before disabling it",async()=>{
    const input=fixture(),s=supervisor("/different/service.plist");await expect(stopLaunchAgent({...input,executor:s.executor})).rejects.toThrow("SERVICE_OWNER_UNKNOWN");expect(s.calls.map(args=>args[0])).toEqual(["print"]);
  });
  it("does not interpret arbitrary launchctl failure as a missing service",async()=>{
    const input=fixture(),executor=vi.fn(async()=>{throw new LaunchctlError("print",1);});await expect(stopLaunchAgent({...input,executor})).rejects.toThrow("LAUNCHCTL_PRINT_FAILED");expect(executor).toHaveBeenCalledOnce();
  });
  it.each(["relative/cli.js","/a/.codex/worktrees/candidate/cli.js","/opt/bad\ncli.js","/tmp/dispatcher/cli.js"])("rejects unsafe persistent runtime path %s",cliPath=>{expect(()=>launchdPlist({...fixture(),cliPath})).toThrow("SERVICE_PATH_INVALID");});
  it("refuses restart while a manually started Controller owns the data directory",async()=>{
    const input=fixture(),s=supervisor(input.plistPath,false),lock=acquireInstanceLock(input.dataDirectory);
    try{await expect(restartLaunchAgent({...input,executor:s.executor})).rejects.toThrow("DATA_DIRECTORY_IN_USE");expect(s.calls.map(args=>args[0])).toEqual(["print","disable"]);}finally{lock.release();}
  });
  it("returns only status metadata even when launchctl output contains environment values",async()=>{
    const input=fixture(),executor:LaunchctlExecutor=async()=>({stdout:`service = {\n path = ${input.plistPath}\n state = running\n pid = 12345\n last exit code = 1\n environment = { SECRET = should-stay-private }\n}`,stderr:""});
    expect(await statusLaunchAgent({...input,executor})).toEqual({loaded:true,state:"running",pid:12345,lastExitCode:1});
  });
  it("reads the installed definition without the caller's cwd or data directory",async()=>{
    const input=fixture(),value={Label:"dev.dispatcher.controller",ProgramArguments:[input.nodePath,input.cliPath,"serve","--with-runner","--data-dir",input.dataDirectory],StandardOutPath:join(input.logDirectory,"controller.log"),StandardErrorPath:join(input.logDirectory,"controller.error.log")};
    expect(await readLaunchAgent(input.plistPath,async()=>JSON.stringify(value))).toEqual({nodePath:input.nodePath,cliPath:input.cliPath,dataDirectory:input.dataDirectory,logDirectory:input.logDirectory});
    await expect(readLaunchAgent(input.plistPath,async()=>JSON.stringify({...value,ProgramArguments:[...value.ProgramArguments,"--owner-token","private-value"]}))).rejects.toThrow("SERVICE_DEFINITION_INVALID");
    await expect(readLaunchAgent(input.plistPath,async()=>"not JSON private-value")).rejects.toThrow(/^SERVICE_DEFINITION_INVALID$/);
  });
});
