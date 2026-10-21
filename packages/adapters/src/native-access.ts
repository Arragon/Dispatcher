import { isDeepStrictEqual } from "node:util";
import { isIP } from "node:net";
import { assessInteractionCapability, type CapabilityEvidence, type NativeAccessDescriptor, type NativeBinding, type NativeSurface } from "@dispatcher/domain";

type Target="session"|"project"|"application";
export interface NativeAccessRegistration {
  id:string;binding:NativeBinding;surface:NativeSurface;target:Target;evidence:CapabilityEvidence;
  action:{kind:"web";url:string;redirects:"none"|"unknown";credentials:"none"|"pairing"|"unknown"}|{kind:"launch";launcherId:string};
}
export interface NativeLauncherRegistration {id:string;binding:NativeBinding;executableKey:string;args:string[];workspaceRef:string;target:Target}
/** Supplied by authorized composition, never from browser input or provider URL claims. */
export interface NativeAccessViewerContext {
  runnerHostId:string;viewerHostId?:string;scopeFingerprint:string;workspaceRef:string;executionRefId:string;
  registrations:NativeAccessRegistration[];
  policy:{webEntries:Array<{origin:string;pathname:string}>;launchers:NativeLauncherRegistration[]};
}
const surfaces:readonly NativeSurface[]=["desktop","ide","web","mobile","tui"];
const credentialName="[a-z0-9_-]*(?:password|token|secret|credential|authorization|api[-_]?key|private[-_]?key|cookie)(?:[-_](?:file|path))?";
const credentialAssignment=new RegExp(`\\b${credentialName}["']?\\s*[:=]`,"i");
const credentialFlag=new RegExp(`^--${credentialName}(?:=|$)`,"i");
const nativeAuthName="(?:codex[-_]?home|opencode[-_]?home|config[-_]?dir|auth[-_]?(?:dir(?:ectory)?|file)|native[-_]?auth[-_]?(?:dir(?:ectory)?|path)|user[-_]?data[-_]?dir|oauth[-_]?directory|acp[-_]?directory)";
const nativeAuthFlag=new RegExp(`^--${nativeAuthName}(?:=|$)`,"i");
const nativeAuthAssignment=new RegExp(`\\b${nativeAuthName}["']?\\s*[:=]`,"i");
const safeText=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)&&!credentialAssignment.test(value)&&!nativeAuthAssignment.test(value)&&!/(?:\bBearer\s|\b(?:sk|ghp|github_pat|xox[baprs])[-_][\w-]{8,}|-----BEGIN .*PRIVATE KEY)/i.test(value);
function validBinding(binding:NativeBinding):boolean {
  return binding.version===1&&binding.identityState==="bound"&&[binding.product,binding.region,binding.profileId,binding.backendId,binding.runnerId,binding.nativeStoreRef,binding.nativeSessionId,binding.executionRefId].every(value=>safeText(value))&&[binding.nativeThreadId,binding.parentSessionId].every(value=>value===undefined||safeText(value));
}
const loopback=(hostname:string)=>["localhost","127.0.0.1","[::1]"].includes(hostname.replace(/\.$/,""));
function safeWebUrl(raw:string,context:NativeAccessViewerContext):{url:string;local:boolean}|undefined {
  if(!safeText(raw,4096))return undefined;
  try {
    const url=new URL(raw);const local=loopback(url.hostname);
    if(url.username||url.password||url.search||url.hash||url.protocol!=="https:"&&!(local&&url.protocol==="http:")||!local&&isIP(url.hostname.replace(/^\[|\]$/g,"")))return undefined;
    // Exact origin/path registration avoids accepting arbitrary provider admin or redirect paths.
    if(!context.policy.webEntries.some(entry=>entry.origin===url.origin&&entry.pathname===url.pathname))return undefined;
    if(/\/(?:oauth|pairing|pair|callback|token|authorize)(?:\/|$)/i.test(decodeURIComponent(url.pathname))||!safeText(decodeURIComponent(url.pathname),4096)||!local&&/(?:\.localhost|\.local|\.internal)\.?$/i.test(url.hostname))return undefined;
    if(/%2[ef]|%5c|%25/i.test(url.pathname)||url.pathname.includes("\\"))return undefined;
    return {url:url.href,local};
  } catch {return undefined;}
}
const shellKeys=new Set(["sh","bash","zsh","fish","cmd","powershell","pwsh","node","python","python3","osascript"]);
function safeLauncher(registration:NativeAccessRegistration,context:NativeAccessViewerContext):NativeLauncherRegistration|undefined {
  if(registration.action.kind!=="launch")return undefined;
  const launcherId=registration.action.launcherId;
  const matches=context.policy.launchers.filter(item=>item.id===launcherId);const launcher=matches.length===1?matches[0]:undefined;
  if(!launcher||!safeText(launcher.id)||!safeText(launcher.executableKey)||!/^[a-z][a-z0-9-]*$/i.test(launcher.executableKey)||shellKeys.has(launcher.executableKey.toLowerCase())||!isDeepStrictEqual(launcher.binding,registration.binding)||launcher.target!==registration.target||launcher.workspaceRef!==context.workspaceRef||!safeText(launcher.workspaceRef)||launcher.args.length>64||!launcher.args.every(arg=>safeText(arg,1024)&&!credentialFlag.test(arg)&&!nativeAuthFlag.test(arg))||launcher.args.reduce((size,arg)=>size+Buffer.byteLength(arg),0)>8192)return undefined;
  return launcher;
}
export type SafeAccess=NativeAccessDescriptor;
export class NativeAccessValidationError extends Error {readonly code="NATIVE_ACCESS_REJECTED";constructor(){super("NATIVE_ACCESS_REJECTED");this.name="NativeAccessValidationError";}}
/** Independent trusted policy is required; a client descriptor cannot become a registry. */
export function validateNativeAccess(descriptor:unknown,policy:{binding:NativeBinding;context:NativeAccessViewerContext}):SafeAccess {
  try{const matched=resolveNativeAccess(policy.binding,policy.context).find(candidate=>isDeepStrictEqual(candidate,descriptor));if(matched)return structuredClone(matched);}catch{/* Never disclose the rejected URL, path, token or provider diagnostics. */}
  throw new NativeAccessValidationError();
}
/** Generates descriptions only; it never resolves credentials, follows URLs or launches a process. */
export function resolveNativeAccess(binding:NativeBinding,context:NativeAccessViewerContext):NativeAccessDescriptor[] {
  const runnerId=safeText(binding.runnerId)?binding.runnerId:"unknown-runner";
  const sessionId=safeText(binding.nativeSessionId)?binding.nativeSessionId:"unknown-session";
  const base={version:1 as const,runnerId,nativeSessionId:sessionId};
  const instruction=(id:string,surface:NativeSurface,reasonCode:string,availability:NativeAccessDescriptor["availability"]="unverified",detail="No verified exact session entry is available."):NativeAccessDescriptor=>({...base,id,surface,reasonCode,availability,action:{kind:"instructions",text:`Use the native client on Runner ${runnerId}. ${detail}`}});
  if(!validBinding(binding)||binding.executionRefId!==context.executionRefId||!safeText(context.runnerHostId)||!safeText(context.scopeFingerprint)||!safeText(context.workspaceRef))return [instruction("native-access-unavailable","tui","NATIVE_ACCESS_IDENTITY_UNAVAILABLE","unsupported")];
  const sameHost=safeText(context.viewerHostId)&&context.viewerHostId===context.runnerHostId;
  const result:NativeAccessDescriptor[]=[];const seen=new Set<string>();
  const registrations=context.registrations.slice(0,20);const reservedIds=new Set(registrations.map(entry=>entry.id));
  for(const registration of registrations) {
    if(!safeText(registration.id)||seen.has(registration.id)||!surfaces.includes(registration.surface))continue;
    seen.add(registration.id);
    const fallback=(reasonCode:string)=>instruction(registration.id,registration.surface,reasonCode);
    if(!["session","project","application"].includes(registration.target)||!isDeepStrictEqual(binding,registration.binding)||!assessInteractionCapability(registration.evidence,context.scopeFingerprint,registration.target==="session"?"ui-roundtrip-verified":"runtime-verified").supported){result.push(fallback("NATIVE_ACCESS_UNVERIFIED"));continue;}
    const reasonCode=registration.target==="session"?"NATIVE_SESSION_ENTRY_VERIFIED":registration.target==="project"?"NATIVE_PROJECT_ENTRY_ONLY":"NATIVE_APPLICATION_ENTRY_ONLY";
    let action:NativeAccessDescriptor["action"]|undefined;
    if(registration.action.kind==="web") {
      const safe=safeWebUrl(registration.action.url,context);
      if(!safe||registration.action.redirects!=="none"||registration.action.credentials!=="none"){result.push(fallback("NATIVE_ACCESS_URL_REJECTED"));continue;}
      if(safe.local&&!sameHost){result.push(fallback("NATIVE_ACCESS_RUNNER_HOST_REQUIRED"));continue;}
      action={kind:"web-url",url:safe.url};
    } else if(registration.action.kind==="launch") {
      const launcher=safeLauncher(registration,context);
      if(!launcher){result.push(fallback("NATIVE_ACCESS_LAUNCHER_REJECTED"));continue;}
      if(!sameHost){result.push(fallback("NATIVE_ACCESS_RUNNER_HOST_REQUIRED"));continue;}
      action={kind:"local-launch",launcherId:launcher.id,args:[...launcher.args]};
    }
    if(!action){result.push(fallback("NATIVE_ACCESS_UNVERIFIED"));continue;}
    result.push({...base,id:registration.id,surface:registration.surface,availability:"verified",reasonCode,action});
    if(registration.target!=="session") {
      let instructionId=`${registration.id}:instructions`;
      while(reservedIds.has(instructionId)||seen.has(instructionId))instructionId+="-";
      seen.add(instructionId);result.push(instruction(instructionId,registration.surface,reasonCode,"verified",`This opens a ${registration.target==="project"?"project entry":"native application entry"}; select the existing session there. It does not open the exact session.`));
    }
  }
  return result.length?result:[instruction("native-access-unavailable","tui","NATIVE_ACCESS_UNSUPPORTED","unsupported")];
}
