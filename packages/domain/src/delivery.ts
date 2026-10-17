export interface LocalCommitResult {version:1;runId:string;generation:number;commit:string;branch:string;files:string[];created:boolean;completedAt:string}

export interface GitDeliveryTarget {version:1;host:string;repository:string;remoteFingerprint:string}
export interface GitPushResult {version:1;runId:string;generation:number;commit:string;branch:string;target:GitDeliveryTarget;pushedAt:string}

export interface ScmDeliverySelection {version:1;scmConnectorId:string;repository:string;baseBranch:string;target:GitDeliveryTarget;contextFingerprint:string;configRevision:number;reviewedAt:string}

export function isGitDeliveryTarget(value:unknown):value is GitDeliveryTarget{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;const v=value as Record<string,unknown>;
 return Object.keys(v).length===4&&["version","host","repository","remoteFingerprint"].every(key=>key in v)&&v.version===1&&typeof v.host==="string"&&v.host.length<=253&&v.host.split(".").every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&typeof v.repository==="string"&&/^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/.test(v.repository)&&typeof v.remoteFingerprint==="string"&&/^[a-f0-9]{64}$/.test(v.remoteFingerprint);
}
