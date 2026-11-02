import {expect,it} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {RunInputReceipts} from "../src/run-inputs.js";
const input={inputId:"input-1234",actorId:"owner",runId:"r",profileId:"p",sessionId:"s",generation:1,authorityHash:"waiting-episode",payloadHash:"message-and-authority"};
it("reserves before send, rejects changed payloads and replays confirmed input across restart",()=>{
 const db=new DispatcherDatabase(":memory:"),receipts=new RunInputReceipts(db);expect(receipts.read(input)).toBeUndefined();receipts.reserve(input);expect(receipts.read(input)).toMatchObject({state:"RESERVED"});
 expect(()=>receipts.read({...input,payloadHash:"changed"})).toThrow(expect.objectContaining({code:"INPUT_IDEMPOTENCY_CONFLICT"}));
 receipts.finish(input,"ACCEPTED");expect(new RunInputReceipts(db).read(input)).toMatchObject({state:"ACCEPTED"});expect(JSON.stringify(db.listEntities("run-input"))).not.toContain(input.payloadHash+"raw");db.close();
});
it("never resends an unconfirmed reservation after restart and isolates actors and runs",()=>{
 const db=new DispatcherDatabase(":memory:"),receipts=new RunInputReceipts(db);receipts.reserve(input);expect(new RunInputReceipts(db).read(input)).toMatchObject({state:"OUTCOME_UNKNOWN"});
 expect(receipts.read({...input,actorId:"different"})).toBeUndefined();expect(()=>receipts.read({...input,runId:"other"})).toThrow(expect.objectContaining({code:"INPUT_IDEMPOTENCY_CONFLICT"}));db.close();
});
it("blocks a new input ID or actor from resending the same uncertain waiting episode",()=>{
 const db=new DispatcherDatabase(":memory:"),receipts=new RunInputReceipts(db);receipts.reserve(input);receipts.finish(input,"OUTCOME_UNKNOWN");expect(()=>receipts.assertAvailable(input)).toThrow(expect.objectContaining({code:"INPUT_OUTCOME_UNKNOWN"}));expect(()=>receipts.assertAvailable({...input,authorityHash:"new-episode"})).not.toThrow();db.close();
});
it("allows only its process-owned reserved identity through the same waiting episode",()=>{
 const db=new DispatcherDatabase(":memory:"),receipts=new RunInputReceipts(db);try{receipts.reserve(input);expect(()=>receipts.assertAvailable(input,input)).not.toThrow();expect(()=>new RunInputReceipts(db).assertAvailable(input,input)).toThrow(expect.objectContaining({code:"INPUT_OUTCOME_UNKNOWN"}));expect(()=>receipts.assertAvailable(input,input)).toThrow(expect.objectContaining({code:"INPUT_OUTCOME_UNKNOWN"}));}finally{db.close();}
});

it("atomically rejects a competing reservation after another sender passed its earlier availability check",()=>{
 const db=new DispatcherDatabase(":memory:"),owner=new RunInputReceipts(db),external=new RunInputReceipts(db);try{
  const competing={...input,actorId:"service-client",inputId:"external-input"};owner.assertAvailable(input);external.reserve(competing);
  expect(()=>owner.reserve(input)).toThrow(expect.objectContaining({code:"INPUT_OUTCOME_UNKNOWN"}));expect(db.listEntities("run-input")).toHaveLength(1);
  external.finish(competing,"REJECTED");expect(()=>owner.reserve(input)).not.toThrow();expect(()=>owner.assertAvailable(input,input)).not.toThrow();
 }finally{db.close();}
});
