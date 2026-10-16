// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PublishPage from "../src/PublishPage.js";
import TasksPage from "../src/TasksPage.js";
import { ConsoleLayout } from "../src/ConsoleLayout.js";

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(ui: React.ReactNode, route = "/publish") {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>);
}
const config = {revision:1,config:{repositories:[{id:"repo",root:"/workspace/repo",defaultBaseRef:"main",scopePaths:["src"],verificationCommands:[]}],agentProfiles:[{id:"codex",provider:"codex",alias:"Work account",enabled:true,runnerId:"local",settings:{model:"configured-candidate"}}]}};
it("reviews an automatic decision separately and preserves the exact payload across commit recovery",async()=>{
  const posts:Array<{path:string;body:Record<string,unknown>}>=[];
  const policy={enabled:true,requireConfirmation:true,classificationMode:"keyword",taskTypes:[{id:"fix",name:"修复",enabled:true}],rules:[]};
  const preview={publicationId:"auto-pub",revision:1,state:"PREVIEW",canCommit:true,effectiveTask:{title:"修复",description:"修复正文",contractState:"READY",missing:[]},checks:[],confirmation:{required:true,reviewHash:"auto-hash",reasons:[]},routingDecision:{id:"decision-1",status:"ready",classification:{source:"keyword",taskTypeId:"fix",keyword:{candidates:["fix"],evidence:[]}},ruleResult:{status:"matched",ruleIds:["fix-rule"],excluded:[]},target:{modelId:"policy-model",nativeParameters:{}},confirmation:{required:true,mode:"pending"},policyVersion:"policy-v1"}};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{const path=String(input);if(init?.method==="POST"){posts.push({path,body:JSON.parse(String(init.body))});return new Response(JSON.stringify(path.endsWith("/preview")?preview:{publicationId:"auto-pub",state:"STARTED",taskId:"auto-task",runId:"auto-run"}));}return new Response(JSON.stringify(path.includes("/api/runs/")?{run:{id:"auto-run",state:"ACTIVE",profileId:"codex",verification:{state:"PENDING"}}}:{...config,config:{...config.config,policies:{modelRouting:policy}}}));});
  mount(<PublishPage/>);await screen.findByRole("option",{name:/repo/});await userEvent.selectOptions(screen.getByLabelText("项目仓库"),"repo");await userEvent.selectOptions(screen.getByLabelText("Harness 账号"),"codex");await userEvent.selectOptions(screen.getByLabelText("执行方式"),"dispatch");await userEvent.selectOptions(screen.getByLabelText("模型选择方式"),"policy-auto");await userEvent.type(screen.getByLabelText("任务说明"),"修复正文");await userEvent.type(screen.getByLabelText("验收条件（每行一条）"),"通过验证");await userEvent.click(screen.getByLabelText("知悉目录不代表模型访问权限"));
  expect(posts).toHaveLength(0);await userEvent.click(screen.getByRole("button",{name:"检查并审阅"}));
  const button=await screen.findByRole("button",{name:"确认并启动执行"});expect((button as HTMLButtonElement).disabled).toBe(true);await userEvent.click(screen.getByLabelText("确认本次自动路由选择"));await userEvent.click(button);await screen.findByRole("link",{name:"查看已创建任务"});
  expect(posts[0]?.body.execution).toMatchObject({selectionMode:"policy-auto",profileId:"codex",allowUnconfirmedModelAccess:true});expect(posts[0]?.body.execution).not.toHaveProperty("nativeModelId");expect(posts[1]?.body).toMatchObject({confirmation:{accepted:true,routingAccepted:true}});
});
it("sends trial text to the classifier only after an explicit semantic trial action",async()=>{
  const {default:PoliciesPage}=await import("../src/PoliciesPage.js"),posts:Record<string,unknown>[]=[];
  const policy={enabled:true,requireConfirmation:true,classificationMode:"hybrid",taskTypes:[],rules:[]};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(_input,init)=>{if(init?.method==="POST"){posts.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({source:"applied",decision:{id:"trial",classification:{source:"keyword",keyword:{candidates:[],evidence:[]}},ruleResult:{ruleIds:[],excluded:[]},confirmation:{mode:"pending"},policyVersion:"v1"}}));}return new Response(JSON.stringify({...config,config:{...config.config,policies:{highRiskRequiresConfirmation:true,rawShellDefault:"deny",modelRouting:policy}}}));});
  mount(<PoliciesPage/>,"/policies");await screen.findByRole("heading",{name:"路由试算"});await userEvent.selectOptions(screen.getByLabelText("试算项目"),"repo");await userEvent.selectOptions(screen.getByLabelText("试算账号"),"codex");await userEvent.type(screen.getByLabelText("示例任务"),"repair controls");expect(posts).toHaveLength(0);
  await userEvent.click(screen.getByRole("button",{name:"运行路由试算"}));expect(posts[0]).toMatchObject({semantic:false});
  await userEvent.click(screen.getByLabelText("语义试算：将示例标题和任务发送给内部分类模型"));expect(posts).toHaveLength(1);await userEvent.click(screen.getByRole("button",{name:"发送到内部模型并试算"}));expect(posts[1]).toMatchObject({semantic:true});
});
it("keeps publication drafts across reloads without creating tasks or invoking a model", async () => {
  const fetchMock = vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(config)));
  const first = mount(<PublishPage/>);
  await screen.findByRole("option",{name:/repo/});
  await userEvent.type(screen.getByLabelText("任务标题"),"A real task");
  await userEvent.type(screen.getByLabelText("任务说明"),"Keep the complete task body.");
  first.unmount();
  mount(<PublishPage/>);
  expect((await screen.findByLabelText("任务标题") as HTMLInputElement).value).toBe("A real task");
  expect((screen.getByLabelText("任务说明") as HTMLTextAreaElement).value).toBe("Keep the complete task body.");
  expect(fetchMock.mock.calls.every(([,init]) => !init?.method || init.method === "GET")).toBe(true);
  expect(screen.getByText(/服务端预检/)).toBeTruthy();
});
it("validates references and does not manufacture a successful publication", async () => {
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(config)));
  mount(<PublishPage/>);
  await screen.findByRole("option",{name:/repo/});
  await userEvent.selectOptions(screen.getByLabelText("项目仓库"),"repo");
  await userEvent.type(screen.getByLabelText("任务说明"),"Fix a bug");
  await userEvent.click(screen.getByText("验收与参考"));
  await userEvent.type(screen.getByLabelText("参考链接（每行一条）"),"javascript:alert(1)");
  await userEvent.click(screen.getByRole("button",{name:"检查并审阅"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("http"));
  expect(screen.queryByText("发布成功")).toBeNull();
});
it("opens the authoritative task from a deep link even when archived", async () => {
  const task={id:"archived",title:"Archived task",projectId:"p",state:"DONE",archivedAt:"2026-10-14",updatedAt:"now"};
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input)==="/api/fleet"?{snapshot:{generatedAt:"2026-10-15T00:00:00Z",projects:[],profiles:[],tasks:[task],runs:[]}}:{revision:1,document:task,archive:{revision:1,archivedAt:task.archivedAt},runs:[],deliveries:[]})));
  mount(<TasksPage/>,"/tasks?task=archived");
  const dialog = await screen.findByRole("dialog",{name:"Archived task"});
  expect(within(dialog).getByRole("button",{name:"恢复到当前项目"})).toBeTruthy();
});
it("opens global search with the keyboard and preserves navigation when task reads fail", async () => {
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({message:"unavailable"}),{status:503}));
  mount(<ConsoleLayout><h1>Test screen</h1></ConsoleLayout>,"/overview");
  await userEvent.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog",{name:"搜索工作区"});
  await userEvent.type(within(dialog).getByLabelText("搜索页面、任务或 ID"),"设备");
  expect(within(dialog).getByRole("button",{name:"设备管理"})).toBeTruthy();
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
});
it("keeps mobile navigation focus inside the open panel and returns to its trigger", async () => {
  mount(<ConsoleLayout><h1>Workspace screen</h1></ConsoleLayout>,"/overview");
  const trigger=screen.getByRole("button",{name:"打开导航"});
  await userEvent.click(trigger);
  expect(trigger.closest(".console-body")?.hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(within(screen.getByRole("navigation",{name:"Main navigation"})).getByRole("link",{name:"总览"}));
  await userEvent.keyboard("{Escape}");
  expect(trigger.closest(".console-body")?.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
it("imports only a supported local draft and performs no publication request", async () => {
  const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(config)));
  mount(<PublishPage/>);
  await screen.findByRole("option",{name:/repo/});
  const backup=new File([JSON.stringify({schemaVersion:1,title:"Recovered title",description:"Recovered complete body",startMode:"create-only",token:"must-not-be-retained"})],"draft.json",{type:"application/json"});
  await userEvent.upload(screen.getByLabelText("导入任务草稿"),backup);
  expect((await screen.findByLabelText("任务标题") as HTMLInputElement).value).toBe("Recovered title");
  expect((screen.getByLabelText("任务说明") as HTMLTextAreaElement).value).toBe("Recovered complete body");
  expect(localStorage.getItem("dispatcher.publication-draft.v1")).not.toContain("must-not-be-retained");
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method || init.method==="GET")).toBe(true);
});
it("opens the attention target when navigating from the global attention link", async () => {
  const {default:FleetPage}=await import("../src/FleetPage.js");
  const scroll=vi.fn();
  HTMLElement.prototype.scrollIntoView=scroll;
  vi.spyOn(globalThis,"fetch").mockImplementation(async (input)=>new Response(JSON.stringify(input === "/api/runners" ? {runners:[]} : {snapshot:{generatedAt:"2026-10-15",tasks:[],runs:[],profiles:[],connectors:[],attention:[],counts:{activeRuns:0,unhealthyConnectors:0}}})));
  mount(<FleetPage/>,"/overview#attention");
  await screen.findByText("需要你处理");
  expect(scroll).toHaveBeenCalledOnce();
});

it("commits the reviewed publication and recovers the same receipt after a lost response", async()=>{
  const posts:Array<{path:string;body:unknown;key:unknown}>=[];
  const preview={publicationId:"pub-1",revision:1,state:"PREVIEW",canCommit:true,effectiveTask:{title:"Task",description:"Complete original body",contractState:"READY",missing:[]},checks:[],confirmation:{required:true,reviewHash:"review-hash",reasons:[]}};
  const receipt={publicationId:"pub-1",revision:1,state:"TASK_CREATED",taskId:"task-1"};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);
    if(init?.method==="POST"){posts.push({path,body:JSON.parse(String(init.body)),key:(init.headers as Record<string,string>)["Idempotency-Key"]});if(path.endsWith("/commit"))throw new Error("Response lost");return new Response(JSON.stringify(preview));}
    return new Response(JSON.stringify(path.includes("task-publications/pub-1")?receipt:config));
  });
  mount(<PublishPage/>);await screen.findByRole("option",{name:/repo/});await userEvent.type(screen.getByLabelText("任务说明"),"Complete original body");await userEvent.click(screen.getByRole("button",{name:"检查并审阅"}));
  await userEvent.click(await screen.findByRole("button",{name:"确认并创建任务"}));
  expect(await screen.findByRole("link",{name:"查看已创建任务"})).toHaveProperty("href",expect.stringContaining("task-1"));
  expect(posts).toHaveLength(2);expect(posts[1]).toMatchObject({body:{revision:1,reviewHash:"review-hash",confirmation:{accepted:true}},key:expect.any(String)});
});
it("does not replace an uncertain commit with another publication preview",async()=>{
  let previews=0;
  const preview={publicationId:"uncertain",revision:1,state:"PREVIEW",canCommit:true,effectiveTask:{title:"Task",description:"body",contractState:"READY",missing:[]},checks:[],confirmation:{required:true,reviewHash:"hash",reasons:[]}};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
    const path=String(input);if(path.endsWith("/preview")){previews++;return new Response(JSON.stringify(preview));}if(path.includes("/task-publications/"))throw new Error("Network unavailable");return new Response(JSON.stringify(config));
  });
  mount(<PublishPage/>);await screen.findByRole("option",{name:/repo/});await userEvent.type(screen.getByLabelText("任务说明"),"body");await userEvent.click(screen.getByRole("button",{name:"检查并审阅"}));await userEvent.click(await screen.findByRole("button",{name:"确认并创建任务"}));await screen.findByText(/提交结果未知/);
  await userEvent.click(screen.getByRole("button",{name:"关闭"}));await userEvent.click(screen.getByRole("button",{name:"检查并审阅"}));expect(previews).toBe(1);
});
