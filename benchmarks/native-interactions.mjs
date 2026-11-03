import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { captureBenchmarkRuntime, captureHarnessIdentity } from "./runtime.mjs";

const args=process.argv.slice(2),option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const runtime=captureBenchmarkRuntime({releaseDirectory:option("--release-dir"),controllerPath:resolve("apps/controller/dist/cli.js"),harness:captureHarnessIdentity()});
const requireRuntime=createRequire(runtime.cliPath);
const {codexAppServerProtocolVersion}=await import(pathToFileURL(requireRuntime.resolve("@dispatcher/adapters")).href);
// Exercise the manifested internal transport without adding a product export.
const {CodexStdioTransport}=await import(pathToFileURL(join(dirname(requireRuntime.resolve("@dispatcher/adapters")),"codex-app-server.js")).href);
const {NativeRuntimeHosts,ProcessManager,createNativeEventCheckpoint,recoverNativeEvents}=await import(pathToFileURL(requireRuntime.resolve("@dispatcher/runner")).href);

// Actual disposable Node subprocesses and production transport/Runner paths.
// Controlled protocol payloads are fixtures, never provider throughput or GUI proof.
const root=mkdtempSync(join(tmpdir(),"dispatcher-native-performance-"));
const manager=new ProcessManager(join(root,"logs")),hosts=new NativeRuntimeHosts();
const binding={version:1,product:"fixture",region:"global",profileId:"p",backendId:"fixture",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"};
const samples=15,report={version:1,scenario:"native-interactions-bounded",capturedAt:new Date().toISOString(),environment:{node:process.version,os:process.platform,architecture:process.arch,cpu:cpus()[0]?.model,...runtime.environment,scriptSha256:createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex")},samples,thresholds:{inputAndQueueBytes:4*1024*1024,protocolFrameBytes:1024*1024,logDiskBytesPerRun:1024*1024,checkpointEntries:100},limitations:["Controlled Node protocol fixture, not real native-provider throughput, entitlement, writer release or GUI qualification.","Short local samples; long-term host soak, concurrent users, platform-specific child containment and real-provider history pagination remain unmeasured.","Latency and RSS are informational samples; no before/after improvement or latency acceptance threshold is claimed."]};
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)],minMs:sorted[0],maxMs:sorted.at(-1)};};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(path){const deadline=Date.now()+3000;while(!existsSync(path)){if(Date.now()>deadline)throw Error("FIXTURE_START_TIMEOUT");await delay(5);}}
function bytes(path){return readdirSync(path,{withFileTypes:true}).reduce((sum,entry)=>sum+(entry.isDirectory()?bytes(join(path,entry.name)):statSync(join(path,entry.name)).size),0);}
let transport,protocolPid,sequence=0,completed=false;
try{
  let acquisitions=0;const backend={id:"fixture",runnerId:"local",nativeStoreRef:"store",product:"fixture",region:"global",ownership:"owned",acquire:async profileId=>{
    acquisitions++;const processHandle=await manager.start({runId:"host",file:process.execPath,args:["-e","setInterval(()=>{},1000)"],cwd:root,timeoutMs:10000});
    return {id:processHandle.id,profileId,backendId:"fixture",runnerId:"local",nativeStoreRef:"store",product:"fixture",region:"global",ownership:"owned",process:processHandle,processGroupContainment:{handleId:processHandle.id,evidenceRef:"fixture-no-tools"},interrupt:async(_binding,request)=>({version:1,commandId:request.commandId,state:"accepted"}),quiescent:async()=>true,stop:async()=>processHandle.cancel(),detach:async()=>{}};
  }};
  report.hosts={inactiveProfileAcquisitions:acquisitions,inactiveProcesses:manager.activeCount};
  const first=await hosts.acquireRuntime({id:"p"},backend),second=await hosts.acquireRuntime({id:"p"},backend);
  report.hosts.activeAcquisitions=acquisitions;report.hosts.activeProcesses=manager.activeCount;report.hosts.sharedHost=first.hostId===second.hostId;
  await hosts.releaseRuntime(first,"stop-owned");report.hosts.lastRelease=await hosts.releaseRuntime(second,"stop-owned");

  const slow=[];for(let index=0;index<samples;index++){
    const handle=await manager.start({runId:"slow-"+index,file:process.execPath,args:["-e","let bytes=0;process.stdin.on('data',b=>{bytes+=b.length;if(bytes===2097152)process.exit(0);});process.stdin.pause();setTimeout(()=>process.stdin.resume(),75);"],cwd:root,timeoutMs:5000});
    const started=performance.now();await handle.send("x".repeat(2*1024*1024));slow.push(performance.now()-started);if((await handle.result()).exitCode!==0)throw Error("SLOW_CONSUMER_FAILED");
  }report.slowConsumer={bytesPerWrite:2*1024*1024,readDelayMs:75,...stats(slow)};
  const cancel=[];for(let index=0;index<samples;index++){
    const marker="ready-"+index;const handle=await manager.start({runId:"cancel-"+index,file:process.execPath,args:["-e","require('node:fs').writeFileSync("+JSON.stringify(marker)+",'ready');setInterval(()=>{},1000);"],cwd:root,timeoutMs:5000});await ready(join(root,marker));
    const started=performance.now();await handle.cancel();cancel.push(performance.now()-started);if((await handle.result()).classification!=="cancelled")throw Error("CANCEL_CLASSIFICATION_LOST");
  }report.cancel=stats(cancel);
  const output=await manager.start({runId:"output",file:process.execPath,args:["-e","for(let n=0;n<128;n++)process.stdout.write('x'.repeat(65536));"],cwd:root,timeoutMs:5000});
  if((await output.result()).exitCode!==0)throw Error("OUTPUT_PRESSURE_FAILED");report.output={emittedBytes:8*1024*1024,retainedDiskBytes:bytes(join(root,"logs","output"))};

  const executable=join(root,"protocol-fixture");writeFileSync(executable,"#!"+process.execPath+"\n"+`if(process.argv.includes('--version'))console.log('codex-cli ${codexAppServerProtocolVersion}');else{require('node:fs').writeFileSync('protocol.pid',String(process.pid));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line),offset=Number(q.params.cursor??0);let result;if(q.method==='history')result={version:1,nativeSessionId:'native',state:'available',source:'fixture',completeness:'complete',range:'native-history',entries:Array.from({length:50},(_,n)=>({id:'entry-'+(offset+n),kind:'assistant',text:'x'.repeat(1024)})),...(offset+50<1000?{nextCursor:String(offset+50)}:{})};else result={version:1,id:'snapshot',nativeSessionId:'native',scopeFingerprint:'scope',observedAt:new Date().toISOString(),state:'idle',pendingTools:'none',pendingApprovals:'none',historyMode:'native-revision',historyRevision:'revision'};process.stdout.write(JSON.stringify({id:q.id,result})+'\\n');});}\n`);chmodSync(executable,0o700);
  transport=await CodexStdioTransport.open({profileId:"p",runnerId:"local",nativeStoreRef:"store",scopeFingerprint:"scope",executionRefId:"execution",executable,codexHome:root,workspacePath:root,approvalPolicy:"on-request",sandbox:"read-only"});await ready(join(root,"protocol.pid"));protocolPid=Number(readFileSync(join(root,"protocol.pid"),"utf8"));
  const history=[];for(let index=0;index<samples;index++){const started=performance.now(),page=await transport.request("history",{limit:50,cursor:"0"});history.push(performance.now()-started);if(page.entries.length!==50)throw Error("HISTORY_PAGE_INVALID");}
  report.historyPage={entries:50,textBytesPerEntry:1024,...stats(history)};
  let checkpoint=createNativeEventCheckpoint({binding,scopeFingerprint:"scope",stream:{kind:"volatile"}}),last,receivedPages=0,receivedEntries=0;const rebuildStarted=performance.now();
  for(let page=0;page<20;page++){
    last=await recoverNativeEvents(checkpoint,{inspect:async()=>{const observation=await transport.request("snapshot",{});return {...observation,read:{requestId:"read-"+(++sequence),observerEpoch:"observer",observerGeneration:1,sequence,processState:"running",readability:"readable"}};},history:async(_binding,request)=>{const page=await transport.request("history",request);if(!Array.isArray(page.entries)||page.entries.length!==50)throw Error("HISTORY_PAGE_INVALID");receivedPages++;receivedEntries+=page.entries.length;return page;}});if(!last.accepted)throw Error("HISTORY_REBUILD_REJECTED");checkpoint=last.checkpoint;
  }
  report.rebuild={requestedPages:20,receivedPages,sourceEntries:receivedEntries,retainedEntries:checkpoint.history?.entries.length,checkpointBytes:Buffer.byteLength(JSON.stringify(checkpoint)),durationMs:performance.now()-rebuildStarted,needsHistory:last.needsHistory,gaps:last.gaps};
  const usage=execFileSync("ps",["-o","rss=,%cpu=","-p",String(protocolPid)],{encoding:"utf8",timeout:1000}).trim().split(/\s+/).map(Number);report.resources={fixtureRssBytes:usage[0]*1024,fixtureCpuPercent:usage[1],parentRssBytes:process.memoryUsage().rss,workspaceDiskBytes:bytes(root)};
  await transport.close();transport=undefined;await hosts.shutdown("stop-owned");await manager.shutdown();
  let survives=false;try{process.kill(protocolPid,0);survives=true;}catch(error){if(error.code!=="ESRCH")throw error;}
  report.cleanup={ownedProcessesRemaining:manager.activeCount,protocolProcessSurvives:survives,orphanCount:manager.activeCount+Number(survives),workspacePins:"Covered by native-session-retention.test.ts; no live user workspace sampled."};
  if(report.hosts.inactiveProcesses!==0||report.hosts.inactiveProfileAcquisitions!==0||!report.hosts.sharedHost||report.hosts.lastRelease.state!=="stopped"||report.output.retainedDiskBytes>report.thresholds.logDiskBytesPerRun||report.rebuild.receivedPages!==20||report.rebuild.sourceEntries!==1000||report.rebuild.retainedEntries!==report.thresholds.checkpointEntries||!report.rebuild.needsHistory||report.cleanup.orphanCount!==0)throw Error("NATIVE_PERFORMANCE_BOUND_FAILED");
  report.environment.runtimeIntegrity=runtime.recheck();if(report.environment.runtimeIntegrity.state==="changed")throw Error("BENCHMARK_RUNTIME_CHANGED");
  if(!report.environment.runtimeIntegrity.qualified)report.limitations.push("Development runtime; this report does not qualify a fixed release candidate.");
  const destination=resolve(option("--out",join(".dispatcher","benchmarks",report.capturedAt.replaceAll(":","-")+"-native-interactions.json")));mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({output:destination,slowConsumer:report.slowConsumer,cancel:report.cancel,historyPage:report.historyPage,rebuild:report.rebuild,cleanup:report.cleanup}));completed=true;
}catch(error){
  writeFileSync(join(root,"partial-report.json"),JSON.stringify(report,null,2)+"\n");throw error;
}finally{
  const cleanup=[];
  for(const stop of [()=>transport?.close(),()=>hosts.shutdown("stop-owned"),()=>manager.shutdown()])try{await stop();}catch(error){cleanup.push(error);}
  if(completed&&cleanup.length===0&&manager.activeCount===0)rmSync(root,{recursive:true,force:true});
  else{console.error(JSON.stringify({code:"NATIVE_BENCHMARK_EVIDENCE_RETAINED",directory:root,ownedProcessesRemaining:manager.activeCount,cleanupFailures:cleanup.length}));process.exitCode=1;}
}
