import {chmodSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {ExecutionContextRef,ExecutionSelection,NativeBinding,NativeTurnFact} from "@dispatcher/domain";
import * as common from "../src/index.js";
import type * as commonTypes from "../src/index.js";
import * as rpc from "../src/copilot.js";
import {CopilotAdapter,CopilotExecutionBackend} from "../src/copilot-execution.js";
const adapters={...common,...rpc};

interface Scope extends rpc.CopilotRpcScope {profileId:string;runnerId:string;nativeStoreRef:string}
interface Backend extends commonTypes.CliAgentBackend {hasActiveOperations():boolean;beginShutdown():void;disconnectLocal():Promise<commonTypes.LocalRuntimeDisconnect>}
const api={CopilotExecutionBackend,CopilotAdapter};
const roots:string[]=[],backends:Backend[]=[];
afterEach(async()=>{await Promise.all(backends.splice(0).map(b=>b.disconnectLocal()));vi.restoreAllMocks();for(const root of roots.splice(0)){captureFixture(root,"teardown");rmSync(root,{recursive:true,force:true});}});
const ref:ExecutionContextRef={version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repository",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"codex/execution",baseRevision:"base"};
const model:ExecutionSelection={version:1,mode:"manual",selectionType:"explicit-model",source:"explicit",profileId:"local-copilot",providerId:"copilot",backendId:"copilot-rpc",runnerId:"local",configRevision:1,contextFingerprint:"fixture",selectedAt:"2026-10-13T00:00:00Z",requestedModel:"chosen",nativeParameters:{}};
const nativeId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const closed:commonTypes.LocalRuntimeDisconnect={version:1,connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false};
const result:rpc.CopilotPromptResult={messageId:"message-1",nativeStopReason:"idle",executionEvidence:true,toolFailure:false,permissionDenied:false,pendingTools:0};
function fixture(mode="normal"){
 const root=mkdtempSync(join(realpathSync(tmpdir()),"dispatcher-copilot-execution-"));roots.push(root);
 const scope:Scope={executable:join(root,"copilot"),workspacePath:join(root,"workspace"),copilotHome:join(root,"home"),profileId:model.profileId,runnerId:"local",nativeStoreRef:"native-store:fixture"};
 mkdirSync(scope.workspacePath);mkdirSync(scope.copilotHome);writeFileSync(scope.executable,"fixture");writeFileSync(join(scope.copilotHome,"native-file"),"preserve");
 const calls:string[]=[],saved:NativeBinding[]=[],facts:NativeTurnFact[]=[],requestedModels:string[]=[];let options:rpc.CopilotExecutionOptions|undefined;
 const client={
  connectionScope:{executable:scope.executable,workspacePath:scope.workspacePath,copilotHome:scope.copilotHome},
  async bootstrap(input:rpc.CopilotBootstrapInput){
   options!.beforeMutation();calls.push("create");requestedModels.push(input.model);
   if(mode==="bootstrap-unknown")throw new adapters.AdapterStartError("unknown","COPILOT_RPC_OUTCOME_UNKNOWN","static");
   await input.onSessionKnown(nativeId);calls.push("bound");
   if(mode==="model-drift")throw new adapters.AdapterStartError("unknown","COPILOT_RPC_MODEL_DRIFT","static");
   return {sessionId:nativeId,modelId:"chosen"};
  },
  async prompt(input:{sessionId:string;message:string},o:rpc.CopilotPromptOptions){
   options!.beforeMutation();expect(input.sessionId).toBe(nativeId);expect(input.message).toBe("original-prompt");calls.push("prompt");
   if(mode!=="no-evidence")o.onUpdate?.({kind:"activity",sessionId:nativeId});
   return {...result,...(mode==="no-evidence"?{executionEvidence:false}:mode==="tool-failed"?{toolFailure:true}:mode==="permission-denied"?{permissionDenied:true}:mode==="tool-pending"?{pendingTools:1}:mode==="aborted"?{nativeStopReason:"aborted" as const}:{})};
  },
  async close(){calls.push("close");return {...closed,...(mode==="unknown-close"?{connection:"unknown" as const,callbacks:"unknown" as const}:{})};},
 };
 vi.spyOn(rpc.CopilotRpcClient,"openExecution").mockImplementation(async(_scope,o)=>{
  options=o;calls.push("open");if(mode==="open-failure")throw new adapters.AdapterContractError("COPILOT_RPC_UNREACHABLE","static");return client as unknown as rpc.CopilotRpcClient;
 });
 const input:commonTypes.CliStartInput={executable:scope.executable,args:[],workspacePath:scope.workspacePath,executionRef:structuredClone(ref),beforePrompt:()=>{},onBinding:async binding=>{saved.push(structuredClone(binding));},onNativeEvent:fact=>{facts.push(structuredClone(fact));},nativeInput:{version:1,profileId:scope.profileId,backendId:"copilot-rpc",runId:"run",sessionId:"dispatcher-session",commandId:"command",newSession:true,prompt:"original-prompt",approveTools:false,executionSelection:structuredClone(model)}};
 const backend=()=>{const b=new api.CopilotExecutionBackend({scope,executionRef:ref});backends.push(b);return b;};
 return {root,scope,input,backend,calls,saved,facts,requestedModels,client};
}
it("persists exact binding before input and maps guarded native facts without raw content",async()=>{
 const f=fixture(),b=f.backend(),turn=b.start(f.input);await turn.ready?.();expect(await turn.result()).toMatchObject({state:"completed",providerSessionId:nativeId});
 expect(f.calls.slice(0,4)).toEqual(["open","create","bound","prompt"]);expect(f.saved).toEqual([{version:1,product:"copilot",region:"global",profileId:model.profileId,backendId:"copilot-rpc",runnerId:"local",nativeStoreRef:"native-store:fixture",nativeSessionId:nativeId,identityState:"bound",executionRefId:ref.id}]);
 expect(f.facts.map(v=>v.state)).toEqual(["running","completed"]);expect(JSON.stringify([f.facts,await turn.result()])).not.toContain("original-prompt");
});
it.each(["model","profile","execution","environment","argv","approve","resume","reasoning","provider-id","native-id"])("rejects invalid original %s before native acquisition",mode=>{
 const f=fixture(),b=f.backend(),n=f.input.nativeInput!;
 if(mode==="model")delete n.executionSelection;if(mode==="profile")n.profileId="sibling";if(mode==="execution")f.input.executionRef!.id="sibling";
 if(mode==="environment")f.input.environment={GITHUB_TOKEN:"private-token"};if(mode==="argv")f.input.args=["--resume","latest"];
 if(mode==="approve")n.approveTools=true;if(mode==="resume")n.newSession=false;if(mode==="reasoning")n.executionSelection!.nativeParameters={reasoningEffort:"high"};if(mode==="provider-id")n.providerSessionId=nativeId;
 if(mode==="native-id")n.executionSelection!.requestedModel="chosen\nother";
 expect(()=>b.start(f.input)).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.calls).toEqual([]);
});
it("captures original input/model/ref/Guard and callbacks before acquisition",async()=>{
 const f=fixture(),b=f.backend(),turn=b.start(f.input);f.input.beforePrompt=()=>{throw Error("replacement");};f.input.onBinding=async()=>{throw Error("replacement");};f.input.onNativeEvent=()=>{throw Error("replacement");};
 f.input.nativeInput!.prompt="replacement";f.input.nativeInput!.executionSelection!.requestedModel="replacement";f.input.executionRef!.id="replacement";
 await turn.ready?.();expect((await turn.result()).state).toBe("completed");expect(f.saved).toHaveLength(1);expect(f.facts).toHaveLength(2);
});
it("refuses a Promise Guard synchronously before native acquisition",()=>{
 const f=fixture(),b=f.backend();f.input.beforePrompt=async()=>{};expect(()=>b.start(f.input)).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.calls).toEqual([]);
});
it("captures nativeInput getter once without replacing the frozen original model",async()=>{
 const f=fixture(),b=f.backend(),original=f.input.nativeInput!,replacement={...structuredClone(original),executionSelection:{...model,requestedModel:"different"}};
 let reads=0;Object.defineProperty(f.input,"nativeInput",{enumerable:true,get:()=>++reads===1?original:replacement});
 const turn=b.start(f.input);await turn.ready?.();await turn.result();expect(reads).toBe(1);expect(f.requestedModels).toEqual(["chosen"]);
});
it("does not invoke an untracked 65th asynchronous Guard after consumer capacity is full",async()=>{
 const f=fixture(),b=f.backend(),gates:Array<ReturnType<typeof Promise.withResolvers<void>>>=[];
 f.input.beforePrompt=()=>{const gate=Promise.withResolvers<void>();gates.push(gate);return gate.promise;};
 try{for(let i=0;i<65;i++)expect(()=>b.start(f.input)).toThrow();expect(gates).toHaveLength(64);expect(f.calls).toEqual([]);}
 finally{for(const gate of gates)gate.resolve();}
 expect(await b.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"not-created",callbacks:"drained"});
});
it("refuses prompt after failed original known-binding persistence",async()=>{
 const f=fixture(),b=f.backend();f.input.onBinding=async()=>{throw Error("private-persistence");};const turn=b.start(f.input);
 await expect(turn.ready?.()).rejects.toMatchObject({creationOutcome:"unknown"});await expect(turn.result()).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.calls).not.toContain("prompt");
});
it.each(["model-drift","bootstrap-unknown"])("retains %s as unknown without retry or later input",async mode=>{
 const f=fixture(mode),b=f.backend(),turn=b.start(f.input);await expect(turn.ready?.()).rejects.toMatchObject({creationOutcome:"unknown"});
 await expect(turn.result()).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.calls.filter(v=>v==="create")).toHaveLength(1);expect(f.calls).not.toContain("prompt");expect(()=>b.start(f.input)).toThrow();
 if(mode==="model-drift")expect(f.saved).toHaveLength(1);
});
it("rechecks original Guard after binding persistence and refuses native input",async()=>{
 const f=fixture(),b=f.backend();let allowed=true;f.input.beforePrompt=()=>{if(!allowed)throw Error("private-revoked");};f.input.onBinding=async binding=>{f.saved.push(binding);allowed=false;};const turn=b.start(f.input);
 await expect(turn.ready?.()).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.calls).not.toContain("prompt");
});
it.each(["no-evidence","tool-failed","permission-denied","tool-pending","aborted"])("does not promote %s result to completed",async mode=>{
 const f=fixture(mode),b=f.backend(),turn=b.start(f.input);await turn.ready?.();expect((await turn.result()).state).toBe(mode==="aborted"?"cancelled":"failed");
 expect(f.facts.some(v=>v.state==="completed")).toBe(false);
});
it("refuses final completed emission when running callback revokes original authority",async()=>{
 const f=fixture(),b=f.backend();let allowed=true;f.input.beforePrompt=()=>{if(!allowed)throw Error("private-revoked");};f.input.onNativeEvent=fact=>{f.facts.push(fact);if(fact.state==="running")allowed=false;};const turn=b.start(f.input);
 await expect(turn.ready?.()).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.facts.some(v=>v.state==="completed")).toBe(false);
});
it("admits only one managed creation and closes only the local receipt",async()=>{
 const f=fixture(),b=f.backend(),turn=b.start(f.input);expect(()=>b.start(f.input)).toThrow();await turn.ready?.();await turn.result();
 expect(await b.disconnectLocal()).toMatchObject(closed);expect(existsSync(join(f.scope.copilotHome,"native-file"))).toBe(true);
});
it("retains unknown close receipt and does not infer writer or native Session deletion",async()=>{
 const f=fixture("unknown-close"),b=f.backend(),turn=b.start(f.input);await turn.ready?.();await turn.result();
 expect(await b.disconnectLocal()).toMatchObject({connection:"unknown",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false});
});
it("retains unconfirmed acquisition cleanup after a failed open",async()=>{
 const f=fixture("open-failure"),b=f.backend(),turn=b.start(f.input);await expect(turn.ready?.()).rejects.toMatchObject({creationOutcome:"not-created"});await expect(turn.result()).rejects.toMatchObject({creationOutcome:"not-created"});
 expect(await b.disconnectLocal()).toMatchObject({connection:"unknown",ownedRoot:"unknown",callbacks:"unknown"});expect(f.calls).not.toContain("create");
});
it("refuses changed physical native home before acquiring a child",()=>{
 const f=fixture(),b=f.backend();renameSync(f.scope.copilotHome,f.scope.copilotHome+"-old");mkdirSync(f.scope.copilotHome);
 expect(()=>b.start(f.input)).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.calls).toEqual([]);
});
it("requires the explicit dedicated backend and preserves native binding in Adapter Session",async()=>{
 const f=fixture(),b=f.backend(),adapter=new api.CopilotAdapter({id:model.profileId,alias:"Copilot",executable:f.scope.executable},b);
 adapter.setNativeEventSink(()=>{},()=>()=>true);
 const session=await adapter.start({runId:"run",sessionId:"dispatcher-session",workspacePath:f.scope.workspacePath,prompt:"original-prompt",executionRef:ref,executionSelection:model,execution:{generation:1,attempt:1,leaseId:"lease"},beforeCreate:()=>{},beforeSend:()=>{},backendId:"copilot-rpc"});
 expect(session.nativeBinding).toMatchObject({nativeSessionId:nativeId,product:"copilot"});expect(session.providerSessionId).toBe(nativeId);expect((await adapter.result(session.id)).summary).not.toContain("original-prompt");
 expect(await adapter.modelCatalog({profileId:model.profileId,runnerId:"local",repositoryId:"repository",executionContextRef:ref.id,reason:"before-start",workspacePath:f.scope.workspacePath})).toMatchObject({freshness:"unverified",selectionSupport:"unsupported",entries:[],failure:{code:"MODEL_CATALOG_UNSUPPORTED"}});expect(adapter.manifest.capabilities.resume).toBe(false);
 expect(()=>new api.CopilotAdapter({id:"other",alias:"Other"},new adapters.SpawnCliAgentBackend())).toThrow();
});
it("retains the known binding and unknown callback drain through shutdown during persistence",async()=>{
 const f=fixture(),b=f.backend(),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();
 f.input.onBinding=binding=>{f.saved.push(binding);entered.resolve();return gate.promise;};const turn=b.start(f.input),admitted=turn.ready!().catch(e=>e),outcome=turn.result().catch(e=>e);await entered.promise;
 try{expect(await b.disconnectLocal()).toMatchObject({callbacks:"unknown",nativeSessionDeleted:false});expect(f.saved).toHaveLength(1);expect(f.calls).not.toContain("prompt");}
 finally{gate.resolve();await admitted;await outcome;}
});
it("tracks but refuses an unresolved native event callback and retains unknown drain",async()=>{
 const f=fixture(),b=f.backend(),gate=Promise.withResolvers<void>();f.input.onNativeEvent=()=>gate.promise;const turn=b.start(f.input);
 try{await expect(turn.ready?.()).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_CALLBACK_FAILED"});await expect(turn.result()).rejects.toMatchObject({creationOutcome:"unknown"});expect((await b.disconnectLocal()).callbacks).toBe("unknown");}
 finally{gate.resolve();}
});
it("retains an unresolved acquisition as unknown instead of inventing no child",async()=>{
 const f=fixture(),gate=Promise.withResolvers<rpc.CopilotRpcClient>();vi.spyOn(rpc.CopilotRpcClient,"openExecution").mockImplementation(()=>gate.promise);
 const b=f.backend(),turn=b.start(f.input),admitted=turn.ready!().catch(e=>e),outcome=turn.result().catch(e=>e);
 try{expect(await b.disconnectLocal()).toMatchObject({connection:"unknown",ownedRoot:"unknown",callbacks:"unknown"});}
 finally{gate.reject(new adapters.AdapterContractError("COPILOT_RPC_UNREACHABLE","static"));await admitted;await outcome;}
});
it("uses real owned stdio and Adapter persistence before native input without deleting files",async()=>{
 const f=fixture();vi.restoreAllMocks();
 writeFileSync(f.scope.executable,[
  "#!"+process.execPath,
  "const fs=require('node:fs'),path=require('node:path');const root="+JSON.stringify(f.root)+";let buffer=Buffer.alloc(0),sessionId,model;",
  "const frame=v=>{const body=Buffer.from(JSON.stringify(v));return Buffer.concat([Buffer.from('Content-Length: '+body.length+'\\r\\n\\r\\n'),body]);};",
  "const emit=v=>process.stdout.write(frame(v));const event=(type,data)=>({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type,data}}});",
  "function respond(m){let result={};if(m.method==='connect')result={protocolVersion:3};else if(m.method==='status.get')result={protocolVersion:3,version:'1.0.97'};else if(m.method==='session.create'){sessionId=m.params.sessionId;model=m.params.model;result={sessionId};}",
  "else if(m.method==='session.getMetadata')result={session:{sessionId,startTime:'2026-10-13T00:00:00Z',modifiedTime:'2026-10-13T00:00:00Z',isRemote:false,context:{cwd:process.cwd()}}};else if(m.method==='session.model.getCurrent')result={modelId:model};",
  "else if(m.method==='session.send'){fs.writeFileSync(path.join(root,'native-input'),JSON.stringify({bindingPersisted:fs.existsSync(path.join(root,'persisted')),args:process.argv.slice(2),cwd:process.cwd(),home:process.env.COPILOT_HOME,sessionId}));const messageId='wire-1';process.stdout.write(Buffer.concat([frame({jsonrpc:'2.0',id:m.id,result:{messageId}}),frame(event('user.message',{messageId,content:m.params.prompt})),frame(event('assistant.message',{messageId:'answer-1',originatingMessageId:messageId,content:'private-native-output',model})),frame(event('session.idle',{}))]));return;}emit({jsonrpc:'2.0',id:m.id,result});}",
  "process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const at=buffer.indexOf('\\r\\n\\r\\n');if(at<0)return;const size=Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0,at).toString())[1]);if(buffer.length<at+4+size)return;const m=JSON.parse(buffer.subarray(at+4,at+4+size).toString());buffer=buffer.subarray(at+4+size);respond(m);}});setInterval(()=>{},1000);",
 ].join("\n"),{mode:0o755});chmodSync(f.scope.executable,0o755);
 const b=f.backend(),adapter=new api.CopilotAdapter({id:model.profileId,alias:"Copilot",executable:f.scope.executable},b);
 class Store extends adapters.MemorySessionStore {override save(session:commonTypes.AdapterSession){super.save(session);if(session.nativeBinding)writeFileSync(join(f.root,"persisted"),"saved");}}
 const store=new Store(),owned=new api.CopilotAdapter(adapter.profile,b,store);
 owned.setNativeEventSink(event=>{expect(store.load(event.sessionId)?.nativeBinding).toEqual(event.nativeBinding);},()=>()=>true);
 captureFixture(f.root,"before-spawn");
 const session=await owned.start({runId:"run",sessionId:"dispatcher-session",workspacePath:f.scope.workspacePath,prompt:"original-prompt",executionRef:ref,executionSelection:model,execution:{generation:1,attempt:1,leaseId:"lease"},beforeCreate:()=>{},beforeSend:()=>{},backendId:"copilot-rpc"});
 expect(session.nativeBinding?.nativeSessionId).toMatch(/^[a-f0-9-]{36}$/);expect(session.nativeBinding?.nativeSessionId).not.toBe(nativeId);
 const wire=JSON.parse(readFileSync(join(f.root,"native-input"),"utf8"));expect(wire).toMatchObject({bindingPersisted:true,args:["--headless","--no-auto-update","--stdio"],cwd:f.scope.workspacePath,home:f.scope.copilotHome,sessionId:session.nativeBinding?.nativeSessionId});
 expect((await owned.result(session.id)).summary).not.toContain("private-native-output");expect(await b.disconnectLocal()).toMatchObject(closed);expect(existsSync(join(f.scope.copilotHome,"native-file"))).toBe(true);
 const receipt=await b.disconnectLocal();expect(receipt.ownedRootPid).toBeGreaterThan(0);let rootAbsent=false;
 try{process.kill(receipt.ownedRootPid!,0);}catch(error){rootAbsent=(error as NodeJS.ErrnoException).code==="ESRCH";}
 expect(rootAbsent).toBe(true);writeFileSync(join(f.root,"local-cleanup.json"),JSON.stringify({receipt,rootAbsent,source:"actual-owned-stdio",nativeFilesRetained:existsSync(join(f.scope.copilotHome,"native-file"))},null,2));
});

// The original Guard can reenter cleanup before returning its raw asynchronous work.
it("reserves original Guard ownership before reentrant shutdown",async()=>{
 const f=fixture(),b=f.backend(),gate=Promise.withResolvers<void>();let cleanup:Promise<commonTypes.LocalRuntimeDisconnect>|undefined,active=false;
 f.input.beforePrompt=()=>{active=b.hasActiveOperations();cleanup=b.disconnectLocal();return gate.promise;};
 try{expect(()=>b.start(f.input)).toThrow();expect(active).toBe(true);expect((await cleanup!).callbacks).toBe("unknown");}
 finally{gate.resolve();}
 expect((await b.disconnectLocal()).callbacks).toBe("unknown");
});

function captureFixture(root:string,phase:string){
 const destination=process.env.DISPATCHER_COPILOT_FIXTURE_EVIDENCE;if(!destination)return;
 const identity=createHash("sha256").update(join(root,"copilot")).digest("hex"),target=join(destination,identity,phase);mkdirSync(target,{recursive:true});cpSync(root,join(target,"files"),{recursive:true});
 const executable=join(root,"copilot"),bytes=readFileSync(executable);
 writeFileSync(join(target,"identity.json"),JSON.stringify({root,executable,sha256:createHash("sha256").update(bytes).digest("hex"),utc:new Date().toISOString(),phase,intendedRealStdio:phase==="before-spawn"},null,2));
}

it.each(["beforePrompt","onBinding","onNativeEvent"] as const)("captures the original %s getter and receiver exactly once",async field=>{
 const f=fixture(),b=f.backend(),original=f.input[field]!;let reads=0,calls=0;
 const callback=function(this:commonTypes.CliStartInput,value:never){expect(this).toBe(f.input);calls++;return Reflect.apply(original,this,[value]);};
 Object.defineProperty(f.input,field,{enumerable:true,get:()=>{reads++;return reads===1?callback:()=>{throw Error("replacement getter");};}});
 const turn=b.start(f.input);await turn.ready!();expect((await turn.result()).state).toBe("completed");expect(reads).toBe(1);expect(calls).toBeGreaterThan(0);
});
it("normalizes the original forbidden Guard thenable once and owns its raw settlement",async()=>{
 const f=fixture(),b=f.backend();let reads=0,invocations=0,release!:()=>void;
 const thenable={get then(){reads++;return (resolve:()=>void)=>{invocations++;release=resolve;};}};
 f.input.beforePrompt=()=>thenable as unknown as void;
 expect(()=>b.start(f.input)).toThrow();await Promise.resolve();expect(reads).toBe(1);expect(invocations).toBe(1);expect(b.hasActiveOperations()).toBe(true);
 try{expect(await b.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"not-created",callbacks:"unknown"});}
 finally{release();}
 await vi.waitFor(()=>expect(b.hasActiveOperations()).toBe(false));expect((await b.disconnectLocal()).callbacks).toBe("unknown");expect(invocations).toBe(1);
});
it("does not admit another managed creation through a reentrant original Guard",async()=>{
 const f=fixture(),b=f.backend();let entered=false,rejected=false;
 f.input.beforePrompt=()=>{if(!entered){entered=true;try{b.start(f.input);}catch{rejected=true;}}};
 const turn=b.start(f.input);await turn.ready!();await turn.result();expect(rejected).toBe(true);expect(f.calls.filter(call=>call==="open")).toHaveLength(1);expect(f.calls.filter(call=>call==="create")).toHaveLength(1);
});
it.each(["binding","running"] as const)("owns raw %s callback before it reenters shutdown",async phase=>{
 const f=fixture(),b=f.backend(),gate=Promise.withResolvers<void>();let cleanup:Promise<commonTypes.LocalRuntimeDisconnect>|undefined;
 const callback=()=>{expect(b.hasActiveOperations()).toBe(true);cleanup=b.disconnectLocal();return gate.promise;};
 if(phase==="binding")f.input.onBinding=callback;else f.input.onNativeEvent=callback;
 const turn=b.start(f.input);await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});await expect(turn.result()).rejects.toMatchObject({creationOutcome:"unknown"});
 try{expect((await cleanup!).callbacks).toBe("unknown");expect(b.hasActiveOperations()).toBe(true);}
 finally{gate.resolve();}
 await vi.waitFor(()=>expect(b.hasActiveOperations()).toBe(false));expect((await b.disconnectLocal()).callbacks).toBe("unknown");if(phase==="binding")expect(f.calls).not.toContain("prompt");
});
it("awaits asynchronous original binding before prompt and readiness",async()=>{
 const f=fixture(),b=f.backend(),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();let ready=false;
 f.input.onBinding=async binding=>{f.saved.push(binding);entered.resolve();await gate.promise;};const turn=b.start(f.input),readiness=turn.ready!().then(()=>{ready=true;});
 await entered.promise;expect(ready).toBe(false);expect(f.calls).not.toContain("prompt");gate.resolve();await readiness;expect((await turn.result()).state).toBe("completed");expect(f.saved).toHaveLength(1);
});
it("accepts asynchronous fact durability in original serial order",async()=>{
 const f=fixture(),b=f.backend();f.input.onNativeEvent=async fact=>{await Promise.resolve();f.facts.push(fact);};
 const turn=b.start(f.input);await turn.ready!();expect(f.facts[0]?.state).toBe("running");expect((await turn.result()).state).toBe("completed");expect(f.facts.map(f=>f.state)).toEqual(["running","completed"]);
});
it("does not turn a rejected terminal callback into successful completion or user cancellation",async()=>{
 const f=fixture(),b=f.backend();f.input.onNativeEvent=async fact=>{if(fact.state==="completed")throw Error("private rejected terminal");};
 const turn=b.start(f.input);await turn.ready!();expect((await turn.result()).state).toBe("failed");
});
it("bounds a real queue of individually fast callbacks at the aggregate terminal checkpoint",async()=>{
 const f=fixture(),b=f.backend(),entered=Promise.withResolvers<void>();let callbacks=0;
 f.client.prompt=async(_input,options)=>{for(let i=0;i<12;i++)options.onUpdate?.({kind:"activity",sessionId:nativeId});return {...result};};
 f.input.onNativeEvent=async fact=>{if(fact.state==="running"){callbacks++;entered.resolve();await new Promise(resolve=>setTimeout(resolve,100));}f.facts.push(fact);};
 const started=performance.now(),turn=b.start(f.input);await entered.promise;await turn.ready!();expect((await turn.result()).state).toBe("failed");expect(performance.now()-started).toBeLessThan(1500);expect(callbacks).toBeLessThan(12);expect(f.facts.some(f=>f.state==="completed")).toBe(false);
});
it("retains raw late acquisition after public cancellation and never upgrades cached unknown",async()=>{
 const f=fixture(),b=f.backend(),gate=Promise.withResolvers<rpc.CopilotRpcClient>();vi.spyOn(rpc.CopilotRpcClient,"openExecution").mockImplementation(()=>gate.promise);
 const turn=b.start(f.input);b.beginShutdown();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});await expect(turn.result()).rejects.toThrow();expect(b.hasActiveOperations()).toBe(true);
 const receipt=await b.disconnectLocal();expect(receipt).toMatchObject({connection:"unknown",ownedRoot:"unknown",callbacks:"unknown"});receipt.callbacks="drained";
 gate.resolve(f.client as unknown as rpc.CopilotRpcClient);await vi.waitFor(()=>expect(b.hasActiveOperations()).toBe(false));expect((await b.disconnectLocal()).callbacks).toBe("unknown");expect(f.calls).not.toContain("create");
});
it("retains raw close after its bound and blocks replacement without mutating the cached receipt",async()=>{
 const f=fixture(),b=f.backend(),gate=Promise.withResolvers<commonTypes.LocalRuntimeDisconnect>();f.client.close=async()=>gate.promise;
 const turn=b.start(f.input);await turn.ready!();await turn.result();expect(await b.disconnectLocal()).toMatchObject({connection:"unknown",ownedRoot:"unknown",callbacks:"unknown"});expect(b.hasActiveOperations()).toBe(true);
 gate.resolve(closed);await vi.waitFor(()=>expect(b.hasActiveOperations()).toBe(false));expect(await b.disconnectLocal()).toMatchObject({connection:"unknown",ownedRoot:"unknown",callbacks:"unknown"});expect(()=>b.start(f.input)).toThrow();
});
it("proves no acquisition and drained callbacks separately from unknown acquisition",async()=>{
 const f=fixture(),b=f.backend();expect(b.hasActiveOperations()).toBe(false);expect(await b.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"not-created",callbacks:"drained"});expect(f.calls).toEqual([]);
});
it.each(["profileId","providerId","backendId","runnerId"] as const)("rejects canonical Copilot selection %s drift before acquisition",field=>{
 const f=fixture(),b=f.backend();f.input.nativeInput!.executionSelection![field]="foreign";expect(()=>b.start(f.input)).toThrow();expect(f.calls).toEqual([]);
});
it.each(["modelSelection","legacyModel"])("rejects obsolete %s authority alongside canonical selection",field=>{
 const f=fixture(),b=f.backend();Object.assign(f.input.nativeInput!,{[field]:{id:"chosen"}});expect(()=>b.start(f.input)).toThrow(expect.objectContaining({code:"MODEL_LEGACY_REVIEW_REQUIRED"}));expect(f.calls).toEqual([]);
});
it.each(["native-default","empty-model","bad-model","parameter","runner","providerSessionId"])("refuses unqualified %s before acquisition",mode=>{
 const f=fixture(),b=f.backend(),n=f.input.nativeInput!,selection=n.executionSelection!;
 if(mode==="native-default"){selection.selectionType="native-default";selection.source="native-default";delete selection.requestedModel;}
 if(mode==="empty-model")selection.requestedModel="";if(mode==="bad-model")(selection as unknown as Record<string,unknown>).requestedModel=42;
 if(mode==="parameter")selection.nativeParameters={reasoningEffort:"high"};if(mode==="runner")selection.runnerId="other";if(mode==="providerSessionId")n.providerSessionId=undefined;
 expect(()=>b.start(f.input)).toThrow();expect(f.calls).toEqual([]);
});
it("keeps the exact prompt byte cap, timeout and bounded sanitized activity",async()=>{
 const invalid=fixture(),rejected=invalid.backend();invalid.input.nativeInput!.prompt="x".repeat(196609);expect(()=>rejected.start(invalid.input)).toThrow();expect(invalid.calls).toEqual([]);
 const f=fixture(),b=f.backend();f.input.nativeInput!.prompt="x".repeat(196608);
 f.client.prompt=async(input,options)=>{expect(Buffer.byteLength(input.message)).toBe(196608);expect(options.timeoutMs).toBe(30000);for(let i=0;i<300;i++)options.onUpdate?.({kind:"activity",sessionId:nativeId});return {...result};};
 const turn=b.start(f.input);await turn.ready!();const outcome=await turn.result();expect(outcome.state).toBe("completed");expect(outcome.events).toHaveLength(256);expect(JSON.stringify(outcome.events)).not.toContain("xxx");
});
function adapterInput(f:ReturnType<typeof fixture>):commonTypes.AdapterStartInput{
 return {runId:"run",sessionId:"dispatcher-session",workspacePath:f.scope.workspacePath,prompt:"original-prompt",executionRef:ref,executionSelection:model,execution:{generation:1,attempt:1,leaseId:"lease"},beforeCreate:()=>{},beforeSend:()=>{},backendId:"copilot-rpc"};
}
it.each(["waiting","running","completed"] as const)("canonical observer retains pending %s durability through public cancellation",async phase=>{
 const f=fixture(),b=f.backend(),store=new adapters.MemorySessionStore(),adapter=new CopilotAdapter({id:model.profileId,alias:"Copilot",executable:f.scope.executable},b,store),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();let active=true,started=false;
 adapter.setNativeEventSink(async event=>{expect(event).toMatchObject({nativeSessionId:nativeId,generation:1,attempt:1,leaseId:"lease"});expect(store.load(event.sessionId)?.nativeBinding).toEqual(event.nativeBinding);if(event.turn.state===phase){entered.resolve();await gate.promise;}},()=>()=>active);
 const starting=adapter.start(adapterInput(f)).then(session=>{started=true;return session;});void starting.catch(()=>{});await entered.promise;
 expect(store.load("dispatcher-session")?.nativeBinding?.nativeSessionId).toBe(nativeId);if(phase!=="completed")expect(started).toBe(false);if(phase==="waiting")expect(f.calls).not.toContain("prompt");
 let outcome:Promise<unknown>|undefined;if(phase==="completed"){const session=await starting;let settled=false;outcome=adapter.result(session.id).then(value=>{settled=true;return value;});await Promise.resolve();expect(settled).toBe(false);}
 b.beginShutdown();active=false;if(phase!=="completed")await expect(starting).rejects.toMatchObject({creationOutcome:"unknown"});else await expect(outcome).rejects.toMatchObject({code:"STALE_NATIVE_OBSERVER"});
 expect((await b.disconnectLocal()).callbacks).toBe("unknown");expect(b.hasActiveOperations()).toBe(true);const count=f.calls.filter(call=>call==="prompt").length;gate.resolve();await vi.waitFor(()=>expect(b.hasActiveOperations()).toBe(false));expect((await b.disconnectLocal()).callbacks).toBe("unknown");expect(f.calls.filter(call=>call==="prompt")).toHaveLength(count);
});
it.each(["waiting","running","completed"] as const)("canonical observer fences rejected %s durability and retains exact identity",async phase=>{
 const f=fixture(),b=f.backend(),store=new adapters.MemorySessionStore(),adapter=new CopilotAdapter({id:model.profileId,alias:"Copilot",executable:f.scope.executable},b,store);
 adapter.setNativeEventSink(async event=>{await Promise.resolve();if(event.turn.state===phase)throw Error("private rejected sink");},()=>()=>true);
 const starting=adapter.start(adapterInput(f));if(phase==="completed"){const session=await starting;expect((await adapter.result(session.id)).state).toBe("FAILED");}else await expect(starting).rejects.toMatchObject({creationOutcome:"unknown"});
 expect(store.load("dispatcher-session")).toMatchObject({providerSessionId:nativeId,nativeBinding:{nativeSessionId:nativeId},nativeIdentityIssue:"NATIVE_EVENT_PERSISTENCE_FAILED"});if(phase==="waiting")expect(f.calls).not.toContain("prompt");
});

it("retains unknown creation after admitted mutation before the binding response",async()=>{
 const f=fixture(),b=f.backend(),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>(),bootstrap=f.client.bootstrap.bind(f.client);
 f.client.bootstrap=input=>bootstrap({...input,onSessionKnown:async id=>{entered.resolve();await gate.promise;await input.onSessionKnown(id);}});
 const turn=b.start(f.input);await entered.promise;b.beginShutdown();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});await expect(turn.result()).rejects.toMatchObject({creationOutcome:"unknown"});
 try{expect((await b.disconnectLocal()).callbacks).toBe("unknown");expect(b.hasActiveOperations()).toBe(true);}
 finally{gate.resolve();}
 await vi.waitFor(()=>expect(b.hasActiveOperations()).toBe(false));expect(f.calls).not.toContain("prompt");expect((await b.disconnectLocal()).callbacks).toBe("unknown");
});
it("reports precise owning Copilot admission failure before native acquisition",async()=>{
 const f=fixture(),b=f.backend(),adapter=new CopilotAdapter({id:model.profileId,alias:"Copilot",executable:f.scope.executable},b);adapter.setNativeEventSink(()=>{},()=>()=>true);
 const input=adapterInput(f);delete input.execution;await expect(adapter.start(input)).rejects.toMatchObject({creationOutcome:"not-created",code:"COPILOT_RPC_START_INVALID"});expect(f.calls).toEqual([]);expect(adapter.supportsExecutionRef).toBe(true);
});

it("retains the native stop fence with the precise Copilot diagnostic",async()=>{
 const f=fixture(),b=f.backend(),adapter=new CopilotAdapter({id:model.profileId,alias:"Copilot",executable:f.scope.executable},b);adapter.setNativeEventSink(()=>{},()=>()=>true);
 const session=await adapter.start(adapterInput(f));await adapter.result(session.id);const calls=[...f.calls];
 await expect(adapter.cancel(session.id)).rejects.toMatchObject({code:"COPILOT_RPC_STOP_UNQUALIFIED"});expect(f.calls).toEqual(calls);
});
it.each(["binding","running"] as const)("rechecks original physical home after asynchronous %s durability",async phase=>{
 const f=fixture(),b=f.backend(),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();
 const callback=async()=>{entered.resolve();await gate.promise;};if(phase==="binding")f.input.onBinding=callback;else f.input.onNativeEvent=callback;
 const turn=b.start(f.input);await entered.promise;renameSync(f.scope.copilotHome,f.scope.copilotHome+"-old");mkdirSync(f.scope.copilotHome);gate.resolve();
 await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_SCOPE_CHANGED"});await expect(turn.result()).rejects.toMatchObject({creationOutcome:"unknown"});if(phase==="binding")expect(f.calls).not.toContain("prompt");
});
