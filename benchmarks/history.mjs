import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";

/** A new synthetic data directory only; imports the selected runtime's persistence. */
export async function seedHistoricalRuns(cliPath,dataDirectory,runCount){
  if(!Number.isSafeInteger(runCount)||runCount<1||runCount>100_000)throw Error("HISTORY_COUNT_INVALID");
  if(existsSync(dataDirectory))throw Error("HISTORY_DATA_DIRECTORY_EXISTS");
  const {DispatcherDatabase}=await import(pathToFileURL(createRequire(cliPath).resolve("@dispatcher/persistence")).href);
  mkdirSync(dataDirectory,{mode:0o700});const database=new DispatcherDatabase(join(dataDirectory,"dispatcher.sqlite")),taskId="benchmark-history",stamp=new Date().toISOString();
  try{
    database.transaction(()=>{
      database.writeCanonicalTask(taskId,0,{id:taskId,title:"Synthetic historical task",description:"Benchmark metadata only; no native execution evidence",state:"REVIEW",revision:1,origin:{source:"local"},currentRunId:`history-${runCount-1}`,createdAt:stamp,updatedAt:stamp},stamp);
      for(let index=0;index<runCount;index++)database.saveEntity("run",`history-${index}`,{id:`history-${index}`,taskId,state:"COMPLETE",runnerId:"local",profileId:"benchmark-synthetic",sessionId:`synthetic-${index}`,generation:1,attempt:1,startedAt:stamp,lastActivityAt:stamp},stamp);
    });
    database.checkpoint();
  }finally{database.close();}
  return {synthetic:true,taskId,taskCount:1,runCount,nativeWorkloadConfigured:false};
}

/** Verifies API pagination, never browser rendering or native/provider acceptance. */
export async function collectHistoryPages({origin,authorization,taskId,expectedRuns,fetcher=fetch,onPage}){
  if(!Number.isSafeInteger(expectedRuns)||expectedRuns<1||expectedRuns>100_000)throw Error("HISTORY_COUNT_INVALID");
  const ids=new Set(),latencies=[],pageSize=20;let offset=0,pages=0,maximumResponseBytes=0,currentId;
  for(;;){
    const started=performance.now(),response=await fetcher(`${origin}/api/tasks/${encodeURIComponent(taskId)}?runsOffset=${offset}&runsLimit=${pageSize}`,{headers:authorization,signal:AbortSignal.timeout(5_000)});
    if(!response.ok)throw Error("HISTORY_ENDPOINT_UNAVAILABLE");
    const body=await response.text(),bytes=Buffer.byteLength(body);maximumResponseBytes=Math.max(maximumResponseBytes,bytes);
    if(bytes>2*1024*1024)throw Error("HISTORY_RESPONSE_TOO_LARGE");
    let value;try{value=JSON.parse(body);}catch{throw Error("HISTORY_RESPONSE_INVALID");}
    const page=value.runPage;
    if(!page||page.offset!==offset||page.limit!==pageSize||page.total!==expectedRuns||page.hasActiveRun!==false||!Array.isArray(value.runs)||value.runs.length<1||value.runs.length>pageSize||value.currentRun?.taskId!==taskId||typeof value.currentRun.id!=="string")throw Error("HISTORY_PAGINATION_UNVERIFIED");
    if(currentId!==undefined&&currentId!==value.currentRun.id)throw Error("HISTORY_CURRENT_RUN_CHANGED");currentId=value.currentRun.id;
    for(const run of value.runs){if(run.taskId!==taskId||typeof run.id!=="string"||!run.id||ids.has(run.id))throw Error("HISTORY_IDENTITY_UNVERIFIED");ids.add(run.id);}
    latencies.push(performance.now()-started);pages++;onPage?.();
    if(page.nextOffset===undefined){if(ids.size!==expectedRuns)throw Error("HISTORY_COUNT_MISMATCH");break;}
    if(page.nextOffset!==offset+value.runs.length||page.nextOffset<=offset||page.nextOffset>=expectedRuns)throw Error("HISTORY_CURSOR_UNVERIFIED");offset=page.nextOffset;
  }
  if(!ids.has(currentId))throw Error("HISTORY_CURRENT_RUN_UNVERIFIED");
  latencies.sort((a,b)=>a-b);const percentile=fraction=>latencies[Math.max(0,Math.ceil(latencies.length*fraction)-1)];
  return {pages,runsVerified:ids.size,pageSize,maximumResponseBytes,latencyMs:{minimum:latencies[0],p50:percentile(0.5),p95:percentile(0.95),p99:percentile(0.99),maximum:latencies.at(-1)}};
}
