import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {backup} from "node:sqlite";
import {expect,it,vi} from "vitest";
import {VerificationRegistry,type VerificationResult} from "@dispatcher/runner";
import {ControllerService} from "../src/service.js";
import {localReviewFixture} from "./fixtures/local-review.js";
const passed:VerificationResult={commandId:"check",required:true,status:"passed",exitCode:0,durationMs:1,output:"",truncated:false};
it("does not repeat an automatic verification after Task revision changes during execution",async()=>{
 const f=await localReviewFixture({advance:false}),entered=Promise.withResolvers<void>(),settle=Promise.withResolvers<VerificationResult>();
 const execute=vi.spyOn(VerificationRegistry.prototype,"run").mockImplementation(()=>{entered.resolve();return settle.promise;});
 try{
  const pending=f.service.app.inject({method:"POST",url:`/api/runs/${f.receipt.runId}/advance`,headers:f.headers}).then(r=>r);
  await entered.promise;const task=f.service.database.getCanonicalTask(f.receipt.taskId)!;
  f.service.database.writeCanonicalTask(f.receipt.taskId,task.revision,{...task.document as object,description:"Changed during verification"},new Date().toISOString());
  settle.resolve(passed);expect((await pending).statusCode).toBe(409);
  const again=await f.service.app.inject({method:"POST",url:`/api/runs/${f.receipt.runId}/advance`,headers:f.headers});
  expect(again.statusCode).toBe(409);expect(execute).toHaveBeenCalledTimes(1);
  expect(f.service.database.listEntities("run-verification-command")).toEqual([expect.objectContaining({state:"UNKNOWN"})]);
 }finally{settle.resolve(passed);execute.mockRestore();await f.close();}
});
it("retains a crash-time send as unknown after restart without replaying a command or native start",async()=>{
 const f=await localReviewFixture({advance:false}),entered=Promise.withResolvers<void>(),settle=Promise.withResolvers<VerificationResult>();
 const execute=vi.spyOn(VerificationRegistry.prototype,"run").mockImplementation(()=>{entered.resolve();return execute.mock.calls.length===1?settle.promise:Promise.resolve(passed);});let restarted:ControllerService|undefined;
 const pending=f.service.app.inject({method:"POST",url:`/api/runs/${f.receipt.runId}/advance`,headers:f.headers}).then(r=>r);
 try{
  await entered.promise;const data=join(f.root,"crash-data");mkdirSync(data);await backup(f.service.database.handle,join(data,"dispatcher.sqlite"));
  const start=vi.fn(()=>{throw Error("UNEXPECTED_NATIVE_START");});restarted=new ControllerService({dataDirectory:data,ownerToken:"local-review-fixture",withRunner:true,backgroundWorker:{enabled:false},codexBackendFactory:()=>({start})});await restarted.start({listen:false});
  const response=await restarted.app.inject({method:"POST",url:`/api/runs/${f.receipt.runId}/advance`,headers:f.headers});await restarted.runBackgroundCycle();
  expect(response.statusCode).toBe(409);expect(execute).toHaveBeenCalledTimes(1);expect(start).not.toHaveBeenCalled();
  expect(restarted.database.listEntities("run-verification-command")).toEqual([expect.objectContaining({state:"UNKNOWN"})]);
 }finally{settle.resolve(passed);await pending;execute.mockRestore();await restarted?.stop();await f.close();}
});
