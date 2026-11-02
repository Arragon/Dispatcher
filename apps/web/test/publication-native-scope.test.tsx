// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import PublishPage from "../src/PublishPage.js";
import {PublicationNativeScope} from "../src/PublicationNativeScope.js";

beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
function mount(ui:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return {...render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>),client};}
const row=(backendId:string)=>({backendId,region:"global",installedVersion:"fixture",invalidationReason:"",installation:"supported",authentication:"supported",capabilities:[{name:"historyRead",support:"supported",evidenceLevel:"runtime-verified",historicalSupport:"supported"}],surfaces:[],nextVerification:"核对当前原生入口。"});
const profile=(id:string,revision:number,backendId:string)=>({profile:{id,configRevision:revision,interaction:{version:1,rows:[row(backendId)]}}});

it("shows native scope before publication and reads capabilities only on demand without a write",async()=>{
 const config={revision:7,config:{repositories:[{id:"repo",defaultBaseRef:"main",scopePaths:["."],verificationCommands:[]}],agentProfiles:[{id:"a",alias:"Account A",provider:"codex",runnerId:"local",enabled:true}]}};
 localStorage.setItem("dispatcher.publication-draft.v1",JSON.stringify({profileId:"a",repositoryId:"repo",description:"Preserved body"}));
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input)==="/api/agents/profiles/a"?profile("a",7,"native-a"):String(input).includes("/models")?{entries:[],selectionSupport:"native-default-only"}:config)));
 mount(<PublishPage/>);await screen.findByRole("option",{name:"Account A"});expect(screen.getByText(/兼容执行不保证原生历史/)).toBeTruthy();expect(fetch.mock.calls.some(([path])=>String(path)==="/api/agents/profiles/a")).toBe(false);
 await userEvent.click(screen.getByText("原生交互能力与限制",{exact:true}));await screen.findByText("native-a · global");expect(fetch.mock.calls.every(([,init])=>!init?.method||init.method==="GET")).toBe(true);expect((screen.getByLabelText("任务说明") as HTMLTextAreaElement).value).toBe("Preserved body");
});

it("ignores a late account read and never treats a failed refreshed header as current evidence",async()=>{
 let releaseA!:(value:Response)=>void,failB=false;
 vi.spyOn(globalThis,"fetch").mockImplementation(async input=>String(input)==="/api/agents/profiles/a"?new Promise<Response>(resolve=>{releaseA=resolve;}):new Response(JSON.stringify(failB?{message:"Fixture read failed"}:profile("b",8,"native-b")),{status:failB?500:200}));
 const f=mount(<PublicationNativeScope profileId="a" configRevision={7}/>);await userEvent.click(screen.getByText("原生交互能力与限制",{exact:true}));await waitFor(()=>expect(releaseA).toBeTypeOf("function"));
 f.rerender(<QueryClientProvider client={f.client}><MemoryRouter><PublicationNativeScope profileId="b" configRevision={8}/></MemoryRouter></QueryClientProvider>);await screen.findByText("native-b · global");
 await act(async()=>{releaseA(new Response(JSON.stringify(profile("a",7,"native-a"))));await Promise.resolve();});expect(screen.queryByText("native-a · global")).toBeNull();expect(screen.getByText(/^历史读取：已验证/)).toBeTruthy();
 failB=true;await userEvent.click(screen.getByRole("button",{name:"重新读取能力说明"}));await screen.findByRole("alert");expect(screen.getByText(/^历史读取：未确认/)).toBeTruthy();expect(screen.queryByText(/^历史读取：已验证/)).toBeNull();
});

it("sends the selected native GUI requirement through the existing preview and preserves the prompt when blocked",async()=>{
 localStorage.setItem("dispatcher.publication-draft.v1",JSON.stringify({profileId:"a",repositoryId:"repo",startMode:"dispatch",acceptance:"Keep requirement and body when blocked",description:"Preserved required-native task"}));
 const requests:Array<{path:string;body:Record<string,unknown>}>=[];
 vi.spyOn(globalThis,"fetch").mockImplementation(async (input,init)=>{const path=String(input);if(init?.method==="POST"){const body=JSON.parse(String(init.body));requests.push({path,body});return new Response(JSON.stringify({publicationId:"blocked-native",revision:1,canCommit:false,state:"NEEDS_INPUT",effectiveTask:{title:"Fixture",description:body.description,contractState:"READY",missing:[]},checks:[{id:"dispatch",status:"blocked",code:"NATIVE_CAPABILITY_UNVERIFIED",message:"所需原生界面尚未验证"}],confirmation:{required:true,reviewHash:"blocked",reasons:[]}}));}return new Response(JSON.stringify(path.includes("/models")?{entries:[],selectionSupport:"native-default-only"}:{revision:7,config:{repositories:[{id:"repo",defaultBaseRef:"main",scopePaths:["."],verificationCommands:[]}],agentProfiles:[{id:"a",alias:"Account A",provider:"codex",runnerId:"local",enabled:true}]}}));});
 mount(<PublishPage/>);await screen.findByRole("option",{name:"Account A"});await userEvent.selectOptions(screen.getByRole("combobox",{name:"原生交互要求"}),"native-gui");await userEvent.selectOptions(screen.getByRole("combobox",{name:"必须可用的原生界面"}),"desktop");await userEvent.click(screen.getByRole("button",{name:"检查并审阅"}));await screen.findByText(/所需原生界面尚未验证/);
 expect(screen.getByText("指定原生界面接管 · 桌面",{exact:true})).toBeTruthy();expect(screen.getByText("尚无可用的执行选择，请先处理预检阻断项。")).toBeTruthy();
 expect(requests).toHaveLength(1);expect(requests[0]!.path).toBe("/api/task-publications/preview");expect((requests[0]!.body.execution as Record<string,unknown>).interactionRequirement).toEqual({version:1,profileId:"a",mode:"native-gui",surface:"desktop",executionLocation:"managed-worktree"});expect((screen.getByLabelText("任务说明") as HTMLTextAreaElement).value).toBe("Preserved required-native task");expect(JSON.parse(localStorage.getItem("dispatcher.publication-draft.v1")!).interactionMode).toBe("native-gui");
});
