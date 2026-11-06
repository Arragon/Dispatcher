// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {NativeModelPicker,nativeDefaultChoice} from "../src/NativeModelPicker.js";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const catalog=(id:string)=>({profileId:id,revision:`rev-${id}`,contextFingerprint:`ctx-${id}`,freshness:"native-fresh",source:"native-rpc",fetchedAt:"now",entries:[{id,displayName:id,selectable:true,access:"unconfirmed",parameterOptions:{reasoningEffort:["low","medium"]},parameterDefaults:{reasoningEffort:"medium"},billing:{mode:"unknown"}}]});
it("keeps late account responses out of the current model selector",async()=>{
  let resolveA:(value:Response)=>void=()=>undefined;
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>String(input).includes("/a/")?new Promise<Response>(resolve=>{resolveA=resolve;}):new Response(JSON.stringify(catalog("b-model"))));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const change=vi.fn();
  const view=(profileId:string)=><QueryClientProvider client={client}><NativeModelPicker profileId={profileId} repositoryId="repo" value={nativeDefaultChoice} onChange={change}/></QueryClientProvider>;
  const mounted=render(view("a"));mounted.rerender(view("b"));expect(await screen.findByRole("option",{name:/b-model/})).toBeTruthy();resolveA(new Response(JSON.stringify(catalog("a-model"))));
  await userEvent.selectOptions(screen.getByLabelText("原生模型"),"b-model");expect(change).toHaveBeenCalledWith(expect.objectContaining({modelId:"b-model",catalogRevision:"rev-b-model",allowUnconfirmed:false}));expect(screen.queryByRole("option",{name:/a-model/})).toBeNull();expect(screen.getByText(/价格未提供/)).toBeTruthy();
});
it("shows native choices without an empty effort selector when native metadata has no parameters",async()=>{
  const data=catalog("native-high");data.entries[0]!.parameterOptions={reasoningEffort:[]};
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(data)));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><NativeModelPicker profileId="account" repositoryId="repo" value={{modelId:"native-high",effort:"",catalogRevision:data.revision,contextFingerprint:data.contextFingerprint,allowUnconfirmed:false}} onChange={()=>undefined}/></QueryClientProvider>);
  expect(await screen.findByRole("option",{name:/native-high/})).toBeTruthy();expect(screen.queryByLabelText("思考强度")).toBeNull();
});
it("keeps policy targets concrete and represents native-default reasoning by omission",async()=>{
  const data={...catalog("concrete"),selectionSupport:"explicit",entries:[{...catalog("concrete").entries[0]!,kind:"model"},{...catalog("tier").entries[0]!,kind:"native-auto"}]};
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(data)));const change=vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><NativeModelPicker purpose="policy" profileId="account" repositoryId="repo" value={nativeDefaultChoice} onChange={change}/></QueryClientProvider>);
  expect(await screen.findByRole("option",{name:/concrete · concrete/})).toBeTruthy();expect((screen.getByRole("option",{name:/tier · tier/}) as HTMLOptionElement).disabled).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("原生模型"),"concrete");expect(change).toHaveBeenCalledWith(expect.objectContaining({modelId:"concrete",effort:""}));
});
