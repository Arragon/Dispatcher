import type {ExecutionSelection} from "./publication.js";

/** Parameters submitted at an owning backend boundary, not provider execution proof. */
export interface NativeModelInvocation {
  version:1;id:string;sessionId:string;runId:string;profileId:string;backendId:string;
  kind:"start"|"input";invokedAt:string;nativeSessionId?:string;
  execution?:{generation:number;attempt:number;leaseId?:string};
  executionSelection?:ExecutionSelection;
  model:{id:string|null;options:Record<string,string|number|boolean>};
}

/** A concrete owning process producer observed the exact invocation's process group empty. */
export interface NativeTurnCompletion {
  version:1;invocationId:string;sessionId:string;runId:string;profileId:string;backendId:string;
  providerSessionId:string;producer:"owned-process-group";outcome:"completed"|"failed"|"cancelled"|"waiting";completedAt:string;
  execution:{generation:number;attempt:number;leaseId:string};
}
