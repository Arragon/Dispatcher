import type {NativeSurface,NativeBinding,SessionControl,NativeObservation,CapabilityEvidence,MutationFence} from "./session-interaction.js";
export interface RunNativeSessionView {
 version:1;mutationAvailable:false;runId:string;sessionId:string;profileId:string;generation:number;attempt:number;
 identity:"legacy"|"unbound"|"bound"|"deleted"|"unreachable"|"conflict";
 binding:Pick<NativeBinding,"product"|"region"|"profileId"|"backendId"|"runnerId"|"nativeSessionId"|"nativeThreadId">|null;
 control:Pick<SessionControl,"state"|"epoch"|"revision"|"exclusion">|null;
 execution:{kind:"managed-worktree"|"provider-self-hosted"|"provider-cloud"|"legacy";runnerId?:string;worktree?:string;branch?:string;environmentRef?:string};
 state:NativeObservation["state"];freshness:"fresh"|"stale"|"unknown";observedAt:string|null;completeness:"unknown";
 requestedModel?:{id:string;reasoning?:string};reportedModel?:{id:string};
 capabilities:Array<{name:string;support:"supported"|"unsupported"|"unknown";level?:CapabilityEvidence["level"]}>;
 access:Array<{surface:NativeSurface;availability:"unverified"|"unsupported"}>;
}

/** Stored readonly control snapshot; it never authorizes a native mutation. */
export interface NativeControlView {
 version:1;runId:string;profileId:string;generation:number;attempt:number;
 control:SessionControl|null;fence:Omit<MutationFence,"commandId">|null;mutationAvailable:false;
 reasonCode:"NATIVE_CONTROL_COORDINATOR_UNAVAILABLE"|"NATIVE_CONTROL_UNAVAILABLE";
}
