export interface LocalReviewAuthority {taskRevision:number;generation:number;leaseId:string;controlEpoch:number;controlRevision:number}
export interface LocalVerificationRequest extends LocalReviewAuthority {candidateId:string;idempotencyKey:string;confirmed:boolean}
export interface LocalAcceptanceRequest extends LocalVerificationRequest {verificationId:string}
export interface LocalAcceptance {version:1;taskId:string;runId:string;generation:number;candidateId:string;verificationId:string;snapshotCommit:string;actor:string;acceptedAt:string}
export interface LocalResultReview {
 version:1;runId:string;taskId:string;sessionId:string;state:"unverified"|"verified"|"changed"|"failed"|"running"|"unknown"|"accepted"|"unavailable";
 reasonCode?:string;authority?:LocalReviewAuthority;candidate?:{id:string;headRevision:string;files:string[];worktree:string};
 verification?:{id:string;verifiedAt:string;commandIds:string[];basis:"matching-managed-source";snapshotCommit:string};acceptance?:LocalAcceptance;
}
