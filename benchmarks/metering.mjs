import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {createHash,randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {captureBenchmarkRuntime,captureHarnessIdentity} from "./runtime.mjs";

// Adapt the a499d84 metering workload to the canonical Controller ledger.
// Private collector access is a white-box fixture, never a product admission API.
const args=process.argv.slice(2),option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const runtime=captureBenchmarkRuntime({releaseDirectory:option("--release-dir"),controllerPath:resolve("apps/controller/dist/cli.js"),harness:captureHarnessIdentity()});
const {ControllerService}=await import(pathToFileURL(join(dirname(runtime.cliPath),"service.js")).href);
const root=mkdtempSync(join(tmpdir(),"dispatcher-metering-benchmark-")),ownerToken=randomBytes(32).toString("base64url"),headers={authorization:`Bearer ${ownerToken}`};
const gate=Promise.withResolvers();let released=false,completed=false,stopped=false,reads=0,emissions=0,nativeStarts=0;
const controller=new ControllerService({dataDirectory:join(root,"data"),ownerToken,withRunner:true,backgroundWorker:{enabled:false},logDestination:{write(){}},
  secretStore:{put:async reference=>({reference,exists:false,backend:"encrypted-local"}),delete:async()=>{},test:async()=>false,metadata:async reference=>({reference,exists:false,backend:"encrypted-local"}),resolve:async()=>{throw Error("BENCHMARK_SECRET_UNAVAILABLE");}},
  codexBackendFactory:()=>({start(){nativeStarts++;throw Error("BENCHMARK_NATIVE_EXECUTION_FORBIDDEN");}}),
  profileProbeExecutor:async()=>({state:"unknown"}),codexNativeReader:async()=>({rateLimits:{}}),
});
const runs=[],bySession=new Map(),timestamp=new Date().toISOString();
const report={version:1,scenario:"metering-1k-active-10k-history",collectedAt:timestamp,activeRuns:1000,historicalRuns:10000,samples:15,warmupSamples:1,
  environment:{node:process.version,platform:process.platform,architecture:process.arch,...runtime.environment,scriptSha256:createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex")},
  limitations:["Synthetic canonical Run/Session metadata and normalized adapter usage; no inference, native-account throughput or billing claim.","Uses the production Controller's guarded collector/cache and ledger with a held fixture reader; does not measure real owning-Runner/native reads, cancellation or lease latency at this scale.","Fleet API latency/RSS are local informational samples, not browser rendering, host-idle or soak acceptance."]};
const context=run=>({profileId:run.profileId,runId:run.id,sessionId:run.sessionId,generation:run.generation});
const observation=run=>({version:1,eventId:"event",...context(run),turnId:`turn-${run.id}`,scope:"turn",mode:"snapshot",observedAt:timestamp,source:"native-query",completeness:"complete",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens",includedIn:"input"},{name:"output",value:"10",unit:"tokens"}]});
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)],maxMs:sorted.at(-1)};};
async function fleetSample(){
  const started=performance.now();let timer;
  try{
    const response=await Promise.race([controller.app.inject({url:"/api/fleet",headers}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("BENCHMARK_FLEET_HANG_GUARD")),30000);})]);
    if(response.statusCode!==200)throw Error("BENCHMARK_FLEET_REQUEST_FAILED");
    const snapshot=response.json().snapshot;if(snapshot.runs.length!==11000)throw Error("BENCHMARK_FLEET_RUN_COUNT_MISMATCH");
    return {milliseconds:performance.now()-started,bytes:Buffer.byteLength(response.body)};
  }finally{clearTimeout(timer);}
}
async function fleetSamples(){const times=[];let responseBytes=0;for(let index=0;index<report.samples;index++){const sample=await fleetSample();times.push(sample.milliseconds);responseBytes=sample.bytes;}return {...stats(times),responseBytes};}
async function collect(values){for(let index=0;index<values.length;index+=4){for(const run of values.slice(index,index+4))controller.kickRunUsage(run);await Promise.all([...controller.usageReads.values()].map(value=>value.promise));}}
try{
  mkdirSync(join(root,"home"));await controller.start({listen:false});
  const config=(await controller.app.inject({url:"/api/config",headers})).json().config;
  config.connectors=[];config.agentProfiles=[{id:"p",alias:"Synthetic benchmark",provider:"codex",runnerId:"local",settings:{codexHome:join(root,"home")}}];
  const planned=await controller.app.inject({method:"POST",url:"/api/config/plans",headers,payload:{config}});if(planned.statusCode!==201)throw Error("BENCHMARK_CONFIG_PLAN_FAILED");
  const applied=await controller.app.inject({method:"POST",url:`/api/config/plans/${planned.json().plan.id}/apply`,headers,payload:{confirmed:true}});if(applied.statusCode!==200)throw Error("BENCHMARK_CONFIG_APPLY_FAILED");
  const fingerprint=controller.resolveProfileExecutionContext("p",undefined,"probe").fingerprint;
  const seedingStarted=performance.now();controller.database.transaction(()=>{
    for(let index=0;index<11000;index++){
      const id=`r${index}`,taskId=`t${index}`,active=index<1000;
      const run={id,taskId,profileId:"p",providerId:"codex",sessionId:`s${index}`,runnerId:"local",state:active?"ACTIVE":"COMPLETE",generation:1,attempt:1,leaseId:`l${index}`,startedAt:timestamp,lastActivityAt:timestamp,...(active?{}:{endedAt:timestamp}),verification:{state:"PASSED",commands:[]}};
      controller.database.saveEntity("run",id,run);controller.database.writeCanonicalTask(taskId,0,{id:taskId,projectId:"benchmark",title:`Synthetic task ${index}`,state:active?"RUNNING":"DONE",revision:1,currentRunId:id,origin:{source:"local"},bindings:[],createdAt:timestamp,updatedAt:timestamp},timestamp);
      controller.database.saveEntity("adapter-session",run.sessionId,{id:run.sessionId,runId:id,profileId:"p",state:active?"RUNNING":"COMPLETED",turnId:`turn-${id}`,authority:{version:1,fingerprint},createdAt:timestamp,updatedAt:timestamp});
      runs.push(run);bySession.set(run.sessionId,run);
    }
  });
  report.metadataSetupMs=performance.now()-seedingStarted;
  const adapter=controller.agentAdapters.get("p");if(!adapter?.usage)throw Error("BENCHMARK_ADAPTER_UNAVAILABLE");
  adapter.usage=async sessionId=>{reads++;if(!released)await gate.promise;const run=bySession.get(sessionId);if(!run)throw Error("BENCHMARK_SESSION_UNKNOWN");return {observations:[observation(run)]};};
  const publish=controller.fleetEvents.publish.bind(controller.fleetEvents);controller.fleetEvents.publish=(type,...rest)=>{if(type==="usage.changed")emissions++;return publish(type,...rest);};
  const active=runs.slice(0,1000);for(const run of active.slice(0,4))controller.kickRunUsage(run);await Promise.resolve();
  if(reads!==4||controller.usageReads.size!==4)throw Error("BENCHMARK_HELD_READER_NOT_ADMITTED");
  await fleetSample();report.before=await fleetSamples();report.heldReader={admitted:reads,gateReleasedBeforeFleetResponse:released};if(released)throw Error("BENCHMARK_READER_GATE_RELEASED_EARLY");
  const collectionStarted=performance.now();released=true;gate.resolve();await collect(runs);report.initialCollectionMs=performance.now()-collectionStarted;
  if(reads!==11000||emissions!==11000||controller.database.listEntities("usage-observation").length!==11000||runs.some(run=>controller.database.getEntity("usage-read-state",run.id)?.state!=="complete"))throw Error("BENCHMARK_COLLECTION_INCOMPLETE");
  const initialReads=reads,initialEmissions=emissions,cachedTimes=[],replayTimes=[];let replayInsertions=0;
  for(let index=0;index<report.samples;index++){
    let started=performance.now();await collect(active);cachedTimes.push(performance.now()-started);
    started=performance.now();controller.database.transaction(()=>{for(const run of active)replayInsertions+=controller.usageObservations.record([observation(run)],context(run));});replayTimes.push(performance.now()-started);
  }
  report.cachedCollection={...stats(cachedTimes),initialReads,initialEmissions,repeatedReads:reads-initialReads,repeatedEmissions:emissions-initialEmissions};
  report.ledgerReplay={...stats(replayTimes),inserted:replayInsertions};report.totals=controller.usageObservations.query({profileId:"p"}).totals;
  const totals=new Map(report.totals.map(value=>[value.name,value.value]));if(totals.get("input")!=="1100000"||totals.get("cachedInput")!=="770000"||totals.get("output")!=="110000")throw Error("BENCHMARK_USAGE_TOTAL_MISMATCH");
  report.after=await fleetSamples();report.fleetMedianRatio=report.after.medianMs/report.before.medianMs;report.memoryUsage=process.memoryUsage();report.rssBytes=report.memoryUsage.rss;report.nativeStarts=nativeStarts;
  if(replayInsertions!==0||reads!==initialReads||emissions!==initialEmissions||nativeStarts!==0)throw Error("BENCHMARK_DUPLICATE_COLLECTION_EFFECT");
  await controller.stop();stopped=true;report.cleanup={controllerStopped:true,pendingUsageReaders:controller.usageReads.size};
  report.environment.runtimeIntegrity=runtime.recheck();if(report.environment.runtimeIntegrity.state==="changed")throw Error("BENCHMARK_RUNTIME_CHANGED");
  if(!report.environment.runtimeIntegrity.qualified)report.limitations.push("Development runtime; this report does not qualify a fixed release candidate.");
  const destination=resolve(option("--out",join(".dispatcher","benchmarks",timestamp.replaceAll(":","-")+"-metering.json")));mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({output:destination,before:report.before,after:report.after,heldReader:report.heldReader,cachedCollection:report.cachedCollection,ledgerReplay:report.ledgerReplay,cleanup:report.cleanup}));completed=true;
}catch(error){writeFileSync(join(root,"partial-report.json"),JSON.stringify(report,null,2)+"\n");throw error;}
finally{
  released=true;gate.resolve();let cleanupFailed=false;
  try{if(!stopped)await controller.stop();}catch{cleanupFailed=true;}
  if(completed&&!cleanupFailed)rmSync(root,{recursive:true,force:true});
  else{console.error(JSON.stringify({code:"METERING_BENCHMARK_EVIDENCE_RETAINED",directory:root,cleanupFailed}));process.exitCode=1;}
}
