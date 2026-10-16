import {afterEach,expect,it,vi} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {LlmRuntime} from "@dispatcher/llm-runtime";
import {TaskClassifier} from "../src/task-classifier.js";
const databases:DispatcherDatabase[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
const types=[{id:"fix",name:"修复",definition:"修复软件问题",enabled:true,keywordGroups:[]}];
const result={status:"matched",primaryType:"fix",candidates:["fix"],evidence:[{field:"prompt",quote:"修复"}],explanation:"修复目标"};
function fixture(fetcher:typeof fetch,timeoutMs=20000){
  const db=new DispatcherDatabase(":memory:");databases.push(db);
  const runtime=new LlmRuntime(db,async()=>"fixture-secret",fetcher);
  runtime.configure({endpoints:[{id:"endpoint",protocol:"openai-chat",baseUrl:"http://localhost:9999/v1",credentialRef:"secret://llm/test"}],profiles:[{id:"classifier",endpointId:"endpoint",alias:"Classifier",model:"classification-model",enabled:true}],pools:[{id:"classifiers",profileIds:["classifier"]}],roleBindings:[{role:"task_classifier",poolId:"classifiers"}]});
  return {db,runtime,classifier:new TaskClassifier(db,runtime,()=>new Date(),{timeoutMs})};
}
it("deduplicates one logical classification across concurrent requests and catalog refreshes, with per-call provenance",async()=>{
  const requests:Record<string,unknown>[]=[];
  const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:12,completion_tokens:7}}),{headers:{"x-request-id":"classification-request"}});});
  const f=fixture(fetcher),input={actorId:"owner",clientDraftId:"draft",title:"",description:"修复故障",types};
  const [a,b]=await Promise.all([f.classifier.analyze(input),f.classifier.analyze(input)]);expect(a.id).toBe(b.id);expect(fetcher).toHaveBeenCalledOnce();expect((await f.classifier.analyze(input)).id).toBe(a.id);
  expect(a).toMatchObject({result,provenance:{profileId:"classifier",model:"classification-model",attempts:[{usage:{inputTokens:12,outputTokens:7},providerRequestId:"classification-request"}]}});
  expect(requests[0]).toMatchObject({max_tokens:700});expect(requests[0]).not.toHaveProperty("tools");expect(JSON.stringify(requests[0])).not.toContain("fixture-secret");
  expect(f.db.listEntities("task-classification")).toHaveLength(1);
});
it("bounds input without truncation, validates output and cancels superseded/over-deadline work without fallback calls",async()=>{
  const fetcher=vi.fn(async()=>new Promise<Response>(()=>undefined));const f=fixture(fetcher,20);
  const base={actorId:"owner",clientDraftId:"draft",title:"",description:"修复",types};
  expect((await f.classifier.analyze({...base,description:"😀".repeat(16001)})).failure?.code).toBe("CLASSIFICATION_INPUT_TOO_LONG");expect(fetcher).not.toHaveBeenCalled();
  const pending=f.classifier.analyze(base),next=f.classifier.analyze({...base,description:"修复新目标"});
  expect((await pending).failure?.code).toBe("CLASSIFICATION_SUPERSEDED");expect((await next).failure?.code).toBe("TIMEOUT");expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
});
it("rejects unauthorized output while retaining observed usage; a deliberate reanalysis creates a separate record",async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...result,model:"execute-this"})}}],usage:{prompt_tokens:9,completion_tokens:8}})));
  const f=fixture(fetcher),input={actorId:"owner",clientDraftId:"draft",title:"",description:"修复故障",types};
  const bad=await f.classifier.analyze(input);expect(bad.failure?.code).toBe("CLASSIFICATION_SCHEMA_INVALID");expect(bad.provenance?.attempts[0]?.usage).toMatchObject({inputTokens:9,outputTokens:8});expect(bad.result).toBeUndefined();
  fetcher.mockImplementation(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}],usage:{}})));
  const good=await f.classifier.analyze(input),again=await f.classifier.analyze(input,{force:true});expect(good.id).not.toBe(again.id);expect(f.db.listEntities("task-classification")).toHaveLength(3);
});
