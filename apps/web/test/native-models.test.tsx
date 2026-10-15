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
