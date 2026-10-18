// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DevicesPage from "../src/DevicesPage.js";
import DiagnosticsPage from "../src/DiagnosticsPage.js";
import SettingsPage from "../src/SettingsPage.js";
import {taskModelRoutingSchema} from "@dispatcher/domain";
beforeEach(() => { vi.stubGlobal("EventSource",class{addEventListener(){}close(){}}); HTMLDialogElement.prototype.showModal = function () {this.setAttribute("open","");}; HTMLDialogElement.prototype.close = function () {this.removeAttribute("open");}; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(ui: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>); }
it("edits concrete policy targets through native catalogs and creates only an explicit ConfigPlan",async()=>{
  const plans:Record<string,unknown>[]=[];
  const config={revision:7,config:{repositories:[{id:"repo"}],agentProfiles:[{id:"account",alias:"Native account",enabled:true}],policies:{modelRouting:{enabled:true,requireConfirmation:true,classificationMode:"keyword",semanticFailureMode:"stop",taskTypes:[{id:"fix",name:"修复",definition:"修复问题",enabled:true,keywordGroups:[{any:["修复"],all:[],exclude:[]}]}],rules:[{id:"rule",name:"修复模型",enabled:true,profileId:"account",repositoryId:"repo",taskTypeId:"fix",priority:1,target:{modelSelectionId:"model-a",reasoning:{mode:"native-default"}}}]}}}};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);if(init?.method==="POST"){plans.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({plan:{id:"policy-plan",risk:"privileged",requiresConfirmation:true,changes:[{path:"/policies"}]}}));}
    if(path==="/api/config/schema")return new Response(JSON.stringify({schema:{type:"object",properties:{policies:{type:"object",properties:{modelRouting:taskModelRoutingSchema}}}},uiSchema:{}}));
    if(path.includes("/models?"))return new Response(JSON.stringify({freshness:"native-fresh",selectionSupport:"explicit",revision:"native-revision",contextFingerprint:"native-context",entries:["model-a","model-b"].map(id=>({id,displayName:id,kind:"model",selectable:true,access:"unconfirmed",parameterOptions:{reasoningEffort:["low","medium"]},parameterDefaults:{reasoningEffort:"medium"}}))}));
    return new Response(JSON.stringify(config));
  });
  mount(<SettingsPage sectionId="policies" embedded/>);await userEvent.click(await screen.findByRole("button",{name:"编辑规则 1"}));await screen.findByRole("option",{name:"model-b · model-b"});expect(plans).toHaveLength(0);
  await userEvent.selectOptions(screen.getByLabelText("原生模型"),"model-b");await userEvent.selectOptions(screen.getByLabelText("思考强度"),"low");await userEvent.selectOptions(screen.getByLabelText("思考强度"),"");
  await userEvent.click(screen.getByRole("button",{name:"刷新原生目录"}));expect(plans).toHaveLength(0);await userEvent.click(screen.getByRole("button",{name:"预览配置变更"}));await screen.findByRole("button",{name:"确认并应用"});
  expect(plans).toHaveLength(1);expect(plans[0]).toEqual({baseRevision:7,edits:[{op:"replace",path:"/policies/modelRouting/rules/0/target/modelSelectionId",entityId:"rule",value:"model-b"}]});
});
it("separates registered devices from heartbeat evidence and does not enroll on read", async () => {
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => new Response(JSON.stringify(input === "/api/config?view=console" ? {revision:1,config:{runners:[{id:"remote",displayName:"Remote workstation",mode:"remote",capacity:2,tags:[]}],agentProfiles:[]}} : {runners:[]})));
  mount(<DevicesPage/>);
  expect(await screen.findByText("Remote workstation")).toBeTruthy();
  expect(screen.getByText("尚未连接")).toBeTruthy();
  expect(fetchMock.mock.calls.every(([,init]) => !init?.method)).toBe(true);
});
it("keeps incomplete diagnostic sections visible and ignores known placeholder metrics", async () => {
  vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => {
    if(input === "/health") return new Response(JSON.stringify({status:"ok",version:"0.1",mode:"embedded",uptimeMs:1000}));
    if(input === "/api/system-impact") return new Response(JSON.stringify({rssBytes:1048576,heapUsedBytes:1,databaseBytes:1,activeLocalProcesses:0,llmCallsLastHour:{command_parser:999}}));
    return new Response(JSON.stringify({message:"offline"}),{status:503});
  });
  mount(<DiagnosticsPage/>);
  expect(await screen.findByText("Controller 正常响应")).toBeTruthy();
  expect(await screen.findByText("资源状态读取失败")).toBeTruthy();
  expect(screen.getByText("未采集")).toBeTruthy();
  expect(screen.queryByText("999")).toBeNull();
});
it("keeps unknown execution evidence separate from healthy Controller and only checks an explicit registered target",async()=>{
 const snapshot={generatedAt:"2026-10-16T12:00:00Z",controllerReady:true,executionReadiness:"unverified",configRevision:1,summary:{pass:1,fail:0,unknown:1,stale:0},checks:[{id:"profile.native",cost:"provider-query",entityRequired:true}],entries:[{id:"profile:p:authentication",entityRef:{kind:"profile",id:"p"},category:"authentication",status:"unknown",severity:"info",source:"saved-profile-evidence",message:"此项尚无已验证的有效证据。",reasonCode:"EVIDENCE_UNVERIFIED",actions:[{label:"原生检查",checkId:"profile.native"}]}]};
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
  if(input==="/health")return new Response(JSON.stringify({status:"ok",version:"0.1",mode:"embedded",uptimeMs:1000}));
  if(input==="/api/system-impact")return new Response(JSON.stringify({rssBytes:1,heapUsedBytes:1,databaseBytes:1,dashboardClients:0,llmCallsSinceStart:3}));
  if(input==="/api/resources")return new Response(JSON.stringify({resources:[]}));
  if(input==="/api/diagnostics/checks"&&init?.method==="POST")return new Response(JSON.stringify({diagnostics:snapshot}));
  return new Response(JSON.stringify(snapshot));
 });mount(<DiagnosticsPage/>);expect(await screen.findByText("执行就绪：尚未验证")).toBeTruthy();expect(screen.getByText("未知")).toBeTruthy();expect(fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 await userEvent.click(screen.getByRole("button",{name:"原生检查（查询提供方）"}));expect(await screen.findByText("检查已完成，结论以各项证据为准。")).toBeTruthy();const mutation=fetch.mock.calls.find(([,init])=>init?.method==="POST");expect(mutation?.[0]).toBe("/api/diagnostics/checks");expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({checkId:"profile.native",entityId:"p"});
});
it("refuses to build a configuration plan when the editing base revision changed", async () => {
  let reads=0;
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => {
    if(input === "/api/config?view=console") return new Response(JSON.stringify({revision:++reads,config:{controller:{id:"base"}}}));
    if(input === "/api/config/schema") return new Response(JSON.stringify({schema:{type:"object",properties:{controller:{type:"object",properties:{id:{type:"string",title:"Controller ID"}}}}},uiSchema:{}}));
    return new Response(JSON.stringify({plan:{id:"unsafe",changes:[{path:"controller.id"}]}}));
  });
  mount(<SettingsPage/>);
  const field=await screen.findByLabelText("Controller ID");
  await userEvent.type(field,"changed");
  await userEvent.click(screen.getByRole("button",{name:"预览配置变更"}));
  expect(await screen.findByText(/配置版本已改变/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([path])=>path === "/api/config/plans")).toBe(false);
});
it("keeps a scoped repository editor within the same ConfigPlan review path", async () => {
  vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => new Response(JSON.stringify(input === "/api/config?view=console" ? {revision:1,config:{controller:{id:"base"},repositories:[]}} : {schema:{type:"object",properties:{controller:{type:"object"},repositories:{type:"array",title:"Registered repositories",items:{type:"string"}}}},uiSchema:{}})));
  mount(<SettingsPage sectionId="repositories" embedded/>);
  expect(await screen.findByText("Registered repositories")).toBeTruthy();
  expect(screen.queryByText("控制台登录密码")).toBeNull();
  expect(within(screen.getByRole("region")).queryByLabelText("Controller ID")).toBeNull();
});
it("preserves a custom default model pool when adding a model and reviews before applying", async () => {
  const {default:LlmPage}=await import("../src/LlmPage.js");
  const llm={configured:true,endpoints:[{id:"endpoint",baseUrl:"https://example.invalid/v1",protocol:"openai-responses",credentialRef:"secret://llm/e"}],profiles:[{id:"first",alias:"first",endpointId:"endpoint",model:"model-first",enabled:true}],pools:[{id:"custom",profileIds:["first"]}],defaultPoolId:"custom",roleBindings:[]};
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => {
    if(input === "/api/llm")return new Response(JSON.stringify({revision:4,config:llm,state:{mode:"ACTIVE",activeProfileByRole:{},healthByProfile:{}}}));
    if(input === "/api/config?view=console")return new Response(JSON.stringify({revision:4,config:{internalLlm:llm,repositories:[{id:"keep"}]}}));
    return new Response(JSON.stringify({plan:{id:"review",risk:"sensitive",requiresConfirmation:true,changes:[{path:"internalLlm.profiles"}]}}));
  });
  mount(<LlmPage/>);
  await userEvent.click(await screen.findByRole("button",{name:"添加模型"}));
  await userEvent.type(screen.getByLabelText("模型别名"),"second");
  await userEvent.selectOptions(screen.getByLabelText("连接"),"endpoint");
  await userEvent.type(screen.getByLabelText("模型 ID"),"model-second");
  await userEvent.click(screen.getByRole("button",{name:"加入草稿"}));
  await userEvent.click(screen.getByRole("button",{name:"审阅并保存"}));
  expect(await screen.findByRole("dialog",{name:"审阅模型配置"})).toBeTruthy();
  const posted=fetchMock.mock.calls.find(([path])=>path === "/api/config/plans");
  const body=JSON.parse(String(posted?.[1]?.body));expect(body).toMatchObject({baseRevision:4,edits:expect.arrayContaining([{op:"replace",path:"/internalLlm/pools/0/profileIds",entityId:"custom",value:["first","second"]}])});expect(body.config).toBeUndefined();expect(body.edits.every((edit:{path:string})=>edit.path.startsWith("/internalLlm/"))).toBe(true);
  expect(fetchMock.mock.calls.some(([path])=>String(path).includes("/apply"))).toBe(false);
});
it("requires explicit device credential confirmation and clears the one-time receipt on close", async () => {
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => new Response(JSON.stringify(input === "/api/config?view=console" ? {revision:1,config:{runners:[{id:"remote",displayName:"Remote",mode:"remote",capacity:2,tags:[]}],agentProfiles:[]}} : String(input).endsWith("/enrollment") ? {token:"one-time-token",expiresAt:"2026-10-16"} : {runners:[]})));
  mount(<DevicesPage/>);
  await userEvent.click(await screen.findByRole("button",{name:"登记令牌"}));
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
  await userEvent.click(screen.getByRole("button",{name:"签发一次性登记令牌"}));
  expect((await screen.findByLabelText("一次性登记令牌") as HTMLInputElement).value).toBe("one-time-token");
  await userEvent.click(screen.getByRole("button",{name:"关闭"}));
  await userEvent.click(screen.getByRole("button",{name:"登记令牌"}));
  expect(screen.queryByLabelText("一次性登记令牌")).toBeNull();
});
it("keeps platform connections usable when recovery reads fail and tab labels remain plain text", async () => {
  const {default:IntegrationsPage}=await import("../src/IntegrationsPage.js");
  vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => input === "/api/fleet/connectors" ? new Response(JSON.stringify({connectors:[]})) : new Response(JSON.stringify({message:"unavailable"}),{status:503}));
  mount(<IntegrationsPage/>);
  expect(await screen.findByText("尚未配置集成。")).toBeTruthy();
  const recovery=screen.getByRole("tab",{name:"同步恢复 未知"});
  await userEvent.click(recovery);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("同步恢复记录读取失败"));
  expect(screen.queryByText(/\[object Object\]/)).toBeNull();
});

it("loads bounded repository refs only on request and preserves the chosen base reference",async()=>{
 const {RepositoryRefPicker}=await import("../src/RepositoryContext.js");const {useState}=await import("react");
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>new Response(JSON.stringify({offset:0,limit:50,refs:[{name:"refs/heads/feature/selected",commit:"a".repeat(40),kind:"branch"}]})));
 function Picker(){const [value,setValue]=useState("");return <RepositoryRefPicker id="registered" value={value} onChange={setValue}/>;}
 mount(<Picker/>);expect(fetch).not.toHaveBeenCalled();await userEvent.click(screen.getByRole("button",{name:"读取仓库引用"}));
 await screen.findByRole("option",{name:"refs/heads/feature/selected · aaaaaaaaaa"});await userEvent.selectOptions(screen.getByLabelText("选择已读取引用"),"refs/heads/feature/selected");expect((screen.getByLabelText("基准引用") as HTMLInputElement).value).toBe("refs/heads/feature/selected");
 expect(fetch.mock.calls.map(([path])=>String(path))).toEqual(["/api/repositories/registered/refs?offset=0&limit=50"]);expect(fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true);
});

it("uses a native directory only as an explicit candidate and never applies configuration",async()=>{
 const {default:Picker}=await import("../src/LocalDirectoryPicker.js");const selected=vi.fn();let choice="selected";
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>new Response(JSON.stringify({selection:{id:"selection",purpose:"repository",runnerId:"local",createdAt:"2026-10-16",state:choice,...(choice==="selected"?{path:"/candidate/project"}:{})}})));
 const view=mount(<Picker runners={[{id:"local",mode:"embedded"}]} onSelect={selected}/>);expect(fetch).not.toHaveBeenCalled();await userEvent.click(screen.getByRole("button",{name:"打开本机目录对话框"}));expect(await screen.findByText("/candidate/project")).toBeTruthy();expect(selected).not.toHaveBeenCalled();await userEvent.click(screen.getByRole("button",{name:"填入新仓库草稿"}));expect(selected).toHaveBeenCalledWith({root:"/candidate/project",runnerId:"local"});
 expect(fetch.mock.calls.filter(([,init])=>init?.method==="POST").map(([path])=>String(path))).toEqual(["/api/local/directory-selections"]);view.unmount();choice="cancelled";selected.mockClear();
 mount(<Picker runners={[{id:"local",mode:"embedded"}]} onSelect={selected}/>);await userEvent.click(screen.getByRole("button",{name:"打开本机目录对话框"}));expect(await screen.findByText("已取消，配置没有变更。")).toBeTruthy();expect(selected).not.toHaveBeenCalled();
});
it("edits only the selected account while preserving sibling profiles and protected fields",async()=>{
  const plans:unknown[]=[];const config={revision:4,protectedPaths:["/agentProfiles/1/settings/codexHome"],config:{agentProfiles:[{id:"first",provider:"codex",alias:"Other account",runnerId:"local"},{id:"second",provider:"codex",alias:"Selected account",runnerId:"local",settings:{model:"m"}}]}};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    if(init?.method==="POST"){plans.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({plan:{id:"single",risk:"sensitive",requiresConfirmation:true,changes:[{path:"/agentProfiles/1/alias"}]}}));}
    const item={type:"object",properties:{id:{type:"string"},provider:{type:"string"},alias:{type:"string"},runnerId:{type:"string"},settings:{type:"object",properties:{model:{type:"string"}}}}};
    return new Response(JSON.stringify(String(input)==="/api/config/schema"?{schema:{type:"object",properties:{agentProfiles:{type:"array",items:item}}},uiSchema:{}}:config));
  });
  mount(<SettingsPage sectionId="agentProfiles" entityId="second" embedded/>);const alias=await screen.findByLabelText("别名");expect(screen.getAllByLabelText("别名")).toHaveLength(1);expect((alias as HTMLInputElement).value).toBe("Selected account");expect((screen.getByLabelText("标识") as HTMLInputElement).readOnly).toBe(true);
  await userEvent.clear(alias);await userEvent.type(alias,"Changed account");await userEvent.click(screen.getByRole("button",{name:"预览配置变更"}));await screen.findByRole("button",{name:"确认并应用"});
  expect(plans).toEqual([{baseRevision:4,edits:[{op:"replace",path:"/agentProfiles/1/alias",entityId:"second",value:"Changed account"}]}]);
});
