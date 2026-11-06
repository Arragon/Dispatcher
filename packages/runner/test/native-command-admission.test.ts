import {expect,it,vi} from 'vitest';
import type {InteractionCapabilities,MutationFence,NativeBinding,NativeCommandReceipt} from '@dispatcher/domain';
import type {NativePendingRequest} from '@dispatcher/adapters';
import {dispatchInteraction,type NativeDispatchCommand,type NativeDispatchSource} from '../src/interaction-dispatch.js';

const binding:NativeBinding={version:1,product:'opencode',region:'global',profileId:'p',backendId:'opencode-server-v2',runnerId:'local',nativeStoreRef:'store',nativeSessionId:'ses_exact',executionRefId:'exec',identityState:'bound'};
const fence:MutationFence={runId:'run',sessionId:'session',commandId:'command',generation:1,leaseId:'lease',expectedCurrentRunId:'run',expectedTaskRevision:1,expectedControlRevision:1,expectedControlEpoch:1};
const evidence={version:1 as const,support:'supported' as const,level:'runtime-verified' as const,scopeFingerprint:'scope',evidenceRef:'fixture',verifiedAt:'2026-10-11T00:00:00Z'};
function fixture(kind:'continue'|'steer'|'approval'){
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),effects:string[]=[];let allowed=true,lastGuard:(()=>void)|undefined;
 const request:NativePendingRequest={version:1,requestId:'request',revision:'revision',connectionId:'connection',connectionEpoch:1,type:'permission',tool:{name:'write',scope:['execution:exec'],risk:'high'},options:[{id:'once',kind:'allow-once'}],expiresAt:'2100-01-01T00:00:00Z'};
 const method=vi.fn(async(_binding:NativeBinding,input:{commandId:string},beforeSend?:()=>void):Promise<NativeCommandReceipt>=>{lastGuard=beforeSend;entered.resolve();await release.promise;beforeSend?.();effects.push(kind);return {version:1,commandId:input.commandId,state:'accepted',...(kind==='approval'?{nativeRequestId:'request'}:{nativeMessageId:'msg_exact'})};});
 const handle={binding,scopeFingerprint:'scope',connectionId:'connection',connectionEpoch:1,isConnected:()=>true,inspectPending:async(_id:string,input:{requestId:string})=>({version:1 as const,requestId:input.requestId,connectionId:'connection',connectionEpoch:1,state:'pending' as const,request}),respond:method};
 const source:NativeDispatchSource={binding,scopeFingerprint:'scope',port:{capabilities:()=>({version:1,sameSessionContinue:evidence,liveSteer:evidence,nativeApproval:evidence}) as InteractionCapabilities,continueTurn:method,steer:method},...(kind==='approval'?{nativeRequest:{handle,request,now:()=>new Date('2026-10-11T00:00:00Z')}}:{})};
 const command:NativeDispatchCommand=kind==='continue'?{type:'continue',commandId:'command',message:'next'}:kind==='steer'?{type:'steer',commandId:'command',message:'next',activeTurnId:'turn'}:{type:'approval',commandId:'command',requestId:'request',requestType:'permission',expectedRevision:'revision',response:{kind:'allow',optionId:'once'}};
 const assertCurrent=()=>{if(!allowed)throw Object.assign(Error('stale authority'),{code:'STALE_CONTROL_EPOCH'});};
 return {entered,release,effects,source,command,method,assertCurrent,revoke:()=>{allowed=false;},guard:()=>lastGuard};
}
it.each(['continue','steer','approval'] as const)('rechecks %s authority at the provider final send after preparation',async kind=>{
 const f=fixture(kind),pending=dispatchInteraction(f.command,fence,f.source,f.assertCurrent);await f.entered.promise;f.revoke();f.release.resolve();expect(await pending).toMatchObject({state:'rejected',code:'STALE_CONTROL_EPOCH'});expect(f.effects).toEqual([]);expect(f.method).toHaveBeenCalledTimes(1);
});
it.each(['continue','steer','approval'] as const)('closes %s admission after a command timeout',async kind=>{
 vi.useFakeTimers();const f=fixture(kind);try{const pending=dispatchInteraction(f.command,fence,f.source,f.assertCurrent,10);await f.entered.promise;await vi.advanceTimersByTimeAsync(11);expect(await pending).toMatchObject({state:'unknown',code:'NATIVE_COMMAND_TIMEOUT'});f.release.resolve();await vi.advanceTimersByTimeAsync(1);expect(f.effects).toEqual([]);expect(f.guard()).toBeTypeOf('function');expect(()=>f.guard()!()).toThrow('NATIVE_COMMAND_OUTCOME_UNKNOWN');}finally{f.release.resolve();vi.useRealTimers();}
});
it('closes the captured final guard once a command has completed',async()=>{
 const f=fixture('continue'),pending=dispatchInteraction(f.command,fence,f.source,f.assertCurrent);await f.entered.promise;f.release.resolve();expect(await pending).toMatchObject({state:'accepted'});expect(f.effects).toEqual(['continue']);expect(()=>f.guard()!()).toThrow('NATIVE_COMMAND_OUTCOME_UNKNOWN');
});
it('rejects async authority checks before invoking a provider',async()=>{
 const f=fixture('continue');expect(await dispatchInteraction(f.command,fence,f.source,async()=>{})).toMatchObject({state:'rejected',code:'NATIVE_CAPABILITY_UNVERIFIED'});expect(f.method).not.toHaveBeenCalled();expect(f.effects).toEqual([]);
});
it('checks the original provider capability when caller replaces the source during preparation',async()=>{
 const f=fixture('continue');let support:'supported'|'unknown'='supported';const original=f.source.port;original.capabilities=()=>({version:1,sameSessionContinue:{...evidence,support}}) as InteractionCapabilities;const pending=dispatchInteraction(f.command,fence,f.source,f.assertCurrent);await f.entered.promise;support='unknown';f.source.port={...original,capabilities:()=>({version:1,sameSessionContinue:evidence}) as InteractionCapabilities};f.release.resolve();expect(await pending).toMatchObject({state:'rejected',code:'NATIVE_CAPABILITY_UNVERIFIED'});expect(f.effects).toEqual([]);
});
it('captures original approval methods and metadata before its pending inspection awaits',async()=>{
 const f=fixture('approval'),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),pending=f.source.nativeRequest!,originalInspect=pending.handle.inspectPending,replacement=vi.fn(async():Promise<NativeCommandReceipt>=>({version:1,commandId:'command',state:'accepted',nativeRequestId:'request'}));pending.handle.inspectPending=async(id,input)=>{entered.resolve();await release.promise;return originalInspect(id,input);};const result=dispatchInteraction(f.command,fence,f.source,f.assertCurrent);await entered.promise;pending.handle.respond=replacement;pending.handle={...pending.handle,connectionId:'replacement',connectionEpoch:2};pending.request={...pending.request,connectionId:'replacement',connectionEpoch:2};release.resolve();f.release.resolve();expect(await result).toMatchObject({state:'accepted',nativeRequestId:'request'});expect(replacement).not.toHaveBeenCalled();expect(f.method).toHaveBeenCalledTimes(1);expect(f.method.mock.calls[0]![1]).toMatchObject({connectionId:'connection',connectionEpoch:1});expect(f.effects).toEqual(['approval']);
});
it('enforces the actual send deadline even before an overdue timer runs',async()=>{
 const f=fixture('continue');f.method.mockImplementation(async(_binding,input,beforeSend)=>{await Promise.resolve();const until=performance.now()+30;while(performance.now()<until){/* Simulate synchronous provider preparation delaying timer delivery. */}beforeSend?.();f.effects.push('continue');return {version:1,commandId:input.commandId,state:'accepted'};});expect(await dispatchInteraction(f.command,fence,f.source,f.assertCurrent,10)).toMatchObject({state:'rejected',code:'NATIVE_COMMAND_TIMEOUT'});expect(f.effects).toEqual([]);
});
it('rechecks the deadline after a slow synchronous final authority check',async()=>{
 const f=fixture('continue');f.method.mockImplementation(async(_binding,input,beforeSend)=>{await Promise.resolve();beforeSend?.();f.effects.push('continue');return {version:1,commandId:input.commandId,state:'accepted'};});let checks=0;const assertCurrent=()=>{if(++checks===3){const until=performance.now()+30;while(performance.now()<until){/* SQLite or local scope checks may cross the send deadline. */}}};expect(await dispatchInteraction(f.command,fence,f.source,assertCurrent,10)).toMatchObject({state:'rejected',code:'NATIVE_COMMAND_TIMEOUT'});expect(f.effects).toEqual([]);
});
