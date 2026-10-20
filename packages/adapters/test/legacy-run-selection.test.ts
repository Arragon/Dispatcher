import {expect,it,vi} from "vitest";
import type {ExecutionSelection} from "@dispatcher/domain";
import {QoderAdapter,KiroAdapter,GenericCliAdapter,DevinAdapter,MemorySessionStore} from "../src/index.js";
const at="2026-10-20T12:00:00Z";
function selection(providerId:string,backendId:string,model?:string):ExecutionSelection{return {version:1,mode:"legacy",source:"legacy-config",profileId:"p",runnerId:"local",providerId,backendId,selectionType:model?"explicit-model":"native-default",...(model?{requestedModel:model}:{}),nativeParameters:{},contextFingerprint:"scope",configRevision:1,selectedAt:at};}
it("freezes Qoder's configured invocation model and uses the original choice on continuation",async()=>{
 const profile={id:"p",alias:"P",model:"original"},store=new MemorySessionStore(),start=vi.fn(()=>({cancel:async()=>{},status:()=>"completed" as const,result:async()=>({state:"waiting" as const,summary:"question"})}));
 const adapter=new QoderAdapter(profile,{start},store),choice=selection(adapter.manifest.id,"qoder-cli-json",adapter.legacyInvocationDefaults().model),session=await adapter.start({runId:"r",workspacePath:"/work",executionSelection:choice});
 expect(session.executionSelection).toEqual(choice);expect(session.legacyModel).toBeUndefined();profile.model="changed";await adapter.send(session.id,"next");expect(start).toHaveBeenLastCalledWith(expect.objectContaining({model:"original",resume:true}));
});
it("preserves the existing unqualified CLI configured invocation without enabling interactive selection",async()=>{
 const profile={id:"p",alias:"P",model:"configured"},store=new MemorySessionStore(),start=vi.fn(()=>({cancel:async()=>{},status:()=>"completed" as const,result:async()=>({state:"completed" as const,summary:"done",providerSessionId:"native",events:[]})}));
 const adapter=new KiroAdapter(profile,{start},store),choice=selection(adapter.manifest.id,adapter.manifest.backends[0]!.id,adapter.legacyInvocationDefaults().model);
 await adapter.start({runId:"old",workspacePath:"/work"});const original=structuredClone(start.mock.calls[0]);
 const session=await adapter.start({runId:"r",workspacePath:"/work",executionSelection:choice});expect(session.executionSelection).toEqual(choice);expect(session.legacyModel).toBeUndefined();expect(start.mock.calls[1]).toEqual(original);
 await expect(adapter.start({runId:"forged",workspacePath:"/work",executionSelection:{...choice,mode:"manual",source:"explicit"}})).rejects.toMatchObject({code:"UNSUPPORTED_MODEL_SELECTION"});expect(start).toHaveBeenCalledTimes(2);
});
it("records an omitted model on Generic CLI and rejects unsupported explicit choices before execution",async()=>{
 const start=vi.fn(async()=>({id:"process",status:async()=>({state:"completed" as const}),send:async()=>{},cancel:async()=>{},result:async()=>({state:"completed" as const,summary:"done"})}));
 const adapter=new GenericCliAdapter({start},{file:"fixture",args:["{{prompt}}"]},new MemorySessionStore(),"p"),choice=selection(adapter.manifest.id,"structured-cli"),session=await adapter.start({runId:"r",workspacePath:"/work",executionSelection:choice});
 expect(session.executionSelection).toEqual(choice);
 await expect(adapter.start({runId:"forged",workspacePath:"/work",executionSelection:{...choice,selectionType:"explicit-model",requestedModel:"unsupported"}})).rejects.toMatchObject({code:"UNSUPPORTED_MODEL_SELECTION"});expect(start).toHaveBeenCalledTimes(1);
});
it("records Devin's omitted native model without changing its API request",async()=>{
 const create=vi.fn(async()=>({sessionId:"native",status:"running" as const,pullRequests:[]}));
 const adapter=new DevinAdapter({id:"p",alias:"P",organizationId:"org",credentialRef:"secret://devin/key"},{health:async()=>({ok:true}),create,get:async()=>({sessionId:"native",status:"running",pullRequests:[]}),send:async()=>({sessionId:"native",status:"running",pullRequests:[]})}),choice=selection(adapter.manifest.id,"devin-v3-api"),session=await adapter.start({runId:"r",workspacePath:"/work",prompt:"task",executionSelection:choice});
 expect(session.executionSelection).toEqual(choice);expect(create).toHaveBeenCalledWith(expect.objectContaining({prompt:"task"}));expect(create.mock.calls[0]?.[0]).not.toHaveProperty("model");
});
it("gets the actual Generic PTY backend from its owning adapter before compiling a legacy Run",async()=>{
 const start=vi.fn(async()=>({id:"process",status:async()=>({state:"completed" as const}),send:async()=>{},cancel:async()=>{},result:async()=>({state:"completed" as const,summary:"done"})}));
 const adapter=new GenericCliAdapter({start},{file:"fixture",args:["{{prompt}}"],mode:"pty"},new MemorySessionStore(),"p");
 const defaults=adapter.legacyInvocationDefaults();expect(defaults).toEqual({backendId:"restricted-pty"});
 const choice=selection(adapter.manifest.id,defaults.backendId),session=await adapter.start({runId:"r",workspacePath:"/work",executionSelection:choice});expect(session.backendId).toBe("restricted-pty");expect(session.executionSelection).toEqual(choice);expect(start).toHaveBeenCalledWith(expect.objectContaining({mode:"pty"}));
});
