export interface LocalCommitResult {version:1;runId:string;generation:number;commit:string;branch:string;files:string[];created:boolean;completedAt:string}

export interface GitDeliveryTarget {version:1;host:string;repository:string;remoteFingerprint:string}
export interface GitPushResult {version:1;runId:string;generation:number;commit:string;branch:string;target:GitDeliveryTarget;pushedAt:string}
