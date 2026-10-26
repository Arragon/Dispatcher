// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {Run,RunNativeSessionView,HistoryPage} from "@dispatcher/domain";
import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {TaskDetail} from "../src/TaskDetail.js";

let evidence:unknown[]=[];
afterEach(context=>{
 const directory=process.env.DISPATCHER_NATIVE_HISTORY_UI_FIXTURE_EVIDENCE;
 if(directory){mkdirSync(directory,{recursive:true});writeFileSync(join(directory,`${context.task.name.replace(/[^a-z0-9]/gi,"_")}.json`),JSON.stringify({test:context.task.name,exchanges:evidence,dom:document.body.innerHTML},null,2));}
 evidence=[];cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
});
const run:Run={id:"run /?#&",taskId:"task",profileId:"profile",runnerId:"runner",providerId:"codex",sessionId:"session",providerSessionId:"native",state:"ACTIVE",attempt:2,generation:3,leaseId:"lease",verification:{state:"PENDING",commands:[]}};
const view:RunNativeSessionView={version:1,mutationAvailable:false,runId:run.id,sessionId:"session",profileId:"profile",generation:3,attempt:2,identity:"bound",binding:{product:"codex",region:"global",profileId:"profile",backendId:"app-server",runnerId:"runner",nativeSessionId:"native"},control:{state:"HUMAN",epoch:4,revision:8,exclusion:"cooperative"},execution:{kind:"managed-worktree",runnerId:"runner"},state:"idle",freshness:"fresh",observedAt:"2026-10-26T08:00:00Z",completeness:"unknown",capabilities:[{name:"historyRead",support:"supported",level:"runtime-verified"}],access:[]};
const page:HistoryPage={version:1,nativeSessionId:"native",state:"available",source:"safe-provider-source",range:"native-history",completeness:"complete",entries:[{id:"first",kind:"user",text:"visible native transcript"}]};
const open=()=>fireEvent.click(screen.getByRole("button",{name:"查看只读历史"}));
function setup(initial:unknown={run:structuredClone(run),nativeSession:structuredClone(view)}){
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
 const listeners=new Map<string,Set<()=>void>>();vi.stubGlobal("EventSource",class{addEventListener(name:string,listener:()=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(listener);}close(){listeners.clear();}});
 let header=initial,headerStatus=200,taskStatus=200,historyStatus=200;
 const requests:Array<{path:string;init:RequestInit|undefined}>=[];
 let history:(url:URL)=>Promise<unknown>=async()=>({source:"native",page});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
  const url=new URL(String(input),"http://fixture.invalid");requests.push({path:url.pathname+url.search,init});
  let payload:unknown,status=200;
  if(url.pathname==="/api/tasks/task"){status=taskStatus;payload={revision:1,document:{id:"task",title:"Native history task",state:"RUNNING",currentRunId:run.id},deliveries:[],currentRun:run,runs:[run,{...run,id:"older",sessionId:"older-session",providerSessionId:"older-native"}],runPage:{offset:0,limit:20,total:2,hasActiveRun:true}};}
  else if(url.pathname.endsWith("/history")){payload=await history(url);status=historyStatus;}
  else if(url.pathname===`/api/runs/${encodeURIComponent(run.id)}`){payload=header;status=headerStatus;}
  else if(url.pathname==="/api/runs/older")payload={run:{...run,id:"older",sessionId:"older-session",providerSessionId:"older-native"},nativeSession:{...view,runId:"older",sessionId:"older-session",binding:{...view.binding,nativeSessionId:"older-native"}}};
  else if(url.pathname.endsWith("/usage"))payload={observations:[],totals:[],errors:[],estimation:{status:"unavailable",reasonCode:"BILLING_BASELINE_MISSING"}};
  else throw new Error(`Unexpected fixture route: ${url.pathname}`);
  evidence.push({request:url.pathname+url.search,init,payload,status});
  return new Response(JSON.stringify(payload),{status});
 });
 render(<QueryClientProvider client={client}><MemoryRouter><TaskDetail id="task" profiles={[]} onClose={()=>undefined} refresh={async()=>undefined}/></MemoryRouter></QueryClientProvider>);
 return {client,requests,setHeader(value:unknown,status=200){header=value;headerStatus=status;},setTaskStatus(value:number){taskStatus=value;},setHistoryStatus(value:number){historyStatus=value;},setHistory(fn:typeof history){history=fn;},async refresh(){await act(async()=>{for(const listener of listeners.get("run.changed")??[])listener();await client.refetchQueries({queryKey:["run-detail",run.id]});});},historyRequests(){return requests.filter(request=>request.path.includes("/history"));}};
}
async function ready(){await screen.findByText("身份：已绑定");}

// Removing deliberate mounting or URL encoding would fetch eagerly or corrupt these literal requests.
it("opens deliberately via the authenticated public GET and encodes Run and cursor, then drops text on close and reopens fresh",async()=>{
 const fixture=setup();fixture.setHistory(async url=>({source:"native",page:url.searchParams.has("cursor")?{...page,entries:[{id:"next",kind:"assistant",text:"next native page"}]}:{...page,nextCursor:"next /?#&=+"}}));await ready();
 expect(fixture.historyRequests()).toHaveLength(0);expect(screen.queryByLabelText("只读会话历史")).toBeNull();open();await screen.findByText("visible native transcript");
 fireEvent.click(screen.getByRole("button",{name:"加载下一页"}));await screen.findByText("next native page");
 expect(fixture.historyRequests().map(request=>request.path)).toEqual(["/api/runs/run%20%2F%3F%23%26/history?limit=50","/api/runs/run%20%2F%3F%23%26/history?limit=50&cursor=next+%2F%3F%23%26%3D%2B"]);
 expect(fixture.historyRequests().every(request=>!request.init?.method&&request.init?.credentials==="same-origin")).toBe(true);
 expect(screen.getByText("阶段未记录")).toBeTruthy();expect(screen.queryByText("人工阶段")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"关闭只读历史"}));expect(screen.queryByText("visible native transcript")).toBeNull();open();await screen.findByText("visible native transcript");expect(fixture.historyRequests()).toHaveLength(3);
});

const invalidHeaders:Array<[string,(header:{run:Run;nativeSession:RunNativeSessionView})=>void]>=[
 ["Run ID",h=>{h.run.id="foreign";}],["Task ID",h=>{h.run.taskId="foreign";}],
 ["summary Run",h=>{h.nativeSession.runId="foreign";}],["session",h=>{h.nativeSession.sessionId="foreign";}],["profile",h=>{h.nativeSession.profileId="foreign";}],["generation",h=>{h.nativeSession.generation++;}],["attempt",h=>{h.nativeSession.attempt++;}],
 ["binding profile",h=>{h.nativeSession.binding!.profileId="foreign";}],["binding runner",h=>{h.nativeSession.binding!.runnerId="foreign";}],["binding native ID",h=>{h.nativeSession.binding!.nativeSessionId="foreign";}],["missing binding",h=>{h.nativeSession.binding=null;}],
 ["unbound",h=>{h.nativeSession.identity="unbound";}],["deleted",h=>{h.nativeSession.identity="deleted";}],["unreachable",h=>{h.nativeSession.identity="unreachable";}],["conflict",h=>{h.nativeSession.identity="conflict";}],
 ["unknown capability",h=>{h.nativeSession.capabilities[0]!.support="unknown";}],["unsupported capability",h=>{h.nativeSession.capabilities[0]!.support="unsupported";}],["missing capability",h=>{h.nativeSession.capabilities=[];}],
 ["missing control",h=>{h.nativeSession.control=null;}],["empty saved native ID",h=>{delete h.run.providerSessionId;}],
 ["malformed capabilities",h=>{Object.assign(h.nativeSession,{capabilities:null});}],["malformed execution",h=>{Object.assign(h.nativeSession,{execution:null});}],["malformed control",h=>{Object.assign(h.nativeSession.control!,{epoch:"wrong"});}],
 ["contradictory capabilities",h=>{h.nativeSession.capabilities.push({name:"historyRead",support:"unsupported"});}],
 ["mutation flag",h=>{Object.assign(h.nativeSession,{mutationAvailable:true});}],
 ["array identity",h=>{Object.assign(h.nativeSession,{identity:["bound"]});}],
 ["array control state",h=>{Object.assign(h.nativeSession.control!,{state:["HUMAN"]});}],
 ["array capability support",h=>{Object.assign(h.nativeSession.capabilities[0]!,{support:["supported"]});}],
 ["invalid completeness",h=>{Object.assign(h.nativeSession,{completeness:"complete"});}],
 ["conflicting execution runner",h=>{h.nativeSession.execution.runnerId="foreign";}],
];
it.each(invalidHeaders)("blocks %s header input with a concrete unavailable reason and zero history calls",async(_name,change)=>{
 const header={run:structuredClone(run),nativeSession:structuredClone(view)};change(header);const fixture=setup(header);await screen.findByRole("heading",{name:"Native history task"});
 await waitFor(()=>expect((screen.getByRole("button",{name:"查看只读历史"}) as HTMLButtonElement).disabled).toBe(true));
 expect(screen.getByText(/只读历史不可用：/)).toBeTruthy();expect(fixture.historyRequests()).toHaveLength(0);expect(screen.queryByLabelText("只读会话历史")).toBeNull();
});
it("keeps missing summary unavailable without crashing the saved-facts panel",async()=>{const fixture=setup({run});await screen.findByText("尚无已保存的原生会话摘要。");expect((screen.getByRole("button",{name:"查看只读历史"}) as HTMLButtonElement).disabled).toBe(true);expect(fixture.historyRequests()).toHaveLength(0);});

it.each([
 ["foreign wrapper",{source:"export",page:{...page,entries:[{id:"private",kind:"user",text:"private response text"}]}}],
 ["crossed identity",{source:"native",page:{...page,nativeSessionId:"foreign",entries:[{id:"private",kind:"user",text:"private response text"}]}}],
 ["malformed entries",{source:"native",page:{...page,entries:[{id:"private",kind:"user",text:{private:"private response text"}}]}}],
 ["malformed range",{source:"native",page:{...page,range:"invented",entries:[{id:"private",kind:"user",text:"private response text"}]}}],
 ["missing page",{source:"native"}],
 ["array entry kind",{source:"native",page:{...page,entries:[{id:"private",kind:["user"],text:"private response text"}]}}],
 ["array state",{source:"native",page:{...page,state:["available"],entries:[{id:"private",kind:"user",text:"private response text"}]}}],
] as const)("rejects %s without publishing response text",async(_name,response)=>{const fixture=setup();fixture.setHistory(async()=>response);await ready();open();await screen.findByRole("alert");expect(screen.queryByText(/private response text/)).toBeNull();expect(screen.queryByText("visible native transcript")).toBeNull();});
it("clears transcript on API refresh denial without showing private errors",async()=>{const fixture=setup();await ready();open();await screen.findByText("visible native transcript");fixture.setHistoryStatus(403);fixture.setHistory(async()=>({message:"private provider path"}));fireEvent.click(screen.getByRole("button",{name:"刷新只读历史"}));await screen.findByRole("alert");expect(screen.queryByText("visible native transcript")).toBeNull();expect(screen.queryByText(/private provider path/)).toBeNull();});
it("clears cached transcript on current Run header denial and renews collapsed eligibility",async()=>{const fixture=setup();await ready();open();await screen.findByText("visible native transcript");fixture.setHeader({message:"private denial"},403);await fixture.refresh();await waitFor(()=>expect(screen.queryByText("visible native transcript")).toBeNull());expect(fixture.client.getQueryData(["run-detail",run.id])).toBeTruthy();expect((screen.getByRole("button",{name:"查看只读历史"}) as HTMLButtonElement).disabled).toBe(true);fixture.setHeader({run, nativeSession:view});await fixture.refresh();await waitFor(()=>expect((screen.getByRole("button",{name:"查看只读历史"}) as HTMLButtonElement).disabled).toBe(false));expect(screen.queryByLabelText("只读会话历史")).toBeNull();expect(fixture.historyRequests()).toHaveLength(1);});
it("clears cached transcript on current Task header failure",async()=>{const fixture=setup();await ready();open();await screen.findByText("visible native transcript");fixture.setTaskStatus(403);await fixture.refresh();await waitFor(()=>expect(screen.queryByText("visible native transcript")).toBeNull());expect((screen.getByRole("button",{name:"查看只读历史"}) as HTMLButtonElement).disabled).toBe(true);});
it("keeps unchanged healthy SSE header refreshes open without rereading native history",async()=>{const fixture=setup();await ready();open();await screen.findByText("visible native transcript");fixture.setHeader({run:{...run,lastActivityAt:"2026-10-26T08:01:00Z"},nativeSession:{...view,observedAt:"2026-10-26T08:01:00Z",reportedModel:{id:"refreshed-model"}}});await fixture.refresh();await screen.findByText("上次原生报告模型：refreshed-model");expect(screen.getByText("visible native transcript")).toBeTruthy();expect(fixture.historyRequests()).toHaveLength(1);});

const scopeChanges:Array<[string,(h:{run:Run;nativeSession:RunNativeSessionView})=>void]>=[
 ["session",h=>{h.run.sessionId=h.nativeSession.sessionId="new-session";}],
 ["profile",h=>{h.run.profileId=h.nativeSession.profileId=h.nativeSession.binding!.profileId="new-profile";}],
 ["generation",h=>{h.run.generation=h.nativeSession.generation=4;}],["attempt",h=>{h.run.attempt=h.nativeSession.attempt=3;}],
 ["native identity",h=>{h.run.providerSessionId=h.nativeSession.binding!.nativeSessionId="new-native";}],
 ["product",h=>{h.nativeSession.binding!.product="other";}],["region",h=>{h.nativeSession.binding!.region="other";}],["backend",h=>{h.nativeSession.binding!.backendId="other";}],
 ["runner",h=>{h.run.runnerId=h.nativeSession.binding!.runnerId=h.nativeSession.execution.runnerId="other";}],["thread",h=>{h.nativeSession.binding!.nativeThreadId="other";}],
 ["control state",h=>{h.nativeSession.control!.state="AUTOMATED";}],["control epoch",h=>{h.nativeSession.control!.epoch++;}],["control revision",h=>{h.nativeSession.control!.revision++;}],["control exclusion",h=>{h.nativeSession.control!.exclusion="native-enforced";}],
 ["qualification",h=>{h.nativeSession.capabilities[0]!.support="unknown";}],["qualification level",h=>{h.nativeSession.capabilities[0]!.level="ui-roundtrip-verified";}],
];
it.each(scopeChanges)("discards a late old page and closes retained history when %s changes",async(_name,change)=>{
 const fixture=setup();await ready();open();await screen.findByText("visible native transcript");let resolve!:(value:unknown)=>void;fixture.setHistory(()=>new Promise(done=>{resolve=done;}));fireEvent.click(screen.getByRole("button",{name:"刷新只读历史"}));await waitFor(()=>expect(fixture.historyRequests()).toHaveLength(2));
 const header={run:structuredClone(run),nativeSession:structuredClone(view)};change(header);fixture.setHeader(header);await fixture.refresh();await waitFor(()=>expect(screen.queryByLabelText("只读会话历史")).toBeNull());expect(screen.queryByText("visible native transcript")).toBeNull();
 await act(async()=>resolve({source:"native",page}));expect(screen.queryByText("visible native transcript")).toBeNull();expect(fixture.historyRequests()).toHaveLength(2);
});
it("drops late selected-Run responses and closes late responses after deliberate close",async()=>{
 const fixture=setup();let resolve!:(value:unknown)=>void;fixture.setHistory(()=>new Promise(done=>{resolve=done;}));await ready();open();await waitFor(()=>expect(fixture.historyRequests()).toHaveLength(1));fireEvent.change(screen.getByLabelText("查看运行"),{target:{value:"older"}});await screen.findByText("older-native",{selector:"code"});await act(async()=>resolve({source:"native",page}));expect(screen.queryByText("visible native transcript")).toBeNull();expect(screen.queryByLabelText("只读会话历史")).toBeNull();
 open();await waitFor(()=>expect(fixture.historyRequests()).toHaveLength(2));fireEvent.click(screen.getByRole("button",{name:"关闭只读历史"}));await act(async()=>resolve({source:"native",page:{...page,nativeSessionId:"older-native"}}));expect(screen.queryByText("visible native transcript")).toBeNull();
});

it("reads supported bound history even when native activity is unknown without enabling native control",async()=>{const fixture=setup({run,nativeSession:{...view,state:"unknown"}});await ready();open();await screen.findByText("visible native transcript");expect(fixture.historyRequests()).toHaveLength(1);expect(screen.getByText(/原生接管与交还暂不可用/)).toBeTruthy();expect(screen.queryByRole("button",{name:/接管|交还|继续会话|中断/})).toBeNull();});
