import { containsSecretLike } from "@dispatcher/observability";
import { ConfigPlanError, validateConfig, type DispatcherConfig, type ConfigPlan } from "@dispatcher/config";

export interface ConfigEdit {op:"add"|"replace"|"remove";path:string;value?:unknown;entityId?:string}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const own=(value:object,key:string)=>Object.hasOwn(value,key);
const pointer=(key:string)=>key.replaceAll("~","~0").replaceAll("/","~1");
const privateKey=(key:string)=>/^(?:codexHome|configDir|home|executable|password|token|apiKey|accessToken|refreshToken|secret|environment|env)$/i.test(key);
function fail(code:string,message:string):never {throw new ConfigPlanError(code,message);}
/** Private values are omitted, never replaced with strings that could be saved back. */
function consoleValue(input:unknown):{value:unknown;protectedPaths:string[]}{
  const protectedPaths:string[]=[];
  const visit=(value:unknown,path:string):unknown=>{
    if(Array.isArray(value))return value.map((entry,index)=>visit(entry,`${path}/${index}`));
    if(!object(value))return value;
    const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;for(const [key,entry] of Object.entries(value)){const location=`${path}/${pointer(key)}`;if(privateKey(key)||key!=="credentialRef"&&(containsSecretLike({[key]:"config-value"})||typeof entry==="string"&&containsSecretLike(entry)||Array.isArray(entry)&&entry.some(item=>typeof item==="string"&&containsSecretLike(item)))){protectedPaths.push(location);continue;}result[key]=visit(entry,location);}return result;
  };
  return {value:visit(input,""),protectedPaths};
}
export function consoleConfig(config:DispatcherConfig):{config:DispatcherConfig;protectedPaths:string[]}{const result=consoleValue(config);return {config:result.value as DispatcherConfig,protectedPaths:result.protectedPaths};}
export function consoleConfigPlan(plan:ConfigPlan):ConfigPlan{return {...plan,changes:plan.changes.map(change=>({...change,before:consoleValue(change.before).value as typeof change.before,after:consoleValue(change.after).value as typeof change.after}))};}
function segments(path:string):string[]{
  if(!path.startsWith("/")||path.length>2000||/~(?![01])/u.test(path))return fail("CONFIG_EDIT_PATH","Config edits require a strict JSON Pointer");
  const parts=path.slice(1).split("/").map(part=>part.replaceAll("~1","/").replaceAll("~0","~"));
  if(parts.some(part=>!part||["__proto__","prototype","constructor"].includes(part)))return fail("CONFIG_EDIT_PATH","Config edit path is not allowed");return parts;
}
function index(key:string,length:number,adding=false):number{
  const value=key==="-"&&adding?length:/^(?:0|[1-9]\d*)$/u.test(key)?Number(key):NaN;
  if(!Number.isSafeInteger(value)||value<0||value>length||!adding&&value===length)return fail("CONFIG_EDIT_PATH","Array edit index is invalid");return value;
}
export function applyConfigEdits(config:DispatcherConfig,edits:unknown):DispatcherConfig{
  if(!Array.isArray(edits)||edits.length>500)return fail("CONFIG_EDITS_REQUIRED","Provide at most 500 precise config edits");
  const next=structuredClone(config) as unknown as Record<string,unknown>;
  for(const candidate of edits){
    if(!object(candidate)||!Object.keys(candidate).every(key=>["op","path","value","entityId"].includes(key))||!["add","replace","remove"].includes(String(candidate.op))||typeof candidate.path!=="string"||candidate.entityId!==undefined&&(typeof candidate.entityId!=="string"||candidate.entityId.length>200)||candidate.op!=="remove"&&!own(candidate,"value")||candidate.op==="remove"&&own(candidate,"value"))return fail("CONFIG_EDIT_INVALID","Config edits support only add, replace and remove");
    const edit=candidate as unknown as ConfigEdit,parts=segments(edit.path);
    if(!own(config,parts[0]!))return fail("CONFIG_EDIT_PATH","Config root is not registered");
    let parent:unknown=next;
    const bind=(entry:unknown)=>{if(object(entry)&&typeof entry.id==="string"&&edit.entityId!==entry.id)return fail("CONFIG_EDIT_ENTITY","Array edit must name the current entity ID");};
    for(const part of parts.slice(0,-1)){
      if(Array.isArray(parent)){const entry=parent[index(part,parent.length)];bind(entry);parent=entry;}
      else if(object(parent)&&own(parent,part))parent=parent[part];
      else return fail("CONFIG_EDIT_PATH","Config edit parent does not exist");
    }
    const key=parts.at(-1)!;
    let previous:unknown,exists:boolean,arrayIndex:number|undefined;
    if(Array.isArray(parent)){arrayIndex=index(key,parent.length,edit.op==="add");exists=arrayIndex<parent.length;previous=parent[arrayIndex];if(edit.op!=="add")bind(previous);}
    else if(object(parent)){exists=own(parent,key);previous=parent[key];}
    else return fail("CONFIG_EDIT_PATH","Config edit parent is not a container");
    if(edit.op!=="add"&&!exists)return fail("CONFIG_EDIT_PATH","Config edit target does not exist");
    if(parts[0]==="agentProfiles"&&(parts.length===1||parts.length===3&&key==="id"&&object(parent)&&config.agentProfiles.some(profile=>profile.id===parent.id)||parts.length===2&&edit.op!=="remove"&&edit.op!=="add"&&object(previous)&&object(edit.value)&&previous.id!==edit.value.id))return fail("CONFIG_ACCOUNT_ID_IMMUTABLE","Existing account IDs cannot be renamed in ordinary edits; remove and create accounts explicitly");
    const deletingEntity=edit.op==="remove"&&Array.isArray(parent)&&object(previous)&&typeof previous.id==="string";
    if(!deletingEntity&&!(Array.isArray(parent)&&edit.op==="add")&&consoleConfig(next as unknown as DispatcherConfig).protectedPaths.some(path=>path.startsWith(`${edit.path}/`)))return fail("CONFIG_PROTECTED_PARENT","Expand parent replacements into precise leaf edits to preserve private fields");
    if(edit.op!=="remove"&&typeof edit.value==="string"&&/^(?:\[REDACTED\]|<redacted>|\*{3,})$/iu.test(edit.value))return fail("CONFIG_EDIT_PLACEHOLDER","Redaction placeholders are not configuration values");
    if(Array.isArray(parent)){if(edit.op==="remove")parent.splice(arrayIndex!,1);else if(edit.op==="add")parent.splice(arrayIndex!,0,structuredClone(edit.value));else parent[arrayIndex!]=structuredClone(edit.value);}
    else if(object(parent)){if(edit.op==="remove")delete parent[key];else parent[key]=structuredClone(edit.value);}
  }
  return validateConfig(next);
}
