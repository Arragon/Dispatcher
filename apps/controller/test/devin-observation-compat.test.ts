import {existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {AdapterContractError,MemorySessionStore} from "@dispatcher/adapters";
import type {ExecutionContextRef,ExecutionSelection,NativeBindingEvent} from "@dispatcher/domain";
import {DevinLocalAcpAdapter} from "../../../packages/adapters/dist/devin-acp-execution.js";
import {DevinExecutionRuntime} from "../src/devin-runtime.js";
import {devinAcpFixture} from "../../../packages/adapters/test/fixtures/devin-acp.js";
const roots:string[]=[],runtimes:DevinExecutionRuntime[]=[];
afterEach(async()=>{for(const runtime of runtimes.splice(0))await runtime.disconnectLocal();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const f=devinAcpFixture(roots),store=new MemorySessionStore(),events:NativeBindingEvent[]=[];let current=true,writing=true,writes=0;
 const script=readFileSync(f.scope.executable,"utf8"),write="process.stdout.write(JSON.stringify(value)+'\\n')",needle="const emit=value=>"+write+";";
 expect(script.includes(needle)).toBe(true);
 const late={jsonrpc:"2.0",method:"session/update",params:{sessionId:"native-exact",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"controlled late update"}}}};
 const replacement="const emit=value=>{const send=()=>"+write+";if(value.result&&value.result.stopReason){fs.writeFileSync(path.join(root,'terminal-held'),'yes');const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'release-terminal'))){clearInterval(timer);process.stdout.write(JSON.stringify("+JSON.stringify(late)+")+'\\n');send();}},10);}else send();};";
 writeFileSync(f.scope.executable,script.replace(needle,replacement));
 const runtime=new DevinExecutionRuntime({profile:{id:"p",alias:"Local",executable:f.scope.executable},dataHome:f.scope.dataHome,configHome:f.scope.configHome,runnerId:"local",assertInput:()=>{if(!current)throw new AdapterContractError("STALE_NATIVE_OBSERVER","Original scope revoked");},bindingFor:id=>{const session=store.load("reserved");return session?.nativeBinding?.nativeSessionId===id?session.nativeBinding:undefined;}});runtimes.push(runtime);
 const adapter=new DevinLocalAcpAdapter({id:"p",alias:"Local",executable:f.scope.executable},runtime,store);adapter.setNativeEventSink(event=>{events.push(structuredClone(event));},()=>()=>current);
 const selection:ExecutionSelection={version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",profileId:"p",providerId:"devin-local",backendId:"devin-local-acp",runnerId:"local",requestedModel:"chosen",nativeParameters:{},contextFingerprint:"fixture",configRevision:1,selectedAt:"2026-10-25T00:00:00Z"};
 const reference:ExecutionContextRef={version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repository",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"codex/run",baseRevision:"base"};
 const admit=()=>{writes++;if(!writing)throw new AdapterContractError("START_ALREADY_ACKNOWLEDGED","One-shot write admission consumed");};
 const start=()=>adapter.start({runId:"run",sessionId:"reserved",workspacePath:f.scope.workspacePath,prompt:"literal",executionRef:reference,executionSelection:selection,execution:{generation:1,attempt:1,leaseId:"lease"},beforeCreate:admit,beforeSend:admit});
 return {...f,adapter,runtime,store,events,start,writes:()=>writes,ack:()=>{writing=false;},revoke:()=>{current=false;},release:()=>writeFileSync(join(f.root,"release-terminal"),"yes")};
}
it("preserves shared observation callbacks through the actual ACP Adapter and managed runtime after write acknowledgement",async()=>{
 const f=fixture();try{const session=await f.start();await vi.waitFor(()=>expect(existsSync(join(f.root,"terminal-held"))).toBe(true));const before=f.store.load(session.id)!,writes=f.writes();f.ack();f.release();
  await expect(f.adapter.result(session.id)).resolves.toMatchObject({state:"COMPLETED"});expect(f.writes()).toBe(writes);expect(f.store.load(session.id)).toMatchObject({providerSessionId:before.providerSessionId,nativeInvocationId:before.nativeInvocationId,nativeBinding:before.nativeBinding,executionSelection:before.executionSelection,turnObservation:{state:"completed"}});expect(f.store.load(session.id)?.modelInvocationId).toBeUndefined();expect(f.calls().filter(call=>call.method==="session/new")).toHaveLength(1);expect(f.calls().filter(call=>call.method==="session/prompt")).toHaveLength(1);
  await expect(f.adapter.cancel(session.id)).rejects.toMatchObject({code:"DEVIN_ACP_STOP_UNQUALIFIED"});
 }finally{f.release();}
});
it.each(["authority","generation"] as const)("rejects late ACP facts on %s drift after write acknowledgement",async drift=>{
 const f=fixture();try{const session=await f.start();await vi.waitFor(()=>expect(existsSync(join(f.root,"terminal-held"))).toBe(true));const before=f.store.load(session.id)!,count=f.events.length;f.ack();if(drift==="authority")f.revoke();else f.store.save({...before,execution:{...before.execution!,generation:2}});f.release();
  const outcome=await f.adapter.result(session.id).then(result=>result.state,()=>"rejected");expect(outcome).not.toBe("COMPLETED");expect(f.events).toHaveLength(count);expect(f.store.load(session.id)?.nativeBinding).toEqual(before.nativeBinding);expect(f.store.load(session.id)?.turnObservation?.state).not.toBe("completed");expect(f.calls().filter(call=>call.method==="session/prompt")).toHaveLength(1);
 }finally{f.release();}
});
