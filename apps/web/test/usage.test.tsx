// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {UsagePanel} from "../src/UsagePanel.js";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(){vi.stubGlobal("EventSource",class{addEventListener(){}close(){}});return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><UsagePanel profileId="p"/></QueryClientProvider>);}
it("shows actual zero and cache inclusion without inventing missing account balances or making provider calls",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({observations:[{eventId:"e",profileId:"p",scope:"turn",mode:"snapshot",observedAt:"2026-10-16T12:00:00Z",source:"native-event",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens",includedIn:"input"}]}],totals:[{profileId:"p",scope:"turn",name:"input",value:"100",unit:"tokens"},{profileId:"p",scope:"turn",name:"output",value:"0",unit:"tokens"}],errors:[]})));mount();
 const output=await screen.findByRole("row",{name:"回合 输出 0 tokens"});expect(within(output).getByText("0")).toBeTruthy();expect(screen.getByText("缓存输入：70 tokens（已计入 输入）")).toBeTruthy();expect(fetch.mock.calls.every(([url,init])=>String(url).startsWith("/api/usage?")&&!init?.method)).toBe(true);
});
it("filters saved observations by explicit time range and leaves absent metrics unknown",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({observations:[],totals:[],errors:[]})));mount();expect(await screen.findByText("尚无已验证的原生用量；缺失值不按 0 计算。")).toBeTruthy();
 fireEvent.change(screen.getByLabelText("观测开始时间"),{target:{value:"2026-10-16T09:00"}});await userEvent.click(screen.getByRole("button",{name:"筛选用量"}));
 const last=String(fetch.mock.calls.at(-1)?.[0]),params=new URL(last,"http://localhost").searchParams;expect(params.get("from")).toBe(new Date("2026-10-16T09:00").toISOString());expect(params.get("profileId")).toBe("p");
});
