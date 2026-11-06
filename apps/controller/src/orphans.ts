import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import type {RecoveryInventory} from "@dispatcher/persistence";
import { inspectWorkspaceOrphans, WorkspacePolicyError, type WorkspaceManager } from "@dispatcher/workspace";
import type { ProcessManager,OwnedProcessSnapshot } from "@dispatcher/runner";

export async function inspectOrphans(dataDirectory:string,inventory:RecoveryInventory,processes?:ProcessManager) {
 const workspaces=await inspectWorkspaceOrphans(join(dataDirectory,"worktrees"),inventory.references);
 return {version:1 as const,dryRun:true as const,schemaVersion:inventory.schemaVersion,reconciliationRequired:inventory.reconciliationRequired,unresolvedWorkspaceReferences:inventory.unresolvedWorkspaceReferences,workspaces,processes:inventory.processes,liveProcesses:processes?.inventory().map(process=>({...process,orphan:!inventory.runIds.includes(process.runId)}))??[]};
}
function options(body:unknown):{execute?:boolean;confirmed?:boolean} {
 if(!body||typeof body!=="object"||Array.isArray(body)||Object.entries(body).some(([key,value])=>!["execute","confirmed"].includes(key)||typeof value!=="boolean"))throw new WorkspacePolicyError("ORPHAN_REQUEST_INVALID","ORPHAN_REQUEST_INVALID");return body as {execute?:boolean;confirmed?:boolean};
}
function samePath(left:string,right:string):boolean {try{return realpathSync(left)===realpathSync(right);}catch{return left===right;}}
function assertProcessOrphan(readInventory:()=>RecoveryInventory,process:OwnedProcessSnapshot):void {
 if(process.cwdState!=="verified")throw new WorkspacePolicyError("ORPHAN_PROCESS_DIRECTORY_CHANGED","ORPHAN_PROCESS_DIRECTORY_CHANGED");
 const inventory=readInventory();
 if(inventory.reconciliationRequired)throw new WorkspacePolicyError("ORPHAN_RECONCILIATION_REQUIRED","ORPHAN_RECONCILIATION_REQUIRED");
 if(inventory.runIds.includes(process.runId)||inventory.unresolvedWorkspaceReferences||inventory.references.some(ref=>samePath(ref.path,process.cwd))||inventory.processes.some(record=>record.orphan||record.runId===process.runId))throw new WorkspacePolicyError("ORPHAN_REFERENCE_PRESENT","ORPHAN_REFERENCE_PRESENT");
}
export function registerOrphanRoutes(app:FastifyInstance,dataDirectory:string,manager:WorkspaceManager,readInventory:()=>RecoveryInventory,processes?:ProcessManager):void {
 app.get("/api/maintenance/orphans",()=>inspectOrphans(dataDirectory,readInventory(),processes));
 app.post<{Params:{processId:string}}>("/api/maintenance/processes/:processId/stop",async(request,reply)=>{
  try{
   const parsed=options(request.body??{}),process=processes?.inventory().find(item=>item.id===request.params.processId);
   if(!process||process.ownership!=="owned-live"||process.state!=="running")return reply.code(409).send({code:"ORPHAN_LIVE_OWNER_REQUIRED"});
   const assertCurrent=()=>assertProcessOrphan(readInventory,process);assertCurrent();
   if(!parsed.execute)return {version:1,applied:false,process:{...process,orphan:true}};
   if(!parsed.confirmed)return reply.code(409).send({code:"ORPHAN_CONFIRMATION_REQUIRED"});
   const result=await processes!.stopOwned(process.id,assertCurrent);return reply.code(result.stopped?200:202).send({version:1,applied:true,result,...(!result.stopped?{code:"ORPHAN_PROCESS_STOP_UNCONFIRMED"}:{})});
  }catch(error){if(error instanceof WorkspacePolicyError||error instanceof Error&&["ORPHAN_LIVE_OWNER_REQUIRED","ORPHAN_PROCESS_DIRECTORY_CHANGED"].includes(error.message))return reply.code(error.message==="ORPHAN_REQUEST_INVALID"?400:409).send({code:error.message});throw error;}
 });
 app.post<{Params:{runId:string};Body:{execute?:boolean;confirmed?:boolean}}>("/api/maintenance/workspaces/:runId/cleanup",async(request,reply)=>{
  let parsed:{execute?:boolean;confirmed?:boolean};try{parsed=options(request.body??{});}catch{return reply.code(400).send({code:"ORPHAN_REQUEST_INVALID"});}
  const workspace=manager.getForRun(request.params.runId);
  if(!workspace)return reply.code(409).send({code:"ORPHAN_LIVE_OWNER_REQUIRED"});
  const assertCurrent=()=>{
   const inventory=readInventory();
   if(inventory.reconciliationRequired)throw new WorkspacePolicyError("ORPHAN_RECONCILIATION_REQUIRED","ORPHAN_RECONCILIATION_REQUIRED");
   if(processes?.inventory().some(process=>process.cwdState!=="verified"||process.runId===workspace.runId||samePath(process.cwd,workspace.path)))throw new WorkspacePolicyError("ORPHAN_PROCESS_PRESENT","ORPHAN_PROCESS_PRESENT");
   const path=realpathSync(workspace.path),referenced=inventory.references.some(ref=>{try{return realpathSync(ref.path)===path;}catch{return ref.path===workspace.path;}});
   if(inventory.runIds.includes(workspace.runId)||inventory.unresolvedWorkspaceReferences||referenced||inventory.processes.some(record=>record.orphan||record.runId===workspace.runId))throw new WorkspacePolicyError("ORPHAN_REFERENCE_PRESENT","ORPHAN_REFERENCE_PRESENT");
  };
  try{
   assertCurrent();const plan=await manager.cleanupPlan(workspace);
   if(!parsed.execute)return {version:1,applied:false,plan};
   if(parsed.confirmed!==true)return reply.code(409).send({code:"ORPHAN_CONFIRMATION_REQUIRED"});
   const result=await manager.cleanup(plan,assertCurrent);return {version:1,applied:true,result};
  }catch(error){if(error instanceof WorkspacePolicyError)return reply.code(409).send({code:error.code});throw error;}
 });
}
