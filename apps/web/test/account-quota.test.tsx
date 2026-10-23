// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AccountQuotaPanel} from "../src/AccountQuotaPanel.js";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const snapshot={version:1,profileId:"p",source:"native/quota",collectedAt:"2026-10-22T12:00:00Z",periods:[{id:"week",unit:"percent",remaining:"0"},{id:"credits",unit:"credits",remaining:"9007199254740993.123456789012345678"}]};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AccountQuotaPanel profileId="p"/></QueryClientProvider>);}
it("reads saved quota without a provider query and preserves exact zero and missing values",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>new Response(JSON.stringify({quota:{profileId:"p",status:"fresh",snapshot}})));mount();
 const period=await screen.findByRole("row",{name:/week/});expect(within(period).getByText("0")).toBeTruthy();expect(within(period).getAllByText("未提供")).toHaveLength(3);expect(screen.getByText("9007199254740993.123456789012345678")).toBeTruthy();expect(fetch).toHaveBeenCalledOnce();expect(String(fetch.mock.calls[0]?.[0])).toBe("/api/agents/profiles/p/quota");expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
});
it("queries the native account only after explicit refresh and labels failed last success",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>new Response(JSON.stringify({quota:init?.method==="POST"?{profileId:"p",status:"error",snapshot,lastSuccessAt:"2026-10-22T12:00:00Z",error:{code:"QUOTA_QUERY_FAILED"}}:{profileId:"p",status:"missing"}})));mount();await screen.findByText("尚未采集账户额度");await userEvent.click(screen.getByRole("button",{name:"查询原生账户额度"}));
 expect(await screen.findByText("额度读取失败，以下为最后成功值")).toBeTruthy();expect(screen.getByText(/QUOTA_QUERY_FAILED/)).toBeTruthy();expect(fetch.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);expect(fetch.mock.calls.find(([,init])=>init?.method==="POST")?.[0]).toBe("/api/agents/profiles/p/quota/refresh");
});
it("keeps unsupported or changed-account quota unknown without inferred balances",async()=>{
 vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({quota:{profileId:"p",status:"unsupported"}})));mount();expect(await screen.findByText("此工具尚未提供账户周期额度")).toBeTruthy();expect(screen.getByRole<HTMLButtonElement>("button",{name:"查询原生账户额度"}).disabled).toBe(true);expect(screen.queryByRole("table")).toBeNull();
});
