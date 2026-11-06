import {expect,it} from "vitest";
import {createEnvelope,parseEnvelope} from "../src/index.js";
const envelope=(payload:unknown,extra={})=>createEnvelope({kind:"command",runnerId:"remote",traceId:"quota",sequence:1,messageId:"quota",payload:payload as never,...extra});
it("admits only profile-scoped account reads with no fabricated Run authority",()=>{
 for(const action of ["read","refresh"])expect(parseEnvelope(envelope({type:"native.account_quota",profileId:"p",action})).payload).toEqual({type:"native.account_quota",profileId:"p",action});
 for(const payload of [{type:"native.account_quota",profileId:"p",action:"start"},{type:"native.account_quota",profileId:"p",action:"read",runId:"run"},{type:"native.account_quota",profileId:"p",action:"read",codexHome:"/private"}])expect(()=>parseEnvelope(envelope(payload))).toThrow();
 expect(()=>parseEnvelope(envelope({type:"native.account_quota",profileId:"p",action:"refresh"},{leaseId:"lease",generation:1}))).toThrow();
});
