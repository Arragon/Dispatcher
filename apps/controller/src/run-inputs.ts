import {createHash} from "node:crypto";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
export interface RunInputIdentity {inputId:string;actorId:string;runId:string;profileId:string;sessionId:string;generation:number;authorityHash:string;payloadHash:string}
export interface RunInputReceipt extends RunInputIdentity {state:"RESERVED"|"ACCEPTED"|"REJECTED"|"OUTCOME_UNKNOWN";acceptedAt:string;updatedAt:string}
export class InputReceiptError extends Error {constructor(readonly code:string,message:string){super(message);this.name="InputReceiptError";}}
/** A reservation survives a lost acknowledgement; only this process can confirm it. */
export class RunInputReceipts {
 private readonly owned=new Set<string>();
 constructor(private readonly db:DispatcherDatabase,private readonly now:()=>Date=()=>new Date()){}
 release(input:RunInputIdentity):void{this.owned.delete(this.key(input));}
 private key(input:Pick<RunInputIdentity,"actorId"|"inputId">):string{return createHash("sha256").update(JSON.stringify([input.actorId,input.inputId])).digest("hex");}
 read(input:RunInputIdentity):RunInputReceipt|undefined{
  const key=this.key(input),stored=this.db.getEntity<JsonValue>("run-input",key) as unknown as RunInputReceipt|undefined;if(!stored)return;
  if(["runId","profileId","sessionId","generation","payloadHash"].some(field=>stored[field as keyof RunInputIdentity]!==input[field as keyof RunInputIdentity]))throw new InputReceiptError("INPUT_IDEMPOTENCY_CONFLICT","This input ID already belongs to a different message or authority");
  if(stored.state==="RESERVED"&&!this.owned.has(key))return this.finish(input,"OUTCOME_UNKNOWN");return structuredClone(stored);
 }
 find(actorId:string,inputId:string,runId:string):RunInputReceipt|undefined{
  const stored=this.db.getEntity<JsonValue>("run-input",this.key({actorId,inputId})) as unknown as RunInputReceipt|undefined;
  if(stored?.runId!==runId)return;return this.read(stored);
 }
 assertAvailable(input:Pick<RunInputIdentity,"runId"|"sessionId"|"generation"|"authorityHash">):void{
  const uncertain=this.db.listEntities<JsonValue>("run-input").map(value=>value as unknown as RunInputReceipt).find(receipt=>receipt.runId===input.runId&&receipt.sessionId===input.sessionId&&receipt.generation===input.generation&&receipt.authorityHash===input.authorityHash&&["RESERVED","OUTCOME_UNKNOWN"].includes(receipt.state));
  if(uncertain)throw new InputReceiptError("INPUT_OUTCOME_UNKNOWN","A previous input for this waiting episode is unconfirmed; inspect the native session");
 }
 reserve(input:RunInputIdentity):RunInputReceipt{
  return this.db.transaction(()=>{if(this.read(input))throw new InputReceiptError("INPUT_PENDING","This input was already reserved");const at=this.now().toISOString(),record:RunInputReceipt={...input,state:"RESERVED",acceptedAt:at,updatedAt:at};this.db.saveEntity("run-input",this.key(input),record as unknown as JsonValue,at);this.owned.add(this.key(input));return record;});
 }
 finish(input:RunInputIdentity,state:Exclude<RunInputReceipt["state"],"RESERVED">):RunInputReceipt{
  const key=this.key(input),stored=this.db.getEntity<JsonValue>("run-input",key) as unknown as RunInputReceipt|undefined;
  if(!stored)throw new InputReceiptError("INPUT_NOT_FOUND","Input reservation is unavailable");
  if(["runId","profileId","sessionId","generation","payloadHash"].some(field=>stored[field as keyof RunInputIdentity]!==input[field as keyof RunInputIdentity]))throw new InputReceiptError("INPUT_IDEMPOTENCY_CONFLICT","Input reservation identity changed");
  if(stored.state==="ACCEPTED")return structuredClone(stored);
  const record={...stored,state,updatedAt:this.now().toISOString()};this.db.saveEntity("run-input",key,record as unknown as JsonValue,record.updatedAt);this.owned.delete(key);return record;
 }
}
