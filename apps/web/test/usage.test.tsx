// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {UsagePanel} from "../src/UsagePanel.js";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(sessionId?:string){vi.stubGlobal("EventSource",class{addEventListener(){}close(){}});return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><UsagePanel profileId="p" {...(sessionId?{sessionId}:{})}/></QueryClientProvider>);}
it("shows actual zero and cache inclusion without inventing missing account balances or making provider calls",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({observations:[{eventId:"e",profileId:"p",scope:"turn",mode:"snapshot",observedAt:"2026-10-16T12:00:00Z",source:"native-event",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens",includedIn:"input"}]}],totals:[{profileId:"p",scope:"turn",name:"input",value:"100",unit:"tokens"},{profileId:"p",scope:"turn",name:"output",value:"0",unit:"tokens"}],errors:[]})));mount();
 const output=await screen.findByRole("row",{name:"回合 输出 0 tokens"});expect(within(output).getByText("0")).toBeTruthy();expect(screen.getByText("缓存输入：70 tokens（已计入 输入）")).toBeTruthy();expect(fetch.mock.calls.every(([url,init])=>String(url).startsWith("/api/usage?")&&!init?.method)).toBe(true);
});
it("filters saved observations by explicit time range and leaves absent metrics unknown",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({observations:[],totals:[],errors:[]})));mount();expect(await screen.findByText("尚无已验证的原生用量；缺失值不按 0 计算。")).toBeTruthy();
 fireEvent.change(screen.getByLabelText("观测开始时间"),{target:{value:"2026-10-16T09:00"}});await userEvent.click(screen.getByRole("button",{name:"筛选用量"}));
 const last=String(fetch.mock.calls.at(-1)?.[0]),params=new URL(last,"http://localhost").searchParams;expect(params.get("from")).toBe(new Date("2026-10-16T09:00").toISOString());expect(params.get("profileId")).toBe("p");
});

it("reads standalone saved usage by session identity without claiming a canonical Run",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({observations:[],totals:[],errors:[]})));mount("standalone");await screen.findByText("尚无已验证的原生用量；缺失值不按 0 计算。");const params=new URL(String(fetch.mock.calls[0]?.[0]),"http://localhost").searchParams;expect(params.get("sessionId")).toBe("standalone");expect(params.has("runId")).toBe(false);expect(fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true);
});
it("shows exact estimated cost and its frozen formula evidence alongside native actual cost",async()=>{
 const price={version:1,id:"price-original",source:"native/account-model",collectedAt:"2026-10-22T12:00:00Z",unit:"credits",rates:{per:"1000",input:"0.1",includesMultiplier:true}};
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>new Response(JSON.stringify({observations:[{eventId:"e",scope:"run",mode:"snapshot",observedAt:"2026-10-22T12:00:00Z",source:"native-event",metrics:[{name:"cost",value:"0",unit:"USD"}]}],totals:[{profileId:"p",scope:"run",name:"cost",value:"0",unit:"USD"}],errors:[],estimation:{status:"partial",estimate:{version:1,runId:"r",formulaVersion:"native-usage-decimal-v1",scope:"run",collectedAt:"2026-10-22T12:00:00Z",completeness:"partial",unit:"credits",value:"12345678901234567890.123456789012345678",pricingSnapshot:price,inputs:[{eventId:"native-input-1",profileId:"p",sessionId:"s"}],rounding:{scale:18,mode:"half-up",applied:true}}}})));mount();
 expect(await screen.findByText("12345678901234567890.123456789012345678 credits")).toBeTruthy();expect(screen.getByRole("row",{name:"运行 实际上报费用 0 USD"})).toBeTruthy();expect(screen.getByText(/native-usage-decimal-v1/)).toBeTruthy();expect(screen.getByText(/price-original/)).toBeTruthy();expect(screen.getByText(/native-input-1/)).toBeTruthy();expect(fetch.mock.calls.every(([url,init])=>String(url).startsWith("/api/usage?")&&!init?.method)).toBe(true);
});
it("explains a missing native billing time without displaying a fabricated estimate",async()=>{
 vi.spyOn(globalThis,"fetch").mockImplementation(async()=>new Response(JSON.stringify({observations:[],totals:[],errors:[],estimation:{status:"unavailable",reasonCode:"PRICE_TIME_UNPROVEN"}})));mount();expect(await screen.findByText("缺少已验证的原生计费时间")).toBeTruthy();expect(screen.queryByText(/0 credits/)).toBeNull();
});
it("labels a saved amount as partial when the latest native usage read failed",async()=>{
 vi.spyOn(globalThis,"fetch").mockImplementation(async()=>new Response(JSON.stringify({observations:[],totals:[],errors:[],estimation:{status:"partial",reasonCode:"USAGE_UNAVAILABLE",estimate:{version:1,runId:"r",formulaVersion:"native-usage-decimal-v1",scope:"run",collectedAt:"2026-10-22T12:00:00Z",completeness:"partial",unit:"credits",value:"0.01",inputs:[],rounding:{scale:18,mode:"half-up",applied:false}}}})));mount();expect(await screen.findByText("0.01 credits")).toBeTruthy();expect(screen.getByText("原生用量读取失败，保留已有用量的部分估算")).toBeTruthy();expect(screen.queryByText(/估算输入完整/)).toBeNull();
});
