import {expect,it,vi} from "vitest";
import {DirectorySelections} from "../src/local-directories.js";
it("keeps one owned dialog active until cancellation settles, then discards a late path",async()=>{
 const gate=Promise.withResolvers<string|undefined>(),picker=vi.fn(async()=>gate.promise),selections=new DirectorySelections(picker);
 const first=selections.begin("local");expect(first.state).toBe("pending");expect(()=>selections.begin("local")).toThrow(expect.objectContaining({code:"NATIVE_PICKER_BUSY"}));
 expect(selections.cancel(first.id)?.state).toBe("cancelling");expect(()=>selections.begin("local")).toThrow(expect.objectContaining({code:"NATIVE_PICKER_BUSY"}));
 gate.resolve("/must-not-be-accepted");await selections.settle();expect(selections.get(first.id)).toMatchObject({state:"cancelled"});expect(selections.get(first.id)).not.toHaveProperty("path");expect(picker).toHaveBeenCalledOnce();await selections.close();
});
it("returns a candidate only, distinguishes OS cancellation/unavailability and never runs shell input",async()=>{
 const selections=new DirectorySelections(async()=>"/registered/candidate");const operation=selections.begin("local");await selections.settle();expect(selections.get(operation.id)).toMatchObject({state:"selected",path:"/registered/candidate",runnerId:"local"});await selections.close();
 const cancelled=new DirectorySelections(async()=>undefined),cancel=cancelled.begin("local");await cancelled.settle();expect(cancelled.get(cancel.id)).toMatchObject({state:"cancelled"});await cancelled.close();
 const failed=new DirectorySelections(async()=>{throw new Error("private host diagnostic");}),bad=failed.begin("local");await failed.settle();expect(failed.get(bad.id)).toMatchObject({state:"unavailable",reasonCode:"NATIVE_PICKER_UNAVAILABLE"});expect(JSON.stringify(failed.get(bad.id))).not.toContain("private");await failed.close();
});

it("requires local admin/auth/CSRF, rejects remote or injected picker scope, and leaves configuration untouched",async()=>{
 const {mkdtempSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{ControllerService}=await import("../src/service.js");
 const directory=mkdtempSync(join(tmpdir(),"local-directory-api-")),gate=Promise.withResolvers<string|undefined>(),picker=vi.fn(async()=>gate.promise),headers={authorization:"Bearer picker-owner"};
 const service=new ControllerService({dataDirectory:directory,ownerToken:"picker-owner",withRunner:true,directoryPicker:picker,backgroundWorker:{enabled:false},secretStore:{test:async()=>false} as never});
 try{
  const config=service.configuration.current().config;config.runners.push({id:"remote",mode:"remote",displayName:"Remote",capacity:1,tags:[],credentialRef:"secret://runner/remote"});service.configuration.applyPlan(service.configuration.buildPlan(config,"fixture","cli").id,{confirmed:true});await service.start({listen:false});const revision=service.configuration.current().revision;
  const input={method:"POST" as const,url:"/api/local/directory-selections",payload:{purpose:"repository"}};
  expect((await service.app.inject(input)).statusCode).toBe(401);expect((await service.app.inject({...input,headers,remoteAddress:"192.0.2.10"})).statusCode).toBe(409);
  expect((await service.app.inject({...input,headers,payload:{purpose:"repository",runnerId:"remote"}})).json()).toMatchObject({code:"NATIVE_PICKER_UNAVAILABLE"});
  expect((await service.app.inject({...input,headers,payload:{purpose:"repository",script:"must-not-execute"}})).statusCode).toBe(400);
  expect((await service.app.inject({...input,headers:{...headers,origin:"https://outside.invalid"}})).statusCode).toBe(403);expect(picker).not.toHaveBeenCalled();
  const code=new URL(service.issueDashboardLogin("http://localhost").url).hash.slice("#login=".length),session=await service.app.inject({method:"POST",url:"/auth/session",payload:{code}}),raw=session.headers["set-cookie"],cookie=(Array.isArray(raw)?raw:[raw]).map(value=>String(value).split(";")[0]).join("; ");
  expect(session.statusCode).toBe(201);expect((await service.app.inject({...input,headers:{cookie}})).json()).toMatchObject({code:"CSRF_REJECTED"});expect(picker).not.toHaveBeenCalled();
  const selected=await service.app.inject({...input,headers});expect(selected.statusCode).toBe(201);const id=selected.json().selection.id;
  expect((await service.app.inject({...input,headers})).json()).toMatchObject({code:"NATIVE_PICKER_BUSY"});
  expect((await service.app.inject({headers,method:"DELETE",url:`/api/local/directory-selections/${id}`})).statusCode).toBe(200);gate.resolve("/late/candidate");await new Promise(resolve=>setImmediate(resolve));
  expect((await service.app.inject({headers,url:`/api/local/directory-selections/${id}`})).json()).toMatchObject({selection:{state:"cancelled"}});expect(picker).toHaveBeenCalledOnce();expect(service.configuration.current().revision).toBe(revision);expect(service.configuration.current().config.repositories).toEqual([]);
 }finally{gate.resolve();await service.stop();rmSync(directory,{recursive:true,force:true});}
});
