// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DevicesPage from "../src/DevicesPage.js";
import DiagnosticsPage from "../src/DiagnosticsPage.js";
import SettingsPage from "../src/SettingsPage.js";
beforeEach(() => { vi.stubGlobal("EventSource",class{addEventListener(){}close(){}}); HTMLDialogElement.prototype.showModal = function () {this.setAttribute("open","");}; HTMLDialogElement.prototype.close = function () {this.removeAttribute("open");}; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(ui: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>); }
it("separates registered devices from heartbeat evidence and does not enroll on read", async () => {
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => new Response(JSON.stringify(input === "/api/config" ? {revision:1,config:{runners:[{id:"remote",displayName:"Remote workstation",mode:"remote",capacity:2,tags:[]}],agentProfiles:[]}} : {runners:[]})));
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
it("refuses to build a configuration plan when the editing base revision changed", async () => {
  let reads=0;
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => {
    if(input === "/api/config") return new Response(JSON.stringify({revision:++reads,config:{controller:{id:"base"}}}));
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
  vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => new Response(JSON.stringify(input === "/api/config" ? {revision:1,config:{controller:{id:"base"},repositories:[]}} : {schema:{type:"object",properties:{controller:{type:"object"},repositories:{type:"array",title:"Registered repositories",items:{type:"string"}}}},uiSchema:{}})));
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
    if(input === "/api/config")return new Response(JSON.stringify({revision:4,config:{internalLlm:llm,repositories:[{id:"keep"}]}}));
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
  expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({config:{repositories:[{id:"keep"}],internalLlm:{defaultPoolId:"custom",pools:[{id:"custom",profileIds:["first","second"]}]}}});
  expect(fetchMock.mock.calls.some(([path])=>String(path).includes("/apply"))).toBe(false);
});
it("requires explicit device credential confirmation and clears the one-time receipt on close", async () => {
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => new Response(JSON.stringify(input === "/api/config" ? {revision:1,config:{runners:[{id:"remote",displayName:"Remote",mode:"remote",capacity:2,tags:[]}],agentProfiles:[]}} : String(input).endsWith("/enrollment") ? {token:"one-time-token",expiresAt:"2026-10-16"} : {runners:[]})));
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
