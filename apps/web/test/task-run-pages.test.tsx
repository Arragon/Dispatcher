// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {TaskDetail} from "../src/TaskDetail.js";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("pages execution history without losing current authority and resets selection for another task",async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};vi.stubGlobal("EventSource",class{addEventListener(){}close(){}});
 const requests:string[]=[],run=(id:string,taskId="task",state="COMPLETE")=>({id,taskId,state,profileId:"profile",providerId:"codex"});
 vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
  const url=new URL(String(input),"http://fixture.invalid");requests.push(url.pathname+url.search);
  if(url.pathname==="/api/tasks/task"){const offset=Number(url.searchParams.get("runsOffset")??0);return new Response(JSON.stringify({revision:1,document:{id:"task",title:"History task",state:"RUNNING",currentRunId:"current"},deliveries:[],currentRun:run("current","task","ACTIVE"),runs:offset===0?[run("newer")]:[run("older")],runPage:{offset,limit:20,total:21,hasActiveRun:true,...(offset===0?{nextOffset:20}:{})}}));}
  if(url.pathname==="/api/tasks/another")return new Response(JSON.stringify({revision:1,document:{id:"another",title:"Another task",state:"RUNNING",currentRunId:"next-current"},deliveries:[],currentRun:run("next-current","another","ACTIVE"),runs:[],runPage:{offset:0,limit:20,total:0,hasActiveRun:true}}));
  if(url.pathname.startsWith("/api/runs/")){if(url.pathname.endsWith("/result"))return new Response(JSON.stringify({code:"RUN_RESULT_UNAVAILABLE"}),{status:404});const id=url.pathname.split("/").at(-1)!;return new Response(JSON.stringify({run:run(id,id==="next-current"?"another":"task",id==="older"?"FAILED":"ACTIVE")}));}
  return new Response(JSON.stringify({observations:[],totals:[],errors:[],estimation:{status:"unavailable",reasonCode:"BILLING_BASELINE_MISSING"}}));
 });
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),view=(id:string)=><QueryClientProvider client={client}><MemoryRouter><TaskDetail key={id} id={id} profiles={[]} onClose={()=>undefined} refresh={async()=>undefined}/></MemoryRouter></QueryClientProvider>,mounted=render(view("task"));
 await screen.findByRole("heading",{name:"History task"});expect(requests).toContain("/api/tasks/task?runsOffset=0&runsLimit=20");expect((screen.getByRole("button",{name:"归档任务"}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByLabelText("查看运行") as HTMLSelectElement).value).toBe("current");await userEvent.click(screen.getByRole("button",{name:"较早记录"}));await screen.findByRole("option",{name:/older/});expect(requests).toContain("/api/tasks/task?runsOffset=20&runsLimit=20");expect((screen.getByLabelText("查看运行") as HTMLSelectElement).value).toBe("current");
 await userEvent.selectOptions(screen.getByLabelText("查看运行"),"older");await waitFor(()=>expect(requests).toContain("/api/runs/older"));mounted.rerender(view("another"));await screen.findByRole("heading",{name:"Another task"});await waitFor(()=>expect((screen.getByLabelText("查看运行") as HTMLSelectElement).value).toBe("next-current"));expect(requests).toContain("/api/tasks/another?runsOffset=0&runsLimit=20");
});
