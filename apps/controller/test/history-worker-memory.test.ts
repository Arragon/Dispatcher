import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {ControllerService} from "../src/service.js";

it("runs background maintenance without decoding unrelated completed history",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"history-worker-memory-"));
  const service=new ControllerService({dataDirectory:directory,ownerToken:"history-worker-owner",withRunner:true,backgroundWorker:{enabled:false}});
  try{
    await service.start({listen:false});
    service.database.transaction(()=>{
      for(let index=0;index<10_000;index++)service.database.saveEntity("run",`historical-${index}`,{id:`historical-${index}`,taskId:"history",state:"COMPLETE",runnerId:"local",profileId:"unconfigured",sessionId:`session-${index}`,generation:1,diagnostic:"inert-history-document"});
    });
    const parse=JSON.parse;let historicalDecodes=0;
    const decoding=vi.spyOn(JSON,"parse").mockImplementation((text:string,...args:unknown[])=>{if(text.includes("inert-history-document"))historicalDecodes++;return Reflect.apply(parse,JSON,[text,...args]);});
    try{await service.runBackgroundCycle();expect(historicalDecodes).toBe(0);}finally{decoding.mockRestore();}
    expect(service.database.listTaskRunsPage("history",0,20)).toMatchObject({total:10_000,hasActiveRun:false});
  }finally{await service.stop();rmSync(directory,{recursive:true,force:true});}
});
