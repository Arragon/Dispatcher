import {spawn,spawnSync,type ChildProcess} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach,describe,expect,it} from "vitest";
import {acquireInstanceLock,INSTANCE_LOCK_FILE} from "../src/instance-lock.js";

const roots:string[]=[],children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0)){if(child.exitCode===null&&child.signalCode===null){child.kill("SIGKILL");await once(child,"exit");}}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function root(){const value=mkdtempSync(join(tmpdir(),"dispatcher-instance-"));roots.push(value);return value;}
async function owner(directory:string){
  const module=fileURLToPath(new URL("../src/instance-lock.ts",import.meta.url));
  const child=spawn(process.execPath,["--import","tsx","--input-type=module","-e",`import {acquireInstanceLock} from ${JSON.stringify(module)}; const lock=acquireInstanceLock(process.argv[1]); process.send('locked'); setInterval(()=>{},1000); process.on('message',()=>{lock.release();process.exit(0)});`,directory],{stdio:["ignore","pipe","pipe","ipc"]});children.push(child);await Promise.race([once(child,"message"),once(child,"exit").then(()=>{throw Error("Lock child failed");})]);return child;
}
describe("Controller data-directory ownership",()=>{
  it("excludes another process and permits independent directories",async()=>{
    const directory=root(),child=await owner(directory);expect(()=>acquireInstanceLock(directory)).toThrow(/DATA_DIRECTORY_IN_USE/);
    const other=acquireInstanceLock(root());other.release();child.send("release");await once(child,"exit");const lock=acquireInstanceLock(directory);lock.release();lock.release();
  });
  it("releases kernel ownership after an abnormal process exit without deleting the lock file",async()=>{
    const directory=root(),child=await owner(directory);child.kill("SIGKILL");await once(child,"exit");expect(()=>readFileSync(join(directory,INSTANCE_LOCK_FILE))).not.toThrow();const lock=acquireInstanceLock(directory);lock.release();
  });
  it("resolves data-directory aliases to the same ownership",()=>{
    const directory=root(),alias=join(root(),"alias");symlinkSync(directory,alias);const lock=acquireInstanceLock(directory);try{expect(()=>acquireInstanceLock(alias)).toThrow(/DATA_DIRECTORY_IN_USE/);}finally{lock.release();}
  });
  it("retains the original kernel lock after a rejected same-process attempt",()=>{
    const directory=root(),lock=acquireInstanceLock(directory);
    try{
      expect(()=>acquireInstanceLock(directory)).toThrow(/DATA_DIRECTORY_IN_USE/);
      const module=fileURLToPath(new URL("../src/instance-lock.ts",import.meta.url));
      const probe=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",`import {acquireInstanceLock} from ${JSON.stringify(module)}; try{acquireInstanceLock(process.argv[1]).release();process.exitCode=2}catch(error){if(!error.message.startsWith('DATA_DIRECTORY_IN_USE'))throw error}`,directory],{timeout:5000});expect(probe.status,probe.stderr.toString()).toBe(0);
    }finally{lock.release();}
  });
  it.each(["serve","config"])("blocks CLI %s before opening or migrating the business database",command=>{
    const directory=root(),database=join(directory,"dispatcher.sqlite");writeFileSync(database,"preserve source bytes");const lock=acquireInstanceLock(directory);
    try{
      const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url)),result=spawnSync(process.execPath,["--import","tsx",cli,command,...(command==="config"?["export"]:[]),"--data-dir",directory],{timeout:5000});
      expect(result.status,result.stderr.toString()).toBe(1);expect(result.stderr.toString()).toContain("DATA_DIRECTORY_IN_USE");expect(readFileSync(database,"utf8")).toBe("preserve source bytes");
    }finally{lock.release();}
  });
  it("rejects a substituted lock symlink and leaves its target unchanged",()=>{
    const directory=root(),target=join(root(),"preserved");writeFileSync(target,"keep me");symlinkSync(target,join(directory,INSTANCE_LOCK_FILE));expect(()=>acquireInstanceLock(directory)).toThrow(/INSTANCE_LOCK_UNSAFE/);expect(readFileSync(target,"utf8")).toBe("keep me");
  });
});
