// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigation } from "../src/App.js";
import TasksPage from "../src/TasksPage.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it("defaults to white, remembers explicit dark mode and keeps text navigation", async () => {
  render(<MemoryRouter><Navigation /></MemoryRouter>);
  expect(document.documentElement.dataset.theme).toBe("light");
  await userEvent.click(screen.getByRole("button", { name: "切换为黑色主题" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("dispatcher.theme")).toBe("dark");
  expect(screen.getByRole("link", { name: "任务与运行" })).toBeTruthy();
});
it("groups an account across projects, preserves current run and uses explicit history", async () => {
  vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
  const snapshot = {
    generatedAt: "2026-10-02T00:00:00Z", cursor: 1,
    projects: [{ id: "p1", name: "Dispatcher", repositories: [{ id: "repo", root: "/workspace/dispatcher", remote: "https://github.com/Arragon/Dispatcher" }], externalRefs: [{ externalUrl: "https://linear.app/project/p1" }] }, { id: "p2", name: "Notes" }],
    profiles: [{ id: "ronna", alias: "ronna", provider: "codex", state: "CONFIGURED", runnerId: "local" }],
    tasks: [{ id: "t1", projectId: "p1", title: "Build views", state: "RUNNING", currentRunId: "r1", profileId: "ronna", updatedAt: "2026-10-02T00:00:00Z" }, { id: "t2", projectId: "p2", title: "Completed but current", state: "DONE", currentRunId: "r2", profileId: "ronna", updatedAt: "2026-10-02T00:00:00Z" }, { id: "t3", projectId: "p2", title: "Archived explicitly", state: "DONE", archivedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" }],
    runs: [{ id: "r1", taskId: "t1", profileId: "ronna", state: "ACTIVE", createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", model: { id: "gpt-6", source: "configuration" }, tokens: { input: 100, output: 10, cachedInput: 70 } }, { id: "r2", taskId: "t2", profileId: "ronna", state: "COMPLETE", createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", model: { id: "gpt-5", source: "runtime" } }, { id: "old", taskId: "t1", profileId: "ronna", state: "FAILED", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" }],
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ snapshot })));
  render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry:false}}})}><MemoryRouter><TasksPage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText("Build views")).toBeTruthy();
  expect(screen.getByText("Completed but current")).toBeTruthy();
  expect(screen.queryByText("Archived explicitly")).toBeNull();
  expect(screen.getByRole("link", { name: /github.com\/Arragon\/Dispatcher/ })).toBeTruthy();
  expect(screen.getByText("110 token")).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Agent 视图" }));
  expect(screen.getByText("gpt-6")).toBeTruthy();
  expect(screen.getByText("gpt-5")).toBeTruthy();
  expect(screen.getAllByText("用量未提供").length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole("button", { name: "历史任务" }));
  expect(await screen.findByText("Archived explicitly")).toBeTruthy();
  expect(screen.queryByText("Completed but current")).toBeNull();
  expect(within(screen.getByRole("region", { name: "任务与运行" })).queryByText("演示数据")).toBeNull();
});

it("retains hidden settings and invalidates a reviewed plan after the draft changes", async () => {
  const { default: SettingsPage } = await import("../src/SettingsPage.js");
  const posted: unknown[] = [];
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/config?view=console") return new Response(JSON.stringify({ revision: 1, config: { schemaVersion: 1, controller: { id: "original" }, agentProfiles: [{id: "kite", enabled: false}], repositories: [{id: "repo", root: "/private/repo"}] } }));
    if (input === "/api/config/schema") return new Response(JSON.stringify({
      schema: { type: "object", properties: {
        schemaVersion: { const: 1 },
        controller: { type: "object", properties: { id: { type: "string", title: "Controller ID" } } },
        agentProfiles: { type: "array", items: { type: "object", properties: { id: { type: "string" }, enabled: { type: "boolean", default: true } } } },
        repositories: { type: "array", items: { type: "object", properties: { id: { type: "string" }, root: { type: "string" } } } },
      } }, uiSchema: {},
    }));
    if (input === "/api/config/plans") {posted.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({plan:{id:"plan",risk:"sensitive",requiresConfirmation:true,changes:[{path:"controller.id"}]}}));}
    return new Response(null, {status:204});
  });
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SettingsPage /></QueryClientProvider>);
  const id = await screen.findByLabelText("Controller ID");
  await userEvent.clear(id); await userEvent.type(id,"changed");
  await userEvent.click(screen.getByRole("button", {name:"预览配置变更"}));
  expect(await screen.findByRole("button", {name:"确认并应用"})).toBeTruthy();
  expect(posted[0]).toEqual({baseRevision:1,edits:[{op:"replace",path:"/controller/id",value:"changed"}]});
  await userEvent.type(id,"2");
  expect(screen.queryByRole("button", {name:"确认并应用"})).toBeNull();
  await userEvent.click(screen.getByRole("button", {name:"Agent 账号"}));
  await userEvent.click(screen.getByRole("button", {name:"控制台"}));
  expect((screen.getByLabelText("Controller ID") as HTMLInputElement).value).toBe("changed2");
  expect(fetchMock.mock.calls.some(([path]) => String(path).includes("/apply"))).toBe(false);
});

it("keeps absent authoritative run evidence absent instead of selecting a newer failed attempt", async () => {
  const { currentRun, tokensLabel } = await import("../src/task-view.js");
  const task = {id:"t",projectId:"p",title:"T",state:"RUNNING",updatedAt:"now",currentRunId:"missing"};
  expect(currentRun(task,[{id:"old",taskId:"t",profileId:"ronna",state:"FAILED",createdAt:"now",updatedAt:"now"}])).toBeUndefined();
  expect(tokensLabel()).toBe("用量未提供");
});

it("keeps login evidence in the checked account row and prevents duplicate checks", async () => {
  vi.stubGlobal("EventSource",class{addEventListener(){}close(){}});
  const {default: AgentsPage} = await import("../src/AgentsPage.js");
  let complete: ((value: Response) => void) | undefined;
  const fetchMock = vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => {
    if (input === "/api/adapters/manifests") return new Response(JSON.stringify({manifests:[{id:"codex",displayName:"Codex",platforms:[],configSchema:{type:"object",properties:{}},uiSchema:{},secretFields:[],backends:[],capabilities:{}}]}));
    if (input === "/api/agents/profiles") return new Response(JSON.stringify({profiles:[{id:"ronna",alias:"ronna",provider:"codex",runnerId:"local",state:"CONFIGURED"},{id:"kite",alias:"kite",provider:"codex",runnerId:"local",state:"DISABLED"}],sessions:[]}));
    if (String(input).endsWith("/test")) return new Promise<Response>((resolve) => {complete=resolve;});
    return new Response(JSON.stringify({matrix:[]}));
  });
  render(<QueryClientProvider client={new QueryClient()}><AgentsPage /></QueryClientProvider>);
  const check = await screen.findByRole("button",{name:"测试 ronna 登录"});
  await userEvent.click(check); await userEvent.click(check);
  expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/test"))).toHaveLength(1);
  complete?.(new Response(JSON.stringify({profile:{id:"ronna",alias:"ronna",provider:"codex",runnerId:"local",state:"CONFIGURED",authentication:{status:"ready",observedAt:"2026-10-16T12:00:00Z",source:"native-probe"}}})));
  expect(await screen.findByText(/登录已验证/)).toBeTruthy();
  expect(within(screen.getByText("kite").closest("tr")!).getByText("未检查")).toBeTruthy();
});

it("reviews task operations with the latest workflow revision before execution", async () => {
  const { TaskActions } = await import("../src/TaskActions.js");
  const posted: Array<{path: string; body: unknown}> = [];
  vi.spyOn(globalThis,"fetch").mockImplementation(async (input, init) => {
    posted.push({path:String(input),body:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify({workflow:{id:"w",revision:posted.length,state:posted.length===1?"NEEDS_APPROVAL":posted.length===2?"READY":"EXECUTED",toolName:"task.dispatch",questions:[]}}));
  });
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<TaskActions task={{id:"t",title:"Task",projectId:"p",state:"READY",updatedAt:"now"}} profiles={[]} refresh={refresh} />);
  await userEvent.click(screen.getByRole("button",{name:"派发任务"}));
  expect(posted).toHaveLength(1);
  await userEvent.click(await screen.findByRole("button",{name:"确认本次操作"}));
  await userEvent.click(await screen.findByRole("button",{name:"执行已确认操作"}));
  expect(posted).toEqual([{path:"/api/assistant/workflows",body:{intent:{version:2,action:"task.dispatch",entities:[{kind:"task",value:"t",id:"t"}],arguments:{target:"t"},confidence:1,source:"ui"}}},{path:"/api/assistant/workflows/w/approve",body:{revision:1}},{path:"/api/assistant/workflows/w/execute",body:{revision:2}}]);
  expect(refresh).toHaveBeenCalledOnce();
});
it("submits run and task authority with a decision reply and retains failed input", async () => {
  const { TaskActions } = await import("../src/TaskActions.js");
  const fetchMock = vi.spyOn(globalThis,"fetch").mockImplementation(async (input) => {
    if (input==="/api/tasks/t") return new Response(JSON.stringify({revision:7,document:{currentRunId:"r"}}));
    if (input==="/api/runs/r") return new Response(JSON.stringify({run:{state:"WAITING_USER",sessionId:"s",profileId:"ronna",generation:3,leaseId:"l",lastActivityAt:"now"}}));
    return new Response(JSON.stringify({message:"Run changed; refresh"}),{status:409});
  });
  render(<TaskActions task={{id:"t",title:"Task",projectId:"p",state:"WAITING_USER",updatedAt:"now",revision:7}} run={{id:"r",taskId:"t",profileId:"ronna",state:"WAITING_USER",createdAt:"now",updatedAt:"now",lastActivityAt:"now"}} profiles={[]} refresh={vi.fn()} />);
  await userEvent.type(screen.getByRole("textbox",{name:"回复 Agent 的决策请求"}),"continue");
  await userEvent.click(screen.getByRole("button",{name:"发送回复并继续"}));
  expect(await screen.findByText("Run changed; refresh")).toBeTruthy();
  expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({message:"continue",authority:{runId:"r",generation:3,leaseId:"l",taskRevision:7,lastActivityAt:"now"}});
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("continue");
});

it("does not upgrade an old decision answer to a newer waiting episode", async () => {
  const { TaskActions } = await import("../src/TaskActions.js");
  const fetchMock = vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({revision:8,document:{currentRunId:"r"}})));
  render(<TaskActions task={{id:"t",title:"Task",projectId:"p",state:"WAITING_USER",updatedAt:"now",revision:7}} run={{id:"r",taskId:"t",profileId:"ronna",state:"WAITING_USER",createdAt:"now",updatedAt:"now",lastActivityAt:"old"}} profiles={[]} refresh={vi.fn()} />);
  await userEvent.type(screen.getByRole("textbox"),"old answer");
  await userEvent.click(screen.getByRole("button",{name:"发送回复并继续"}));
  expect(await screen.findByText("当前运行已改变，请刷新后重新回复。")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("offers recovery instead of a blank console after a page render failure", async () => {
  const {ConsoleBoundary} = await import("../src/App.js");
  vi.spyOn(console,"error").mockImplementation(()=>undefined);
  function BrokenPage(): React.JSX.Element { throw Error("module unavailable"); }
  render(<ConsoleBoundary><BrokenPage /></ConsoleBoundary>);
  expect(screen.getByRole("alert").textContent).toContain("页面加载失败");
  expect(screen.getByRole("button",{name:"刷新页面"})).toBeTruthy();
});

it("shows the native enabled default without adding an untouched enabled edit",async()=>{
  const {default:SettingsPage}=await import("../src/SettingsPage.js"),posted:Array<{edits:Array<Record<string,unknown>>}>=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    if(String(input)==="/api/config/schema")return new Response(JSON.stringify({schema:{type:"object",properties:{agentProfiles:{type:"array",items:{type:"object",properties:{id:{type:"string"},alias:{type:"string",title:"Alias"},enabled:{type:"boolean"}}}}}},uiSchema:{}}));
    if(init?.method==="POST"){posted.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({plan:{id:"safe",risk:"sensitive",requiresConfirmation:true,changes:[{path:"/agentProfiles"}]}}));}
    return new Response(JSON.stringify({revision:1,config:{agentProfiles:[{id:"a",alias:"Before"}]}}));
  });
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SettingsPage sectionId="agentProfiles" embedded/></QueryClientProvider>);
  const field=await screen.findByLabelText("Alias");expect((screen.getByRole("checkbox",{name:"启用"}) as HTMLInputElement).checked).toBe(true);
  await userEvent.clear(field);await userEvent.type(field,"After");await userEvent.click(screen.getByRole("button",{name:"预览配置变更"}));await screen.findByRole("button",{name:"确认并应用"});
  expect(posted[0]!.edits).toEqual([{op:"replace",path:"/agentProfiles/0/alias",entityId:"a",value:"After"}]);
  await userEvent.click(screen.getByRole("checkbox",{name:"启用"}));await userEvent.click(screen.getByRole("button",{name:"预览配置变更"}));await screen.findByRole("button",{name:"确认并应用"});expect(posted[1]!.edits).toContainEqual({op:"add",path:"/agentProfiles/0/enabled",entityId:"a",value:false});
});

it("renders durable server authentication evidence on a fresh page load and marks stale evidence explicitly",async()=>{
  vi.stubGlobal("EventSource",class{addEventListener(){}close(){}});const {default:AgentsPage}=await import("../src/AgentsPage.js");let stale=false;
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input).includes("manifests")?{manifests:[{id:"codex",displayName:"Codex",platforms:[],configSchema:{type:"object"},uiSchema:{},secretFields:[],backends:[],capabilities:{}}]}:String(input).includes("compatibility")?{matrix:[]}:{profiles:[{id:"a",alias:"Account",provider:"codex",runnerId:"local",state:"CONFIGURED",authentication:{status:stale?"stale":"ready",observedAt:"2026-10-16T12:00:00Z",source:"native-probe"}}],sessions:[]})));
  const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><AgentsPage/></MemoryRouter></QueryClientProvider>);
  const first=mount();expect(await screen.findByText(/登录已验证/)).toBeTruthy();first.unmount();stale=true;mount();expect(await screen.findByText(/已过期，请重新检查/)).toBeTruthy();expect(screen.queryByText(/登录已验证/)).toBeNull();
});
