import {expect,it} from "vitest";
import {createEnvelope,parseEnvelope} from "../src/index.js";
const pricingSnapshot={version:1,id:"price",source:"native/account-model",collectedAt:"2026-10-22T12:00:00Z",unit:"credits",rates:{per:"1000",input:"0.1",includesMultiplier:true}};
const selection={version:1,mode:"manual",source:"explicit",profileId:"p",runnerId:"remote",providerId:"codex",backendId:"codex-exec-json",selectionType:"explicit-model",requestedModel:"model",nativeParameters:{},catalogRevision:"catalog",contextFingerprint:"scope",configRevision:1,selectedAt:"2026-10-22T12:00:00Z",pricingSnapshot};
const base=createEnvelope({kind:"command",runnerId:"remote",traceId:"t",messageId:"m",sequence:1,leaseId:"lease",generation:1,leaseExpiresAt:"2026-10-22T12:01:00Z",payload:{type:"runner.health"}});
const envelope=(value:unknown)=>({...base,payload:{type:"run.start",runId:"run",execution:{version:1,profileId:"p",workspaceId:"run",prompt:"work",selection:value}}});
it("preserves exact frozen native price metadata on the bounded execution descriptor",()=>{
 expect(parseEnvelope(envelope(selection)).payload).toMatchObject({execution:{selection:{pricingSnapshot}}});
});
it("rejects private, numeric and unbound default/legacy pricing in transport",()=>{
 for(const value of [{...selection,pricingSnapshot:{...pricingSnapshot,privatePayload:"private"}},{...selection,pricingSnapshot:{...pricingSnapshot,rates:{...pricingSnapshot.rates,input:0.1}}},{...selection,selectionType:"native-default",requestedModel:undefined,nativeParameters:{}},{...selection,mode:"legacy",source:"legacy-config"}])expect(()=>parseEnvelope(envelope(value))).toThrow();
});
