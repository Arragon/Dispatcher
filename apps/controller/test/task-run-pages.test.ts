import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {ControllerService} from "../src/service.js";

it("pages task runs in SQLite while retaining current and active facts outside the visible page",async()=>{
 const root=mkdtempSync(join(tmpdir(),"task-run-pages-")),service=new ControllerService({dataDirectory:root,ownerToken:"pages-owner",backgroundWorker:{enabled:false}}),headers={authorization:"Bearer pages-owner"};
 try{
  await service.start({listen:false});const db=service.database;
  db.writeCanonicalTask("task",0,{id:"task",title:"paged",state:"RUNNING",currentRunId:"run-0"},"2026-10-20T00:00:00Z");
  for(let index=0;index<45;index++)db.saveEntity("run",`run-${index}`,{id:`run-${index}`,taskId:"task",state:index===0?"ACTIVE":"COMPLETE"},new Date(Date.UTC(2026,9,20,0,index)).toISOString());
  db.saveEntity("run","other",{id:"other",taskId:"another-task",state:"ACTIVE"});
  const before=(await service.app.inject({url:"/api/tasks/task",headers})).json();expect(before.runs).toHaveLength(45);
  const original=db.listEntities.bind(db),spy=vi.spyOn(db,"listEntities").mockImplementation(kind=>{if(kind==="run")throw Error("UNBOUNDED_RUN_READ");return original(kind);});
  try{
   const response=await service.app.inject({url:"/api/tasks/task?runsOffset=0&runsLimit=20",headers});expect(response.statusCode,response.body).toBe(200);const first=response.json();
   expect(first.runs).toHaveLength(20);expect(first.runs[0].id).toBe("run-44");expect(first.currentRun).toMatchObject({id:"run-0",state:"ACTIVE"});expect(first.runPage).toMatchObject({offset:0,limit:20,total:45,nextOffset:20,hasActiveRun:true});
   const second=(await service.app.inject({url:"/api/tasks/task?runsOffset=20&runsLimit=20",headers})).json(),last=(await service.app.inject({url:"/api/tasks/task?runsOffset=40&runsLimit=20",headers})).json();
   expect(second.runs).toHaveLength(20);expect(last.runs).toHaveLength(5);expect(last.runPage.nextOffset).toBeUndefined();expect(new Set([...first.runs,...second.runs,...last.runs].map(run=>run.id)).size).toBe(45);
  }finally{spy.mockRestore();}
 }finally{await service.stop();rmSync(root,{recursive:true,force:true});}
});
it("rejects invalid page bounds before reading run history",async()=>{
 const root=mkdtempSync(join(tmpdir(),"task-run-page-bounds-")),service=new ControllerService({dataDirectory:root,ownerToken:"pages-owner",backgroundWorker:{enabled:false}}),headers={authorization:"Bearer pages-owner"};
 try{await service.start({listen:false});service.database.writeCanonicalTask("task",0,{id:"task",title:"paged",state:"BACKLOG"},"2026-10-20T00:00:00Z");
  for(const query of ["runsOffset=-1","runsLimit=0","runsLimit=101","runsOffset=1e2","runsOffset=9007199254740992","runsLimit=not-a-number"]){const response=await service.app.inject({url:`/api/tasks/task?${query}`,headers});expect(response.statusCode,query).toBe(400);expect(response.json().code).toBe("INVALID_RUN_PAGE");}
 }finally{await service.stop();rmSync(root,{recursive:true,force:true});}
});
