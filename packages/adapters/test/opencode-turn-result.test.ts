import {expect,it,vi} from "vitest";
import {realpathSync} from "node:fs";
import {OpenCodeV2InteractionPort,type OpenCodeV2Request} from "../src/opencode-server.js";

const workspace=realpathSync(process.cwd()),model={providerID:"provider",id:"model"},at=Date.now();
const user=(id="msg_receipt",text="literal prompt")=>({id,type:"user",text,time:{created:at}});
const idle=(outcome="succeeded",id="msg_terminal")=>({id,type:"idle",outcome,time:{created:at}});
function fixture(){
 let pages:unknown[][]=[[]],active:Record<string,unknown>={},inbox:unknown[]=[],directory=workspace,updated=at;
 const request=vi.fn(async(input:OpenCodeV2Request):Promise<unknown>=>{
  if(input.path==="/api/info")return {version:"2.0.22",pid:123,urls:[],paths:{tmp:"/tmp"}};
  if(input.path==="/api/location")return {directory:workspace,project:{id:"project",directory:workspace,canonical:workspace}};
  if(input.path==="/api/session"||input.path==="/api/session/ses_exact")return {data:{id:"ses_exact",projectID:"project",model,permissions:[],location:{directory},time:{created:at,updated}}};
  if(input.path==="/api/session/active")return {data:active};
  if(input.path.endsWith("/inbox"))return {data:inbox};
  if(input.path.endsWith("/permission"))return {data:[]};
  if(input.path.endsWith("/prompt"))return {data:{id:"msg_receipt",sessionID:"ses_exact",type:"user",payload:{text:"literal prompt"},delivery:"queue",time:{created:at}}};
  if(input.path.endsWith("/message")){const i=Number(input.query?.cursor??0);return {data:pages[i]??[],cursor:{previous:i?String(i-1):null,next:i+1<pages.length?String(i+1):null}};}
  throw new Error("private native diagnostic");
 });
 const port=new OpenCodeV2InteractionPort({profileId:"p",runnerId:"local",nativeStoreRef:"store",workspacePath:workspace,scopeFingerprint:"scope",backendId:"opencode-server-v2"},{request});
 const start={commandId:"command",executionRefId:"execution",prompt:"literal prompt",model,permissions:[],onBinding:async()=>{}};
 return {port,request,start,setPages:(value:unknown[][])=>{pages=value},setActive:(value:typeof active)=>{active=value},setInbox:(value:unknown[])=>{inbox=value},move:()=>{directory="/different"},changeWatermark:()=>{updated++;}};
}
it("keeps accepted input and native idle observations pending without the exact history terminal",async()=>{
 const f=fixture(),created=await f.port.create(f.start);expect(created.receipt.state).toBe("accepted");expect(await f.port.readTurn(created.binding,"command")).toMatchObject({state:"pending",nativeMessageId:"msg_receipt"});f.setPages([[user()]]);expect((await f.port.readTurn(created.binding,"command")).state).toBe("pending");
});
it.each(["succeeded","failed","interrupted"])("reads the exact receipt followed by native %s",async outcome=>{
 const f=fixture(),created=await f.port.create(f.start);f.setPages([[idle("succeeded","msg_previous"),user(),{id:"msg_response",type:"assistant",content:[{type:"text",text:"actual result"}],time:{created:at,completed:at}},idle(outcome)]]);
 expect(await f.port.readTurn(created.binding,"command")).toMatchObject({state:outcome,nativeSessionId:"ses_exact",nativeMessageId:"msg_receipt",nativeTerminalMessageId:"msg_terminal",summary:"actual result"});expect(f.request.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(2);
});
it("ignores a previous turn's terminal and another prompt with the same text",async()=>{
 const f=fixture(),created=await f.port.create(f.start);f.setPages([[user("msg_other"),idle()]]);expect((await f.port.readTurn(created.binding,"command")).state).toBe("pending");f.setPages([[idle(),user()]]);expect((await f.port.readTurn(created.binding,"command")).state).toBe("pending");
});
it.each(["user","model-switched","location-switched","synthetic","skill"])("refuses external %s changes inside the captured turn",async type=>{
 const f=fixture(),created=await f.port.create(f.start);f.setPages([[user(),{id:"msg_external",type,text:"foreign input",time:{created:at}},idle()]]);await expect(f.port.readTurn(created.binding,"command")).rejects.toMatchObject({code:"OPENCODE_EXTERNAL_INPUT_CONFLICT"});
});
it.each(["running","queue"])("does not claim completion while native %s remains",async mode=>{
 const f=fixture(),created=await f.port.create(f.start);f.setPages([[user(),idle()]]);if(mode==="running")f.setActive({ses_exact:{type:"running"}});else f.setInbox([{id:"msg_receipt"}]);expect((await f.port.readTurn(created.binding,"command")).state).toBe("pending");
});
it("follows an opaque history cursor to the exact later terminal",async()=>{
 const f=fixture(),created=await f.port.create(f.start);f.setPages([[user()],[idle()]]);expect((await f.port.readTurn(created.binding,"command")).state).toBe("succeeded");expect(f.request).toHaveBeenCalledWith(expect.objectContaining({path:"/api/session/ses_exact/message",query:{limit:"100",order:"asc"}}));expect(f.request).toHaveBeenCalledWith(expect.objectContaining({query:{limit:"100",cursor:"1"}}));
});
it("accepts a reverse cursor on the oldest ascending page and follows the forward cursor to an empty tail",async()=>{
 const f=fixture(),created=await f.port.create(f.start),original=f.request.getMockImplementation()!;
 f.request.mockImplementation(async input=>input.path.endsWith("/message")?input.query?.cursor?{data:[],cursor:{previous:null,next:null}}:{data:[user(),idle()],cursor:{previous:"reverse-boundary",next:"forward-boundary"}}:original(input));
 expect((await f.port.readTurn(created.binding,"command")).state).toBe("succeeded");expect(f.request).toHaveBeenCalledWith(expect.objectContaining({query:{limit:"100",cursor:"forward-boundary"}}));
});
it.each(["duplicate message","loop cursor","invalid idle","wrong prompt","invalid time"])("refuses %s instead of inventing a native result",async mode=>{
 const f=fixture(),created=await f.port.create(f.start),original=f.request.getMockImplementation()!;f.setPages([[user(),idle()]]);
 if(mode==="duplicate message")f.setPages([[user(),user(),idle()]]);if(mode==="invalid idle")f.setPages([[user(),idle("unknown")]]);if(mode==="wrong prompt")f.setPages([[user("msg_receipt","different"),idle()]]);if(mode==="invalid time")f.setPages([[user(),{...idle(),time:{created:NaN}}]]);
 if(mode==="loop cursor")f.request.mockImplementation(async input=>input.path.endsWith("/message")?{data:[],cursor:{previous:null,next:"loop"}}:original(input));
 await expect(f.port.readTurn(created.binding,"command")).rejects.toMatchObject({code:mode==="wrong prompt"?"OPENCODE_TURN_IDENTITY_CHANGED":"OPENCODE_V2_SCHEMA_INVALID"});
});
it("bounds paginated result reads rather than treating a history gap as success",async()=>{
 const f=fixture(),created=await f.port.create(f.start);f.setPages(Array.from({length:21},()=>[]));await expect(f.port.readTurn(created.binding,"command")).rejects.toMatchObject({code:"OPENCODE_TURN_HISTORY_LIMIT"});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith("/message"))).toHaveLength(20);
});
it("rejects an unknown or restored command that lacks this host's accepted receipt",async()=>{
 const f=fixture(),created=await f.port.create(f.start),before=f.request.mock.calls.length;await expect(f.port.readTurn(created.binding,"restored-command")).rejects.toMatchObject({code:"OPENCODE_TURN_RECEIPT_UNAVAILABLE"});expect(f.request.mock.calls.length).toBe(before);
});
it("preserves location and disconnect guards across awaited result reads",async()=>{
 const f=fixture(),created=await f.port.create(f.start),original=f.request.getMockImplementation()!;f.setPages([[user(),idle()]]);f.request.mockImplementation(async input=>{const response=await original(input);if(input.path.endsWith("/message"))f.move();return response;});await expect(f.port.readTurn(created.binding,"command")).rejects.toMatchObject({code:"OPENCODE_LOCATION_MISMATCH"});
 const g=fixture(),other=await g.port.create(g.start),read=g.request.getMockImplementation()!;g.setPages([[user(),idle()]]);g.request.mockImplementation(async input=>{const response=await read(input);if(input.path.endsWith("/message"))g.port.markDisconnected();return response;});await expect(g.port.readTurn(other.binding,"command")).rejects.toMatchObject({code:"OPENCODE_RECONCILIATION_REQUIRED"});
});
it("keeps pending when native history changes during the read even after external input becomes idle",async()=>{
 const f=fixture(),created=await f.port.create(f.start),original=f.request.getMockImplementation()!;let changed=false;f.setPages([[user(),idle()]]);
 f.request.mockImplementation(async input=>{const response=await original(input);if(!changed&&input.path.endsWith("/message")){changed=true;f.setPages([[user(),idle(),user("msg_external","foreign"),idle("succeeded","msg_external_terminal")]]);f.changeWatermark();}return response;});expect((await f.port.readTurn(created.binding,"command")).state).toBe("pending");await expect(f.port.readTurn(created.binding,"command")).rejects.toMatchObject({code:"OPENCODE_EXTERNAL_INPUT_CONFLICT"});
});
it.each([false,true])("rejects earlier foreign input in the same unclosed turn, including a page boundary (%s)",async paginated=>{
 const f=fixture(),created=await f.port.create(f.start),prefix=[user("msg_foreign","foreign")];f.setPages(paginated?[prefix,[user(),idle()]]:[[...prefix,user(),idle()]]);await expect(f.port.readTurn(created.binding,"command")).rejects.toMatchObject({code:"OPENCODE_EXTERNAL_INPUT_CONFLICT"});
});
it("accepts a prior completed turn separated by its native idle marker across pages",async()=>{
 const f=fixture(),created=await f.port.create(f.start);f.setPages([[user("msg_foreign","foreign"),idle("succeeded","msg_prior_terminal")],[user(),idle()]]);expect((await f.port.readTurn(created.binding,"command")).state).toBe("succeeded");
});
it.each(["assistant","tool","shell","compaction"])("keeps a contradictory unclosed native %s pending",async kind=>{
 const f=fixture(),created=await f.port.create(f.start);let activity:unknown={id:"msg_activity",type:kind,status:"running",time:{created:at}};
 if(kind==="assistant")activity={id:"msg_activity",type:"assistant",content:[{type:"text",text:"streaming"}],time:{created:at}};
 if(kind==="tool")activity={id:"msg_activity",type:"assistant",content:[{type:"tool",state:{status:"running"}}],time:{created:at,completed:at}};
 f.setPages([[user(),activity,idle()]]);expect((await f.port.readTurn(created.binding,"command")).state).toBe("pending");
});
