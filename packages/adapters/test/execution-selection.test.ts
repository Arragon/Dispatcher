import {expect,it,vi} from "vitest";
import type {ExecutionSelection} from "@dispatcher/domain";
import {CodexAdapter,OpenCodeAdapter,KiroAdapter,CursorAdapter,GrokAdapter,PiAdapter,WorkBuddyCliAdapter,QoderCnAdapter,type AgentAdapter,type AdapterSession} from "../src/index.js";
import {MemorySessionStore} from "../src/generic.js";

function fixture(provider:"codex"|"opencode",model?:string){
  const profile={id:"p",alias:"P",codexHome:"/native",...(model?{model}:{})},store=new MemorySessionStore();
  const result=()=>Promise.resolve({state:"completed" as const,summary:"done",providerSessionId:"native",events:[]});
  const start=vi.fn((input:{model?:string;reasoningEffort?:string;args?:string[];providerSessionId?:string})=>{void input;return {cancel:async()=>undefined,status:()=>"completed" as const,result};});
  const adapter:AgentAdapter=provider==="codex"?new CodexAdapter(profile,{start},store):new OpenCodeAdapter(profile,{start},store);
  const selection:ExecutionSelection={version:1,mode:"manual",source:"explicit",profileId:"p",providerId:provider,runnerId:"local",backendId:adapter.manifest.backends[0]!.id,selectionType:"explicit-model",requestedModel:"selected",nativeParameters:{},contextFingerprint:"context",configRevision:1,selectedAt:"now"};
  const requested=()=>start.mock.calls.map(([input])=>input.model??(input.args?.includes("--model")?input.args[input.args.indexOf("--model")+1]:undefined));
  return {adapter,profile,store,start,selection,requested};
}
it("binds a first learned provider session before subsequent credential awaits",async()=>{
  const store=new MemorySessionStore(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let credentials=0;
  const start=vi.fn(()=>({cancel:async()=>undefined,status:()=>"completed" as const,result:async()=>({state:"completed" as const,summary:"done",providerSessionId:"native-original",events:[]})}));
  const adapter=new CursorAdapter({id:"cursor-p",alias:"Cursor",credentialRef:"secret://providers/synthetic",model:"original"},{start},store,async()=>{if(++credentials===2){entered.resolve();await release.promise;}return "synthetic-fixture-only";});
  const session=await adapter.start({runId:"r",workspacePath:"/work"}),pending=adapter.send(session.id,"first followup");
  await entered.promise;expect(store.load(session.id)?.providerSessionId).toBe("native-original");
  store.save({...store.load(session.id)!,providerSessionId:"foreign-during-credential-await"});
  const rejected=expect(pending).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});release.resolve();await rejected;
  expect(start).toHaveBeenCalledTimes(1);expect(store.load(session.id)?.providerSessionId).toBe("foreign-during-credential-await");
});
it.each([GrokAdapter,PiAdapter,WorkBuddyCliAdapter,QoderCnAdapter])("rejects replacement of an explicitly created native session (%s)",async Adapter=>{
  const store=new MemorySessionStore(),start=vi.fn(()=>({status:()=>"completed" as const,cancel:async()=>undefined,result:async()=>({state:"completed" as const,summary:"foreign",events:[],providerSessionId:"foreign-session"})}));
  const adapter=new Adapter({id:"p",alias:"P",executable:"synthetic-only"},{start},store),session=await adapter.start({runId:"r",workspacePath:"/work"});
  expect(session.providerSessionId).toBeTruthy();expect(session.providerSessionId).not.toBe("foreign-session");
  await expect(adapter.result(session.id)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});
  expect(store.load(session.id)?.providerSessionId).toBe(session.providerSessionId);expect(start).toHaveBeenCalledTimes(1);
});
it.each(["codex","opencode"] as const)("isolates two explicit %s targets across a default change and adapter restart",async provider=>{
  const f=fixture(provider,"profile-default"); let initial=0;
  const nativeIds=()=>f.start.mock.calls.map(([input])=>input.providerSessionId??(input.args?.includes("--session")?input.args[input.args.indexOf("--session")+1]:undefined));
  f.start.mockImplementation(input=>{
    const providerSessionId=input.providerSessionId??(input.args?.includes("--session")?input.args[input.args.indexOf("--session")+1]:undefined)??`native-${++initial}`;
    return {cancel:async()=>undefined,status:()=>"completed",result:async()=>({state:"completed",summary:"done",providerSessionId,events:[]})};
  });
  const a={...f.selection,requestedModel:"model-a",nativeParameters:provider==="codex"?{reasoningEffort:"low"}:{}},b={...f.selection,requestedModel:"model-b",nativeParameters:provider==="codex"?{reasoningEffort:"high"}:{}};
  const first=await f.adapter.start({runId:"run-a",workspacePath:"/work/a",executionSelection:a});
  const second=await f.adapter.start({runId:"run-b",workspacePath:"/work/b",executionSelection:b});
  await f.adapter.result(first.id);await f.adapter.result(second.id);f.profile.model="changed-default";
  const restarted:AgentAdapter=provider==="codex"?new CodexAdapter(f.profile,{start:f.start},f.store):new OpenCodeAdapter(f.profile,{start:f.start},f.store);
  await restarted.send(first.id,"modify original A");await restarted.resume!(second.id);
  expect(f.requested()).toEqual(["model-a","model-b","model-a","model-b"]);
  expect(nativeIds()).toEqual([undefined,undefined,"native-1","native-2"]);
  if(provider==="codex")expect(f.start.mock.calls.map(([input])=>input.reasoningEffort)).toEqual(["low","high","low","high"]);
  expect(f.store.load(first.id)?.executionSelection).toEqual(a);expect(f.store.load(second.id)?.executionSelection).toEqual(b);
});
it.each(["codex","opencode"] as const)("rejects a replacement %s provider session reported by an original turn",async provider=>{
  const f=fixture(provider),session=await f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection});await f.adapter.result(session.id);
  f.start.mockImplementationOnce(()=>({cancel:async()=>undefined,status:()=>"completed",result:async()=>({state:"completed",summary:"wrong session",providerSessionId:"foreign",events:[]})}));
  await f.adapter.send(session.id,"second turn in original session");
  await expect(f.adapter.resume!(session.id)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});
  expect(f.start).toHaveBeenCalledTimes(2);expect(f.store.load(session.id)?.providerSessionId).toBe("native");
});
it.each(["codex","opencode"] as const)("rejects a stored %s provider-session replacement during a result await",async provider=>{
  const f=fixture(provider),session=await f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection});await f.adapter.result(session.id);
  const held=Promise.withResolvers<{state:"completed";summary:string;providerSessionId:string;events:[]}>();
  f.start.mockImplementationOnce(()=>({cancel:async()=>undefined,status:()=>"completed",result:()=>held.promise}));
  await f.adapter.send(session.id,"second");const pending=f.adapter.send(session.id,"third");
  f.store.save({...f.store.load(session.id)!,providerSessionId:"foreign"});
  const rejected=expect(pending).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});held.resolve({state:"completed",summary:"done",providerSessionId:"native",events:[]});await rejected;
  expect(f.start).toHaveBeenCalledTimes(2);
});
it.each(["codex","opencode"] as const)("freezes the %s selection before a caller/store callback can mutate it",async provider=>{
  const f=fixture(provider),expected=structuredClone(f.selection),save=f.store.save.bind(f.store);
  vi.spyOn(f.store,"save").mockImplementationOnce(value=>{f.selection.requestedModel="caller-changed";save(value);});
  const session=await f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection});
  expect(session.executionSelection).toEqual(expected);expect(f.requested()).toEqual(["selected"]);
});
it.each(["codex","opencode"] as const)("freezes legacy %s configured and omitted defaults on new sessions",async provider=>{
  for(const model of [undefined,"original"]){
    const f=fixture(provider,model),pending=f.adapter.start({runId:"r",workspacePath:"/work"});f.profile.model="later";
    const session=await pending;await f.adapter.send(session.id,"next");expect(f.requested()).toEqual([model,model]);
  }
});
it.each(["codex","opencode"] as const)("rejects foreign %s selection and backend identity before spawning",async provider=>{
  for(const field of ["profileId","providerId","backendId"] as const){
    const f=fixture(provider);f.selection[field]="foreign";
    await expect(f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection})).rejects.toMatchObject({code:"EXECUTION_SELECTION_CONTEXT_MISMATCH"});expect(f.start).not.toHaveBeenCalled();
  }
  const f=fixture(provider);await expect(f.adapter.start({runId:"r",workspacePath:"/work",backendId:"foreign"})).rejects.toMatchObject({code:"BACKEND_MISMATCH"});expect(f.start).not.toHaveBeenCalled();
});
it.each(["codex","opencode"] as const)("rejects contradictory native-default %s choice before spawning",async provider=>{
  const f=fixture(provider);f.selection.selectionType="native-default";f.selection.source="native-default";
  await expect(f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection})).rejects.toMatchObject({code:"EXECUTION_SELECTION_INVALID"});expect(f.start).not.toHaveBeenCalled();
});
it.each(["codex","opencode"] as const)("rejects %s stored selection replacement while awaiting a prior result",async provider=>{
  const f=fixture(provider),held=Promise.withResolvers<{state:"completed";summary:string;providerSessionId:string;events:[]}>();
  f.start.mockImplementationOnce(()=>({cancel:async()=>undefined,status:()=>"completed",result:()=>held.promise}));
  const session=await f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection}),pending=f.adapter.send(session.id,"next");
  f.store.save({...f.store.load(session.id)!,executionSelection:{...f.selection,requestedModel:"replacement"}} as AdapterSession);
  const rejected=expect(pending).rejects.toMatchObject({code:"MODEL_BINDING_DRIFT"});held.resolve({state:"completed",summary:"done",providerSessionId:"native",events:[]});await rejected;expect(f.start).toHaveBeenCalledTimes(1);
});
it("refuses model selection and explicit parameters on incapable native backends",async()=>{
  const f=fixture("opencode");f.selection.nativeParameters={reasoningEffort:"high"};
  await expect(f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection})).rejects.toMatchObject({code:"UNSUPPORTED_NATIVE_PARAMETERS"});expect(f.start).not.toHaveBeenCalled();
  const kiro=new KiroAdapter(f.profile,{start:f.start}),choice={...f.selection,providerId:kiro.manifest.id,backendId:kiro.manifest.backends[0]!.id,nativeParameters:{}};
  await expect(kiro.start({runId:"r",workspacePath:"/work",executionSelection:choice})).rejects.toMatchObject({code:"UNSUPPORTED_MODEL_SELECTION"});expect(f.start).not.toHaveBeenCalled();
});

it("rejects unqualified, private or legacy prices before any native preparation",async()=>{
 const price={version:1 as const,id:"native-price",source:"native/account-model",collectedAt:"2026-10-22T12:00:00Z",unit:"credits",rates:{per:"1000",input:"1",includesMultiplier:true}};
 for(const patch of [{pricingSnapshot:{...price,privatePayload:"private"}},{pricingSnapshot:{...price,rates:{...price.rates,input:1}}},{mode:"legacy",source:"legacy-config",pricingSnapshot:price}]){
  const f=fixture("codex"),selection={...f.selection,...patch} as ExecutionSelection;
  await expect(f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:selection})).rejects.toMatchObject({code:"PRICE_EVIDENCE_INVALID"});expect(f.start).not.toHaveBeenCalled();
 }
});

it.each(["codex","opencode"] as const)("preserves pre-snapshot %s data without guessing its missing choice or legacy shape",async provider=>{
  const f=fixture(provider,"current"),base:AdapterSession={id:"historical",runId:"r",profileId:"p",backendId:f.selection.backendId,workspacePath:"/work",state:"COMPLETED",providerSessionId:"native",createdAt:"then",updatedAt:"then"};
  f.store.save(base);await expect(f.adapter.send(base.id,"historical continuation")).rejects.toMatchObject({code:"MODEL_SNAPSHOT_UNKNOWN"});expect(f.store.load(base.id)).toEqual(base);expect(f.start).not.toHaveBeenCalled();
  const old={...base,id:"old-model",modelSelection:{version:1,nativeSelectionId:"legacy-chosen"}};f.store.save(old);
  await expect(f.adapter.send(old.id,"do not guess")).rejects.toMatchObject({code:"MODEL_LEGACY_REVIEW_REQUIRED"});expect(f.store.load(old.id)).toEqual(old);expect(f.start).not.toHaveBeenCalled();
});

it("refuses a frozen interaction requirement for another account before native startup",async()=>{
 const f=fixture("codex");f.selection.interactionRequirement={version:1,profileId:"foreign",backendId:f.selection.backendId,mode:"compatible",executionLocation:"managed-worktree"};
 await expect(f.adapter.start({runId:"r",workspacePath:"/work",executionSelection:f.selection})).rejects.toMatchObject({code:"EXECUTION_SELECTION_CONTEXT_MISMATCH"});expect(f.start).not.toHaveBeenCalled();
});
