import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,cpSync,realpathSync,existsSync} from "node:fs";
import {join} from "node:path";import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import type {SecretStore} from "@dispatcher/config";
import {VerificationRegistry} from "@dispatcher/runner";
import {ControllerService} from "../../src/service.js";
export async function localReviewFixture(options:{verificationDelayMs?:number;advance?:boolean;verificationScript?:string;preparationScripts?:string[];preparationRequired?:boolean;verificationRequired?:boolean;preparationProfileId?:string}={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-local-review-"))),repo=join(root,"repo");let starts=0;
 const evidenceRoot=process.env.DISPATCHER_CANONICAL_SNAPSHOT_EVIDENCE;
 const evidence=evidenceRoot?join(evidenceRoot,randomUUID()):undefined;
 const observations:unknown[]=[];
 const record=(kind:string,value:unknown)=>{if(evidence)observations.push({kind,at:new Date().toISOString(),value});};
 const secrets=new Map<string,string>();
 const metadata=(reference:string)=>({reference,backend:"encrypted-local" as const,exists:secrets.has(reference)});
 const secretStore:SecretStore={async put(reference,value){secrets.set(reference,value);return metadata(reference);},async delete(reference){secrets.delete(reference);},async test(reference){return secrets.has(reference);},async metadata(reference){return metadata(reference);},async resolve(reference){const value=secrets.get(reference);if(value===undefined)throw Error("FIXTURE_SECRET_MISSING");return value;}};
 const originalRun=VerificationRegistry.prototype.run;
 const recordedRun:typeof originalRun=async function(commandId,cwd,signal){
  const owned=cwd.startsWith(root+"/");
  if(owned)record("verification-invoke",{command:this.list().find(command=>command.id===commandId),cwd,aborted:signal?.aborted});
  const abort=()=>{if(owned)record("verification-abort",{commandId,cwd});};signal?.addEventListener("abort",abort,{once:true});
  try{const result=await originalRun.call(this,commandId,cwd,signal);if(owned)record("verification-result",{commandId,cwd,result});return result;}
  catch(error){if(owned)record("verification-error",{commandId,cwd,message:String(error)});throw error;}
  finally{signal?.removeEventListener("abort",abort);}
 };
 if(evidence)VerificationRegistry.prototype.run=recordedRun;
 let current:ControllerService|undefined;
 const close=async()=>{
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
  }finally{if(evidence)VerificationRegistry.prototype.run=originalRun;rmSync(root,{recursive:true,force:true});}
 };
 try{mkdirSync(repo);const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{stdio:'pipe'});git('init','--initial-branch=main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'README.md'),'baseline\n');if(options.preparationScripts)writeFileSync(join(repo,'.gitignore'),'env.txt\n');git('add','.');git('commit','-m','baseline'); const service=new ControllerService({secretStore,dataDirectory:join(root,'data'),ownerToken:'local-review-fixture',withRunner:true,backgroundWorker:{enabled:false},codexBackendFactory:()=>({start(input){starts++;record("fake-native-start",input);if(evidence){mkdirSync(evidence,{recursive:true});cpSync(root,join(evidence,`native-input-${starts}`),{recursive:true});}writeFileSync(join(input.workspacePath,'result.txt'),'candidate\n');if(options.preparationScripts)writeFileSync(join(input.workspacePath,'env.txt'),'source-only');return {status:()=>"completed",result:async()=>({state:"completed",summary:"fixture completed",providerSessionId:"native-fixture",events:[]}),cancel:async()=>{}};}}),codexNativeReader:async input=>input.method==="account/read"?{account:{type:"chatgpt"},requiresOpenaiAuth:true}:{data:[{model:"fixture-model",displayName:"Fixture",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[]}],nextCursor:null}});
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
 await service.start({listen:false});const config=service.configuration.current().config;config.agentProfiles=[{id:"codex",alias:"Fixture",provider:"codex",runnerId:"local",settings:{codexHome:join(root,"native")}}];config.repositories=[{id:"repo",root:repo,defaultBaseRef:"main",scopePaths:[],...(options.preparationScripts?{snapshotVerification:{version:1 as const,id:options.preparationProfileId??"fixture-preparation",preparationCommandIds:options.preparationScripts.map((_,index)=>`prepare-${index}`)}}:{}),verificationCommands:[...(options.preparationScripts??[]).map((script,index)=>({id:`prepare-${index}`,file:process.execPath,args:["-e",script],required:options.preparationRequired??false,timeoutMs:5000,outputLimitBytes:4096})),{id:"check",file:process.execPath,args:["-e",options.verificationScript??`setTimeout(()=>{if(require('node:fs').readFileSync('result.txt','utf8')!=='candidate\\n')process.exit(1)},${options.verificationDelayMs??0})`],required:options.verificationRequired??true,timeoutMs:5000,outputLimitBytes:1024}]}];await service.configuration.applyPlan(service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});
 const headers={authorization:"Bearer local-review-fixture"},draft={schemaVersion:1,clientDraftId:"fixture",title:"Review candidate",description:"Create result.txt",projectId:"local:repo",repositoryId:"repo",acceptanceCriteria:["file is correct"],scopePaths:["."],verificationCommandIds:[...(options.preparationRequired?(options.preparationScripts??[]).map((_,index)=>`prepare-${index}`):[]),"check"],startMode:"dispatch",execution:{profileId:"codex",selectionMode:"manual",selectionType:"native-default"},delivery:{type:"none"}};
 const preview=(await service.app.inject({method:"POST",url:"/api/task-publications/preview",headers,payload:draft})).json();if(!preview.canCommit)throw Error('FIXTURE_PREVIEW_FAILED');const receipt=(await service.app.inject({method:"POST",url:`/api/task-publications/${preview.publicationId}/commit`,headers:{...headers,"idempotency-key":"initial-start"},payload:{revision:preview.revision,reviewHash:preview.confirmation.reviewHash,confirmation:{accepted:true}}})).json();if(options.advance!==false){const response=await service.app.inject({method:"POST",url:`/api/runs/${receipt.runId}/advance`,headers});if(response.statusCode!==200||response.json().run.state!=="COMPLETE")throw Error('FIXTURE_ADVANCE_FAILED');}
 const results=service.localResults;
 return {root,service,results,headers,receipt,starts:()=>starts,close};
 }catch(error){record("fixture-setup-error",{message:String(error)});try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],"Fixture setup and cleanup failed",{cause:cleanupError});}throw error;}
}
