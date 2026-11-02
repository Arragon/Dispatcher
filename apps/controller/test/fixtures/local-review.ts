import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,cpSync,realpathSync,existsSync} from "node:fs";
import {join,sep} from "node:path";import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import type {CodexBackend} from "@dispatcher/adapters";
import type {PricingSnapshotV1} from "@dispatcher/domain";
import type {SecretStore} from "@dispatcher/config";
import {VerificationRegistry} from "@dispatcher/runner";
import {ControllerService} from "../../src/service.js";
export async function localReviewFixture(options:{verificationDelayMs?:number;advance?:boolean;verificationScript?:string;preparationScripts?:string[];preparationRequired?:boolean;verificationRequired?:boolean;preparationProfileId?:string;onCancel?:()=>Promise<void>;waiting?:boolean;explicitModel?:boolean;ownedCli?:boolean;nativePricing?:PricingSnapshotV1;clock?:()=>Date}={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-local-review-"))),repo=join(root,"repo");let starts=0;
 const nativeInputs:Array<{model?:string;reasoningEffort?:string;providerSessionId?:string}>=[];
 const executable=join(root,"owned-fixture-cli"),counter=join(root,"native-starts");
 if(options.ownedCli)writeFileSync(executable,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex-cli 0.0.0-fixture');process.exit(0);}if(args[0]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}const counter=${JSON.stringify(counter)};fs.writeFileSync(counter,String((fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0)+1));fs.writeFileSync('result.txt','candidate\\n');const id=args[1]==='resume'?args.at(-2):'native-'+require('node:crypto').randomUUID();console.log(JSON.stringify({type:'thread.started',thread_id:id}));${options.waiting?"console.log(JSON.stringify({type:'input_required'}));":""}console.log(JSON.stringify({type:'turn.completed'}));
`,{mode:0o700});
 const evidenceRoot=process.env.DISPATCHER_CANONICAL_SNAPSHOT_EVIDENCE;
 const evidence=evidenceRoot?join(evidenceRoot,randomUUID()):undefined;
 const observations:unknown[]=[];
 const record=(kind:string,value:unknown)=>{if(evidence)observations.push({kind,at:new Date().toISOString(),value});};
 type Invocation={commandId:string;cwd:string};
 type InvocationWaiter={commandId:string;resolve:(value:Invocation)=>void;reject:(error:unknown)=>void};
 const invocationWaiters=new Set<InvocationWaiter>(),snapshotRoot=join(root,"data","verification-snapshots")+sep;let invocationsClosed=false;
 const rejectInvocation=(waiter:InvocationWaiter,error:unknown)=>{if(invocationWaiters.delete(waiter)){record("snapshot-invocation-wait-rejected",{commandId:waiter.commandId,error:String(error),remaining:invocationWaiters.size});waiter.reject(error);}};
 const armSnapshotInvocation=(commandId:string)=>{
  if(invocationsClosed)throw Error("Fixture is closed");
  let waiter!:InvocationWaiter;
  const invoked=new Promise<Invocation>((resolve,reject)=>{waiter={commandId,resolve,reject};});
  void invoked.catch(()=>undefined);invocationWaiters.add(waiter);record("snapshot-invocation-wait-armed",{commandId});
  let observed:Promise<unknown>|undefined;
  return (work:Promise<unknown>)=>{
   if(observed&&observed!==work)throw Error("Invocation wait is already bound to another verification");
   if(!observed){observed=work;void work.then(()=>rejectInvocation(waiter,Error("Verification completed before the owned snapshot command invocation")),error=>rejectInvocation(waiter,error));}
   return invoked;
  };
 };
 const secrets=new Map<string,string>();
 const metadata=(reference:string)=>({reference,backend:"encrypted-local" as const,exists:secrets.has(reference)});
 const secretStore:SecretStore={async put(reference,value){secrets.set(reference,value);return metadata(reference);},async delete(reference){secrets.delete(reference);},async test(reference){return secrets.has(reference);},async metadata(reference){return metadata(reference);},async resolve(reference){const value=secrets.get(reference);if(value===undefined)throw Error("FIXTURE_SECRET_MISSING");return value;}};
 const originalRun=VerificationRegistry.prototype.run;
 const recordedRun:typeof originalRun=async function(commandId,cwd,signal){
  const owned=cwd.startsWith(root+"/");
  const command=owned?this.list().find(command=>command.id===commandId):undefined;
  if(owned)record("verification-invoke",{command,cwd,aborted:signal?.aborted});
  const abort=()=>{if(owned)record("verification-abort",{commandId,cwd});};signal?.addEventListener("abort",abort,{once:true});
  try{
   const work=originalRun.call(this,commandId,cwd,signal);
   if(command&&cwd.startsWith(snapshotRoot))for(const waiter of [...invocationWaiters])if(waiter.commandId===commandId){invocationWaiters.delete(waiter);record("snapshot-invocation-begun",{commandId,cwd,remaining:invocationWaiters.size});waiter.resolve({commandId,cwd});}
   const result=await work;if(owned)record("verification-result",{commandId,cwd,result});return result;
  }
  catch(error){if(owned)record("verification-error",{commandId,cwd,message:String(error)});throw error;}
  finally{signal?.removeEventListener("abort",abort);}
 };
 VerificationRegistry.prototype.run=recordedRun;
 let current:ControllerService|undefined;
 const close=async()=>{
  invocationsClosed=true;for(const waiter of [...invocationWaiters])rejectInvocation(waiter,Error("Fixture closed before snapshot command invocation"));
  try{record("service-stop-request",{});try{await current?.stop();record("service-stop-result",{});}finally{
   if(evidence){
    mkdirSync(evidence,{recursive:true});cpSync(root,join(evidence,"closed-tree"),{recursive:true});
    writeFileSync(join(evidence,"operations.json"),JSON.stringify({root,starts,options,observations,scope:"Actual guarded Controller fixture; service stop attempted before complete controlled tree and table capture; not an atomic DB backup or real provider proof."},null,2));
    if(existsSync(join(evidence,"closed-tree/data/dispatcher.sqlite"))){const database=new DatabaseSync(join(evidence,"closed-tree/data/dispatcher.sqlite"),{readOnly:true});
    try{
     const tables=database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[];
     const allTables=Object.fromEntries(tables.map(({name})=>[name,database.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));
     writeFileSync(join(evidence,"tables.json"),JSON.stringify(allTables,(_,value)=>typeof value==="bigint"?String(value):value,2));
    }finally{database.close();}}

   }
   }
  }finally{VerificationRegistry.prototype.run=originalRun;rmSync(root,{recursive:true,force:true});}
 };
 try{mkdirSync(repo);const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{stdio:'pipe'});git('init','--initial-branch=main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'README.md'),'baseline\n');if(options.preparationScripts)writeFileSync(join(repo,'.gitignore'),'env.txt\n');git('add','.');git('commit','-m','baseline'); const service=new ControllerService({secretStore,...(options.clock?{clock:options.clock}:{}),dataDirectory:join(root,'data'),ownerToken:'local-review-fixture',withRunner:true,backgroundWorker:{enabled:false},...(options.ownedCli?{}:{codexBackendFactory:()=>({start(input:Parameters<CodexBackend["start"]>[0]){starts++;nativeInputs.push({model:input.model,reasoningEffort:input.reasoningEffort,providerSessionId:input.providerSessionId});record("fake-native-start",input);if(evidence){mkdirSync(evidence,{recursive:true});cpSync(root,join(evidence,`native-input-${starts}`),{recursive:true});}writeFileSync(join(input.workspacePath,'result.txt'),'candidate\n');if(options.preparationScripts)writeFileSync(join(input.workspacePath,'env.txt'),'source-only');return {status:()=>"completed",result:async()=>({state:options.waiting&&starts===1?"waiting":"completed",summary:"fixture completed",providerSessionId:"native-fixture",events:[]}),cancel:async()=>{await options.onCancel?.();}};}})}),codexNativeReader:async input=>input.method==="account/read"?{account:{type:"chatgpt"},requiresOpenaiAuth:true}:{data:[{model:"fixture-model",displayName:"Fixture",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium"}]}],nextCursor:null}});
 current=service;
 if(evidence){
  service.app.addHook("onRequest",async request=>{record("http-request",{id:request.id,method:request.method,url:request.url});});
  service.app.addHook("onSend",async(request,reply,payload)=>{record("http-response",{id:request.id,body:request.body,status:reply.statusCode,payload});return payload;});
  for(const name of ["read","verify","accept","cancel"] as const){
   const original=service.localResults[name].bind(service.localResults);
   Object.defineProperty(service.localResults,name,{value:async(...args:unknown[])=>{
    record("local-"+name+"-request",args);
    try{const value=await Reflect.apply(original,service.localResults,args);record("local-"+name+"-result",value);return value;}
    catch(error){record("local-"+name+"-error",{message:String(error),code:(error as {code?:string}).code});throw error;}
   }});
  }
 }
 await service.start({listen:false});const config=service.configuration.current().config;config.agentProfiles=[{id:"codex",alias:"Fixture",provider:"codex",runnerId:"local",settings:{codexHome:join(root,"native"),...(options.ownedCli?{executable}:{})}}];config.repositories=[{id:"repo",root:repo,defaultBaseRef:"main",scopePaths:[],...(options.preparationScripts?{snapshotVerification:{version:1 as const,id:options.preparationProfileId??"fixture-preparation",preparationCommandIds:options.preparationScripts.map((_,index)=>`prepare-${index}`)}}:{}),verificationCommands:[...(options.preparationScripts??[]).map((script,index)=>({id:`prepare-${index}`,file:process.execPath,args:["-e",script],required:options.preparationRequired??false,timeoutMs:5000,outputLimitBytes:4096})),{id:"check",file:process.execPath,args:["-e",options.verificationScript??`setTimeout(()=>{if(require('node:fs').readFileSync('result.txt','utf8')!=='candidate\\n')process.exit(1)},${options.verificationDelayMs??0})`],required:options.verificationRequired??true,timeoutMs:5000,outputLimitBytes:1024}]}];await service.configuration.applyPlan(service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});
 if(options.nativePricing){const adapter=service["agentAdapters"].get("codex")!,catalog=adapter.modelCatalog!.bind(adapter);adapter.modelCatalog=async context=>{const value=await catalog(context);value.fetchedAt=(options.clock?.()??new Date()).toISOString();for(const entry of value.entries)entry.billing={mode:"metered",pricing:{version:1,basis:"native-account-model",nativeParameters:{reasoningEffort:"medium"},snapshot:structuredClone(options.nativePricing!)}};return value;};}
 const headers={authorization:"Bearer local-review-fixture"},draft={schemaVersion:1,clientDraftId:"fixture",title:"Review candidate",description:"Create result.txt",projectId:"local:repo",repositoryId:"repo",acceptanceCriteria:["file is correct"],scopePaths:["."],verificationCommandIds:[...(options.preparationRequired?(options.preparationScripts??[]).map((_,index)=>`prepare-${index}`):[]),"check"],startMode:"dispatch",execution:{profileId:"codex",selectionMode:"manual",selectionType:options.explicitModel?"explicit-model":"native-default",...(options.explicitModel?{nativeModelId:"fixture-model",nativeParameters:{reasoningEffort:"medium"},allowUnconfirmedModelAccess:true}:{})},delivery:{type:"none"}};
 if(options.explicitModel){const catalog=(await service.app.inject({method:"GET",url:"/api/agents/profiles/codex/models?repositoryId=repo",headers})).json();if(catalog.freshness!=="native-fresh")throw Error("FIXTURE_CATALOG:"+JSON.stringify(catalog));Object.assign(draft.execution,{catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint});}
 const preview=(await service.app.inject({method:"POST",url:"/api/task-publications/preview",headers,payload:draft})).json();if(!preview.canCommit)throw Error('FIXTURE_PREVIEW_FAILED');const receipt=(await service.app.inject({method:"POST",url:`/api/task-publications/${preview.publicationId}/commit`,headers:{...headers,"idempotency-key":"initial-start"},payload:{revision:preview.revision,reviewHash:preview.confirmation.reviewHash,confirmation:{accepted:true}}})).json();if(options.advance!==false){const response=await service.app.inject({method:"POST",url:`/api/runs/${receipt.runId}/advance`,headers});if(response.statusCode!==200||response.json().run.state!=="COMPLETE")throw Error('FIXTURE_ADVANCE_FAILED');}
 const results=service.localResults;
 return {root,service,results,headers,receipt,nativeInputs,starts:()=>options.ownedCli?(existsSync(counter)?Number(readFileSync(counter,"utf8")):0):starts,armSnapshotInvocation,pendingSnapshotInvocations:()=>invocationWaiters.size,close};
 }catch(error){record("fixture-setup-error",{message:String(error)});try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],"Fixture setup and cleanup failed",{cause:cleanupError});}throw error;}
}
