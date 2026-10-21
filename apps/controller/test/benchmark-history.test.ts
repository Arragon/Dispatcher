import {afterEach,expect,it} from "vitest";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {collectHistoryPages,seedHistoricalRuns} from "../../../benchmarks/history.mjs";
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),"history-benchmark-"));roots.push(root);return root;};
it("seeds only a new owned synthetic database without native sessions or commands",async()=>{
 const data=join(fixture(),"data"),seed=await seedHistoricalRuns(resolve("apps/controller/dist/cli.js"),data,5),db=new DispatcherDatabase(join(data,"dispatcher.sqlite"));
 try{expect(seed).toMatchObject({synthetic:true,runCount:5,taskCount:1});expect(db.listTaskRunsPage(seed.taskId,0,20)).toMatchObject({total:5,hasActiveRun:false});expect(db.listEntities("adapter-session")).toEqual([]);expect(db.listEntities("session")).toEqual([]);expect(db.handle.prepare("SELECT COUNT(*) AS n FROM interaction_commands").get()?.n).toBe(0);}finally{db.close();}
 const existing=join(fixture(),"existing");mkdirSync(existing);writeFileSync(join(existing,"sentinel"),"preserve");await expect(seedHistoricalRuns(resolve("apps/controller/dist/cli.js"),existing,5)).rejects.toThrow("HISTORY_DATA_DIRECTORY_EXISTS");expect(readFileSync(join(existing,"sentinel"),"utf8")).toBe("preserve");
 const invalid=join(fixture(),"invalid");await expect(seedHistoricalRuns(resolve("apps/controller/dist/cli.js"),invalid,0)).rejects.toThrow("HISTORY_COUNT_INVALID");expect(existsSync(invalid)).toBe(false);
});
it("verifies every synthetic Run across bounded pages and records response timing and bytes",async()=>{
 const offsets:number[]=[],result=await collectHistoryPages({origin:"http://127.0.0.1:1",authorization:{authorization:"Bearer fake-token"},taskId:"task",expectedRuns:23,fetcher:async(input:string)=>{
  const offset=Number(new URL(input).searchParams.get("runsOffset"));offsets.push(offset);return new Response(JSON.stringify({currentRun:{id:"run-0",taskId:"task"},runs:Array.from({length:Math.min(20,23-offset)},(_,index)=>({id:`run-${offset+index}`,taskId:"task"})),runPage:{offset,limit:20,total:23,hasActiveRun:false,...(offset===0?{nextOffset:20}:{})}}));
 }});expect(offsets).toEqual([0,20]);expect(result).toMatchObject({pages:2,runsVerified:23,pageSize:20});expect(result.maximumResponseBytes).toBeGreaterThan(0);expect(result.latencyMs.p95).toBeGreaterThanOrEqual(0);
});
it.each(["unpaged","duplicate","foreign","non-progressing"])("refuses %s history as pagination evidence",async mode=>{
 await expect(collectHistoryPages({origin:"http://127.0.0.1:1",authorization:{},taskId:"task",expectedRuns:2,fetcher:async()=>new Response(JSON.stringify({currentRun:{id:"run",taskId:"task"},runs:mode==="non-progressing"?[]:[{id:"run",taskId:"task"},{id:mode==="duplicate"?"run":"other",taskId:mode==="foreign"?"foreign":"task"}],...(mode==="unpaged"?{}:{runPage:{offset:0,limit:20,total:2,hasActiveRun:false,...(mode==="non-progressing"?{nextOffset:0}:{})}})}))})).rejects.toThrow(/HISTORY_/);
});
