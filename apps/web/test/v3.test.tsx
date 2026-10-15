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
  expect(screen.getByText(/发布服务尚未开放/)).toBeTruthy();
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
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({snapshot:{generatedAt:"2026-10-15T00:00:00Z",projects:[],profiles:[],tasks:[{id:"archived",title:"Archived task",projectId:"p",state:"DONE",archivedAt:"2026-10-14",updatedAt:"now"}],runs:[]}})));
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
