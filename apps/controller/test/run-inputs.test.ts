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
