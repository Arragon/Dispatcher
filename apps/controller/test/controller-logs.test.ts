import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it} from "vitest";
import {createLogger} from "@dispatcher/observability";
import {ControllerService} from "../src/service.js";
import {createControllerLogDestination,readControllerLogTail} from "../src/controller-logs.js";

const roots:string[]=[];function root(){const value=mkdtempSync(join(tmpdir(),"dispatcher-controller-log-"));roots.push(value);return value;}
afterEach(()=>{for(const value of roots.splice(0))rmSync(value,{recursive:true,force:true});});
it("composes the real Controller logger with a bounded destination and preserves HTTP behavior",async()=>{
 const directory=root(),logs=join(directory,"runtime"),destination=createControllerLogDestination(logs),service=new ControllerService({dataDirectory:directory,ownerToken:"private-owner-canary",backgroundWorker:{enabled:false},logDestination:destination});
 try{const reply=await service.app.inject({url:"/health",headers:{authorization:"Bearer private-owner-canary"}});expect(reply.statusCode).toBe(200);const text=readControllerLogTail(join(logs,"controller.log"));expect(text).toContain("request completed");expect(text).not.toContain("private-owner-canary");}finally{await service.stop();}
});
it("keeps Controller structured output bounded and redacted through the shared logger",()=>{
 const directory=root(),destination=createControllerLogDestination(directory,{maxFileBytes:512,maxTotalBytes:1024,retentionFiles:2,tailBytes:256}),logger=createLogger({},destination);
 for(let n=0;n<40;n++)logger.info({token:"private-controller-token",n},"structured event");
 const files=readdirSync(directory).map(file=>join(directory,file));expect(files.reduce((sum,file)=>sum+statSync(file).size,0)).toBeLessThanOrEqual(1024);const text=files.map(file=>readFileSync(file,"utf8")).join("");expect(text).not.toContain("private-controller-token");expect(text).toContain("[REDACTED]");expect(text).toContain('"n":39');
});
it("bounds tail reads and sanitizes stored JSON fields before display",()=>{
 const directory=root(),path=join(directory,"controller.log");writeFileSync(path,'{"msg":"older"}\n'.repeat(10000)+'{"token":"private-stored-canary","msg":"latest"}\n');
 const output=readControllerLogTail(path,1,1024);expect(output).toContain("latest");expect(output).not.toContain("private-stored-canary");expect(output).not.toContain("older");expect(Buffer.byteLength(output)).toBeLessThanOrEqual(2048);
});
it("records an oversized structured entry as metadata and keeps later records readable",()=>{
 const directory=root(),destination=createControllerLogDestination(directory,{maxFileBytes:256,maxTotalBytes:512,retentionFiles:2,tailBytes:128});destination.write(JSON.stringify({msg:"oversized message ".repeat(1000),token:"oversized-private-canary"})+"\n"+JSON.stringify({msg:"following event"})+"\n");
 const output=readdirSync(directory).map(file=>readControllerLogTail(join(directory,file))).join("\n");expect(output).toContain("LOG_ENTRY_TOO_LARGE");expect(output).toContain("following event");expect(output).not.toContain("oversized-private-canary");
});
it("withholds partial or unstructured persisted entries rather than displaying unknown raw payloads",()=>{
 const directory=root(),path=join(directory,"controller.log");writeFileSync(path,'{"token":"'+"private".repeat(1000)+'"}\n{"msg":"safe structured event"}\nprivate unknown text');
 const output=readControllerLogTail(path,10,256);expect(output).toContain("safe structured event");expect(output).not.toContain("private");expect(output).toContain("LOG_ENTRY_WITHHELD");
});
it("rejects a substituted log symlink without reading or editing its target",()=>{
 const directory=root(),target=join(directory,"private-data"),path=join(directory,"controller.log");writeFileSync(target,'{"msg":"private source"}\n');symlinkSync(target,path);expect(()=>readControllerLogTail(path)).toThrow("LOG_PATH_UNSAFE");expect(readFileSync(target,"utf8")).toContain("private source");
});
