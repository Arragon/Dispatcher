import {expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {get,ServerResponse,type IncomingMessage} from "node:http";
import {ControllerService} from "../src/service.js";

it.each(["ready","replay","live"] as const)("disconnects an owned SSE stream when %s output reaches backpressure",async phase=>{
  const root=mkdtempSync(join(tmpdir(),"dashboard-backpressure-")),service=new ControllerService({dataDirectory:root,port:0,ownerToken:"stream-owner",withRunner:true,backgroundWorker:{enabled:false}});
  const headers={authorization:"Bearer stream-owner"},blocked=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>(),original=ServerResponse.prototype.write;
  const stream:{response?:ServerResponse}={};let writes=0,response:IncomingMessage|undefined,request:ReturnType<typeof get>|undefined;
  const spy=vi.spyOn(ServerResponse.prototype,"write").mockImplementation(function(this:ServerResponse,chunk:unknown,...args:unknown[]){
    const result=Reflect.apply(original,this,[chunk,...args]) as boolean;
    if(typeof chunk==="string"&&chunk.startsWith("event: ready\n"))stream.response=this;
    if(this===stream.response){writes++;if(writes===(phase==="ready"?1:2)){blocked.resolve();return false;}}
    return result;
  });
  try{
    await service.start();const runner=service.runners.list()[0]!;
    if(phase==="replay")await service.events.publish("runnerChanged",runner);
    request=get(`${service.app.listeningOrigin}/api/events`,{headers},received=>{response=received;received.on("error",()=>undefined);received.on("data",()=>ready.resolve());});request.on("error",()=>undefined);
    if(phase==="live"){await ready.promise;await service.events.publish("runnerChanged",runner);}
    await blocked.promise;
    expect((await service.app.inject({url:"/api/system-impact",headers})).json().dashboardClients).toBe(0);
    const stoppedWrites=writes;
    for(let i=0;i<10;i++)await service.events.publish("runnerChanged",runner);
    expect(writes).toBe(stoppedWrites);
  }finally{spy.mockRestore();response?.destroy();request?.destroy();await service.stop();rmSync(root,{recursive:true,force:true});}
});
