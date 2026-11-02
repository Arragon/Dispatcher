import {expect,it} from "vitest";
import type {NativeModelInvocation,PricingSnapshotV1} from "@dispatcher/domain";
import {DispatcherDatabase,ModelInvocationStore} from "../src/index.js";
const at="2026-10-24T13:00:00.000Z",price:PricingSnapshotV1={version:1,id:"native-price",source:"native/account-model",collectedAt:at,unit:"credits",rates:{per:"1000",input:"0.1",output:"2",includesMultiplier:true}};
const record:NativeModelInvocation={version:1,id:"priced-turn",sessionId:"session",runId:"run",profileId:"p",backendId:"codex-exec-json",kind:"start",invokedAt:at,execution:{generation:1,attempt:1,leaseId:"lease"},model:{id:"m",options:{reasoningEffort:"high"}},executionSelection:{version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",requestedModel:"m",nativeParameters:{reasoningEffort:"high"},profileId:"p",runnerId:"local",providerId:"codex",backendId:"codex-exec-json",contextFingerprint:"scope",configRevision:1,selectedAt:at,pricingSnapshot:price}};
it("preserves the admitted price in the exact immutable legacy invocation selection",()=>{
 const db=new DispatcherDatabase(":memory:");try{const store=new ModelInvocationStore(db);store.append(record);expect(store.get(record.id)).toEqual(record);expect(store.get(record.id)?.executionSelection?.pricingSnapshot).toEqual(price);}finally{db.close();}
});
it("rejects private pricing fields and invalid native decimal evidence",()=>{
 const db=new DispatcherDatabase(":memory:");try{const store=new ModelInvocationStore(db);for(const patch of [{...price,ownerToken:"private-price-canary"},{...price,rates:{...price.rates!,input:0.1}}])expect(()=>store.append({...record,executionSelection:{...record.executionSelection!,pricingSnapshot:patch as unknown as PricingSnapshotV1}})).toThrow("MODEL_INVOCATION_INVALID");expect(store.get(record.id)).toBeUndefined();}finally{db.close();}
});
