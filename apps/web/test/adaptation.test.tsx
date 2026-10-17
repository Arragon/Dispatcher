// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import TasksPage from "../src/TasksPage.js";
import { api } from "../src/api.js";
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};vi.stubGlobal("EventSource",class{addEventListener(){}close(){}});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it("retains server recovery metadata in API failures",async()=>{
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({code:"TASK_CHANGED",message:"Refresh task",fieldErrors:{title:"Required"},recovery:{action:"refresh"},taskId:"t",runId:"r"}),{status:409}));
  await expect(api("/api/task")).rejects.toMatchObject({name:"ApiError",status:409,code:"TASK_CHANGED",fieldErrors:{title:"Required"},recovery:{action:"refresh"},taskId:"t",runId:"r"});
});
it("reads deep-linked canonical task, frozen run and result outside Fleet",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
    const path=String(input);
    const task={id:"outside",title:"Canonical task",projectId:"p",state:"REVIEW",currentRunId:"r",createdAt:"2026-10-16",updatedAt:"2026-10-16",description:"Complete original instructions"};
    const run={id:"r",taskId:"outside",profileId:"deleted-account",state:"COMPLETE",verification:{state:"PASSED",commands:[]},executionSelection:{requestedModel:"frozen-model",nativeParameters:{},source:"explicit"},providerSessionId:"native-123"};
    return new Response(JSON.stringify(path==="/api/fleet"?{snapshot:{tasks:[],runs:[],profiles:[],projects:[],generatedAt:"2026-10-16"}}:path.endsWith("/result")?{result:{worktree:"/managed/result",branch:"agent/result",files:["src/result.ts"],verification:{state:"PASSED"}}}:path==="/api/runs/r"?{run}:{revision:7,document:task,contract:{revision:2,goal:"Goal",scope:["src"],acceptanceCriteria:["Regression passes"],constraints:[],verification:[],delivery:{type:"none"}},runs:[run],deliveries:[],archive:{revision:0}}));
  });
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={["/tasks?task=outside"]}><TasksPage/></MemoryRouter></QueryClientProvider>);
  const dialog=await screen.findByRole("dialog",{name:"Canonical task"});
  expect(await within(dialog).findByText("Complete original instructions")).toBeTruthy();
  expect(await within(dialog).findByText("src/result.ts")).toBeTruthy();
  expect(within(dialog).getAllByText("待验收").length).toBeGreaterThan(0);
  expect(within(dialog).getByText("native-123")).toBeTruthy();
  expect(within(dialog).getByText("frozen-model")).toBeTruthy();
});

function mount(ui:React.ReactNode,route="/"){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>);}
it("reviews a Harness configuration plan and routes trials through canonical publication",async()=>{
  const {default:AgentsPage}=await import("../src/AgentsPage.js");
  const posted:Array<{path:string;body:Record<string,unknown>}>=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);
    if(init?.method==="POST"){posted.push({path,body:JSON.parse(String(init.body))});return new Response(JSON.stringify(path.split("?")[0]!.endsWith("/apply")?{revision:2}:{plan:{id:"review",risk:"sensitive",requiresConfirmation:true,changes:[{path:"agentProfiles"}]}}));}
    return new Response(JSON.stringify(path.includes("manifests")?{manifests:[{id:"codex",displayName:"Codex",platforms:[],configSchema:{type:"object",properties:{id:{type:"string",title:"账号 ID"},alias:{type:"string",title:"别名"},codexHome:{type:"string",title:"配置目录"}}},uiSchema:{},secretFields:[],backends:[],capabilities:{}}]}:path.includes("compatibility")?{matrix:[]}:{revision:1,profiles:[],sessions:[]}));
  });
  mount(<AgentsPage/>);
  await userEvent.click((await screen.findAllByRole("button",{name:"添加账号"}))[0]!);
  await userEvent.type(screen.getByLabelText("账号 ID"),"account");await userEvent.type(screen.getByLabelText("别名"),"Account");await userEvent.type(screen.getByLabelText("配置目录"),"/private/account");
  await userEvent.click(screen.getByRole("button",{name:"生成账号配置计划"}));
  expect(await screen.findByRole("button",{name:"确认保存账号"})).toBeTruthy();
  expect(posted).toEqual([{path:"/api/agents/codex/profiles",body:expect.objectContaining({previewOnly:true,baseRevision:1})}]);
  await userEvent.click(screen.getByRole("button",{name:"确认保存账号"}));
  expect(posted[1]).toMatchObject({path:"/api/config/plans/review/apply?view=console",body:{confirmed:true}});
  await userEvent.click(screen.getByRole("button",{name:"试运行"}));
  expect(await screen.findByRole("link",{name:"前往发布并预检"})).toHaveProperty("href",expect.stringContaining("/publish"));
  expect(posted.some(entry=>entry.path.endsWith("/runs"))).toBe(false);
});
it("previews wizard changes before applying and persists the applied revision",async()=>{
  const {default:SetupWizard}=await import("../src/SetupWizard.js");
  const posts:Array<{path:string;body:Record<string,unknown>}>=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);const config={revision:4,config:{controller:{id:"local",adminStrategy:"local"},runners:[{displayName:"My runner"}]}};
    if(init?.method==="POST"){posts.push({path,body:JSON.parse(String(init.body))});return new Response(JSON.stringify(path.endsWith("/plans")?{plan:{id:"step-plan",requiresConfirmation:true,risk:"sensitive",changes:[{path:"controller.id"}]}}:{revision:5}));}
    return new Response(JSON.stringify(path==="/api/setup?view=console"?{state:{step:0,configRevision:4,completed:false},config}:config));
  });
  mount(<SetupWizard/>);await userEvent.type(await screen.findByLabelText("Controller ID"),"-new");await userEvent.click(screen.getByRole("button",{name:"保存并继续"}));
  expect(await screen.findByText("审阅本步骤配置")).toBeTruthy();expect(posts).toHaveLength(1);expect(posts[0]?.body.baseRevision).toBe(4);
  await userEvent.click(screen.getByRole("button",{name:"确认应用本步骤"}));
  expect(posts[2]).toMatchObject({path:"/api/setup",body:{step:1,configRevision:5,completed:false}});
});
it("validates and reviews a native default without applying a one-run selection automatically",async()=>{
  const {default:ModelsPage}=await import("../src/ModelsPage.js");
  const posts:Array<{path:string;body:Record<string,unknown>}>=[];
  const catalog={revision:"catalog-1",contextFingerprint:"ctx",freshness:"native-fresh",entries:[{id:"native-model",displayName:"Native model",selectable:true,access:"allowed",parameterOptions:{},parameterDefaults:{}}]};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{const path=String(input);if(init?.method==="POST"){posts.push({path,body:JSON.parse(String(init.body))});return new Response(JSON.stringify({plan:{id:"default-plan",risk:"sensitive",requiresConfirmation:true,changes:[{path:"agentProfiles"}]}}));}return new Response(JSON.stringify(path.includes("/models?")?catalog:{revision:8,config:{repositories:[{id:"repo"}],agentProfiles:[{id:"account",alias:"Account",settings:{codexHome:"/private/keep",model:"old"}}],controller:{id:"keep"}}}));});
  mount(<ModelsPage/>,"/models?profile=account");await screen.findByRole("option",{name:"repo"});await userEvent.selectOptions(screen.getByLabelText("项目仓库"),"repo");await screen.findByRole("option",{name:/Native model/});await userEvent.selectOptions(screen.getByLabelText("原生模型"),"native-model");
  expect(posts).toHaveLength(0);await userEvent.click(screen.getByRole("button",{name:"将所选模型设为账号默认…"}));
  expect(await screen.findByRole("dialog",{name:"审阅账号默认模型"})).toBeTruthy();
  expect(posts[0]).toMatchObject({path:"/api/config/plans",body:{baseRevision:8,edits:[{op:"replace",path:"/agentProfiles/0/settings/model",entityId:"account",value:"native-model"}]}});
  expect(posts).toHaveLength(1);
});

it("reloads a conflicted settings draft when the newer config is already cached",async()=>{
  const {default:SettingsPage}=await import("../src/SettingsPage.js");
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  let revision=1;
  vi.spyOn(window,"confirm").mockReturnValue(true);
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input).endsWith("/schema")?{schema:{type:"object",properties:{controller:{type:"object",properties:{id:{type:"string",title:"Controller ID"}}}}},uiSchema:{}}:{revision,config:{controller:{id:revision===1?"original":"updated"}}})));
  render(<QueryClientProvider client={client}><SettingsPage/></QueryClientProvider>);
  const field=await screen.findByLabelText("Controller ID");await userEvent.type(field,"-mine");
  revision=2;await act(async()=>{client.setQueryData(["config"],{revision,config:{controller:{id:"updated"}}});});
  await userEvent.click(screen.getByRole("button",{name:"预览配置变更"}));await userEvent.click(await screen.findByRole("button",{name:"重新载入当前配置"}));
  await waitFor(()=>expect((screen.getByLabelText("Controller ID") as HTMLInputElement).value).toBe("updated"));
});
it("reloads conflicted internal-model drafts from a structurally unchanged cache",async()=>{
  const {default:LlmPage}=await import("../src/LlmPage.js");
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});let revision=1;
  const config={configured:true,endpoints:[{id:"e",protocol:"openai-chat",baseUrl:"https://example.invalid",credentialRef:"secret://llm/e"}],profiles:[{id:"first",alias:"first",model:"first",endpointId:"e",enabled:true}],pools:[{id:"default",profileIds:["first"]}],roleBindings:[],defaultPoolId:"default"};
  const state={mode:"ACTIVE",activeProfileByRole:{},healthByProfile:{}};
  vi.spyOn(window,"confirm").mockReturnValue(true);
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input)==="/api/llm"?{revision,config,state}:{revision,config:{internalLlm:config}})));
  render(<QueryClientProvider client={client}><LlmPage/></QueryClientProvider>);
  await userEvent.click(await screen.findByRole("button",{name:"添加模型"}));await userEvent.type(screen.getByLabelText("模型别名"),"second");await userEvent.selectOptions(screen.getByLabelText("连接"),"e");await userEvent.type(screen.getByLabelText("模型 ID"),"second-model");await userEvent.click(screen.getByRole("button",{name:"加入草稿"}));
  revision=2;await act(async()=>{client.setQueryData(["llm"],{revision,config,state});});
  await userEvent.click(screen.getByRole("button",{name:"审阅并保存"}));await userEvent.click(await screen.findByRole("button",{name:"重新载入当前模型配置"}));
  await waitFor(()=>expect(screen.queryByText("second-model")).toBeNull());
});
it("locks wizard inputs while its reviewed configuration is being prepared",async()=>{
  const {default:SetupWizard}=await import("../src/SetupWizard.js");
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{if(init?.method==="POST")return new Promise<Response>(()=>undefined);const config={revision:1,config:{controller:{id:"controller",adminStrategy:"local"},runners:[{displayName:"Local"}]}};return new Response(JSON.stringify(String(input)==="/api/setup?view=console"?{state:{step:0,completed:false},config}:config));});
  mount(<SetupWizard/>);const field=await screen.findByLabelText("Controller ID");await userEvent.type(field,"-a");await userEvent.click(screen.getByRole("button",{name:"保存并继续"}));
  expect(field).toHaveProperty("disabled",true);
});
it("opens a canonical task while Fleet is unavailable",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>String(input)==="/api/fleet"?new Response(JSON.stringify({message:"Fleet unavailable"}),{status:503}):new Response(JSON.stringify({revision:1,document:{id:"known",title:"Independent task",projectId:"p",state:"NEEDS_SPEC"},runs:[],deliveries:[]})));
  mount(<TasksPage/>,"/tasks?task=known");
  expect(await screen.findByRole("dialog",{name:"Independent task"})).toBeTruthy();
});

it("does not let a late restored publication preview interrupt a newer draft",async()=>{
  const {default:PublishPage}=await import("../src/PublishPage.js");
  localStorage.clear();localStorage.setItem("dispatcher.publication-receipt.v1",JSON.stringify({publicationId:"old",revision:1,reviewHash:"old-hash",key:"old-key",draft:{description:"Old body",startMode:"dispatch"}}));
  let complete:(response:Response)=>void=()=>undefined;
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>String(input)==="/api/task-publications/old"?new Promise<Response>(resolve=>{complete=resolve;}):new Response(JSON.stringify({revision:1,config:{repositories:[],agentProfiles:[]}})));
  mount(<PublishPage/>);await userEvent.type(screen.getByLabelText("任务说明"),"New draft");
  await act(async()=>{complete(new Response(JSON.stringify({publicationId:"old",revision:1,state:"PREVIEW",canCommit:true,effectiveTask:{title:"Old",description:"Old body",contractState:"READY"},checks:[],confirmation:{reviewHash:"old-hash"}})));});
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"审阅任务草稿"})).toBeNull());
  expect((screen.getByLabelText("任务说明") as HTMLTextAreaElement).value).toBe("New draft");localStorage.clear();
});
it("renders recovered publication mode from the reviewed snapshot instead of the current draft",async()=>{
  const {default:PublishPage}=await import("../src/PublishPage.js");
  localStorage.clear();localStorage.setItem("dispatcher.publication-receipt.v1",JSON.stringify({publicationId:"old",revision:1,reviewHash:"old-hash",key:"old-key",draft:{description:"Old body",startMode:"dispatch",acceptance:"Old acceptance",profileId:"frozen-account"}}));
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input)==="/api/task-publications/old"?{publicationId:"old",revision:1,state:"PREVIEW",canCommit:true,effectiveTask:{title:"Old",description:"Old body",contractState:"READY"},effectiveExecution:{profileId:"frozen-account",selectionType:"native-default",nativeParameters:{}},checks:[],confirmation:{reviewHash:"old-hash"}}:{revision:1,config:{repositories:[],agentProfiles:[]}})));
  mount(<PublishPage/>);const dialog=await screen.findByRole("dialog",{name:"审阅任务草稿"});
  expect(within(dialog).getByRole("button",{name:"确认并启动执行"})).toBeTruthy();expect(within(dialog).getByText("Old acceptance")).toBeTruthy();localStorage.clear();
});

it("separates canonical task links from standalone controls and exposes uncertain stop without enabling input",async()=>{
 const {default:AgentsPage}=await import("../src/AgentsPage.js");
 const actions={input:{allowed:false,requiresConfirmation:false},cancel:{allowed:true,requiresConfirmation:true},refresh:{allowed:true,requiresConfirmation:false}};
 const standalone={id:"standalone",runId:"trial",profileId:"p",state:"COMPLETED",createdAt:"2026-10-16",updatedAt:"2026-10-16",canonical:false,contextState:"current",stopState:"unconfirmed",actions};let stopped=false;
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
  const path=String(input),session=stopped?{...standalone,stopState:"confirmed",actions:{...actions,cancel:{allowed:false,requiresConfirmation:true}}}:standalone;
  if(path.startsWith("/api/usage?"))return new Response(JSON.stringify({observations:[],totals:[],errors:[]}));
  if(path.endsWith("/cancel")&&init?.method==="POST"){stopped=true;return new Response(JSON.stringify({session:{...session,stopState:"confirmed"}}));}
  return new Response(JSON.stringify(path.includes("manifests")?{manifests:[{id:"codex",displayName:"Codex",platforms:[],configSchema:{type:"object",properties:{}},uiSchema:{},secretFields:[],backends:[],capabilities:{}}]}:path.includes("compatibility")?{matrix:[]}:path==="/api/agents/profiles"?{profiles:[{id:"p",alias:"Account",provider:"codex",runnerId:"local",state:"CONFIGURED"}],sessions:[{...standalone,id:"canonical",canonical:true,taskId:"task-one"},session]}:{session}));
 });
 mount(<AgentsPage/>);expect(await screen.findByRole("link",{name:"查看任务"})).toHaveProperty("href",expect.stringContaining("/tasks?task=task-one"));
 expect(fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true);await userEvent.click(screen.getByRole("button",{name:"查看会话"}));
 const dialog=screen.getByRole("dialog",{name:"独立 Agent 会话"});expect(within(dialog).getByText("尚未确认，继续输入与账号变更已阻止")).toBeTruthy();expect(await within(dialog).findByText("尚无已验证的原生用量；缺失值不按 0 计算。")).toBeTruthy();expect(fetch.mock.calls.some(([path])=>String(path).includes("sessionId=standalone"))).toBe(true);
 await userEvent.click(within(dialog).getByRole("button",{name:"停止会话"}));expect(await within(dialog).findByText("已确认")).toBeTruthy();expect((within(dialog).getByRole("button",{name:"停止会话"}) as HTMLButtonElement).disabled).toBe(true);
 expect(fetch.mock.calls.filter(([,init])=>init?.method==="POST").map(([path])=>String(path))).toEqual(["/api/agents/profiles/p/sessions/standalone/cancel"]);
});
