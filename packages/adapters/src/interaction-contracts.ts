import { assessInteractionCapability, type AttachEvidence, type AttachRequest, type HistoryPage, type HistoryRequest, type InteractionCapabilities, type InterruptRequest, type NativeAccessDescriptor, type NativeBinding, type NativeCommandReceipt, type NativeObservation, type NativeResponse, type ReleaseEvidence, type ReleaseRequest, type MutationFence, type NativeProcessState } from "@dispatcher/domain";
import { AdapterContractError, type AdapterManifest } from "./contracts.js";
import type { NativeRequestHandle } from "./native-requests.js";
import type { CapabilityEvidence, NativeQuiescenceRuntime } from "@dispatcher/domain";


export interface NativeReadRequest {requestId:string;observerEpoch:string;sequence:number;signal:AbortSignal}

/** Local transport cleanup is never proof of native tool or writer release. */
export interface LocalRuntimeDisconnect {
  version:1;connection:"closed"|"unknown";ownedRoot:"exited"|"not-created"|"unknown";
  /** Unknown callbacks may still be using their caller's persistence resources. */
  callbacks:"drained"|"unknown";
  backgroundTools:"unknown";nativeSessionDeleted:false;ownedRootPid?:number;
}

/** This handle exposes only observation; execution result/input are separate capabilities. */
export interface NativeReadHandle {
  readonly binding:NativeBinding;
  readonly scopeFingerprint:string;
  processState?():NativeProcessState;
  inspect(request:NativeReadRequest):Promise<NativeObservation>;
}

export interface NativeInteractionPort {
  capabilities():InteractionCapabilities;
  readHandle?(ref:NativeBinding):NativeReadHandle;
  inspect?(ref:NativeBinding,request?:NativeReadRequest):Promise<NativeObservation>;
  history?(ref:NativeBinding,request:HistoryRequest,read?:NativeReadRequest):Promise<HistoryPage>;
  access?(ref:NativeBinding):Promise<NativeAccessDescriptor[]>;
  interrupt?(ref:NativeBinding,request:InterruptRequest):Promise<NativeCommandReceipt>;
  interruptWithoutResume?:CapabilityEvidence;
  inspectQuiescence?(ref:NativeBinding,request:{requestId:string;signal:AbortSignal}):Promise<{observation:NativeObservation;runtime:NativeQuiescenceRuntime}>;
  release?(ref:NativeBinding,request:ReleaseRequest):Promise<ReleaseEvidence>;
  attach?(ref:NativeBinding,request:AttachRequest):Promise<AttachEvidence>;
  /** Invoke the captured synchronous guard after preparation, immediately before native input. */
  respond?(ref:NativeBinding,request:NativeResponse,beforeSend?:()=>void):Promise<NativeCommandReceipt>;
  requestHandle?(ref:NativeBinding):NativeRequestHandle;
  continueTurn?(ref:NativeBinding,request:{commandId:string;fence:MutationFence;message:string},beforeSend?:()=>void):Promise<NativeCommandReceipt>;
  steer?(ref:NativeBinding,request:{commandId:string;fence:MutationFence;activeTurnId:string;message:string},beforeSend?:()=>void):Promise<NativeCommandReceipt>;
}
type CapabilityName=Exclude<keyof InteractionCapabilities,"version"|"surfaces">;
const methods:Record<CapabilityName,keyof NativeInteractionPort>={durableIdentity:"inspect",historyRead:"history",sameSessionContinue:"continueTurn",liveSteer:"steer",interruptTurn:"interrupt",nativeApproval:"requestHandle",observeExternalChanges:"inspect",releaseControl:"release",reclaimControl:"attach",restartReattach:"attach"};
export function getInteractionPort(adapter:{manifest:AdapterManifest;interaction?:NativeInteractionPort}):NativeInteractionPort|undefined {
  const port=adapter.interaction;if(!port)return undefined;
  if(typeof port.capabilities!=="function")throw new AdapterContractError("INVALID_INTERACTION_CONTRACT","Interaction port must declare versioned capabilities");
  const capabilities=port.capabilities();
  if(capabilities.version!==1)throw new AdapterContractError("INVALID_INTERACTION_CONTRACT","Interaction port version is unsupported");
  for(const [capability,method] of Object.entries(methods) as Array<[CapabilityName,keyof NativeInteractionPort]>) {
    if(!capabilities[capability]||capabilities[capability].version!==1||capabilities[capability].support==="supported"&&typeof port[method]!=="function")throw new AdapterContractError("INVALID_INTERACTION_CONTRACT",`${capability} requires a versioned declaration and ${method} method`);
  }
  if(Object.values(capabilities.surfaces).some(evidence=>evidence?.support==="supported")&&typeof port.access!=="function")throw new AdapterContractError("INVALID_INTERACTION_CONTRACT","Supported surface requires an access method");
  return port;
}
export function requireInteractionCapability(port:NativeInteractionPort,capability:CapabilityName,scopeFingerprint:string):void {
  const assessment=assessInteractionCapability(port.capabilities()[capability],scopeFingerprint,"runtime-verified");
  if(!assessment.supported)throw new AdapterContractError(assessment.code!,"This native capability is unavailable for the current scope");
  if(typeof port[methods[capability]]!=="function")throw new AdapterContractError("INVALID_INTERACTION_CONTRACT","Native capability method is missing");
}
