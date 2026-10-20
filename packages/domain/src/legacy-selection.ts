/** Historical personal-local record. Never use this as a new Run selection. */
export interface LegacyRunModelSelection {
  version:1;profileId:string;providerId:string;backendId:string;nativeSelectionId:string;
  kind:"model"|"tier"|"auto";source:"explicit"|"account-default"|"policy";
  context:{repositoryId:string;baseRevision:string;configRevision:number};
  catalogVersion:string;selectedAt:string;
  reasoning:{mode:"native-default"}|{mode:"explicit";value:string};
  pricingSnapshot?:unknown;
}
export function isLegacyRunModelSelection(value:unknown):value is LegacyRunModelSelection {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const selection=value as Record<string,unknown>;
  const text=(value:unknown)=>typeof value==="string"&&value.length>0&&value.length<=240&&!value.includes("\0");
  if(selection.version!==1||!["profileId","providerId","backendId","nativeSelectionId","catalogVersion","selectedAt"].every(key=>text(selection[key]))||!["model","tier","auto"].includes(String(selection.kind))||!["explicit","account-default","policy"].includes(String(selection.source)))return false;
  if(!selection.context||typeof selection.context!=="object"||Array.isArray(selection.context)||!selection.reasoning||typeof selection.reasoning!=="object"||Array.isArray(selection.reasoning))return false;
  const context=selection.context as Record<string,unknown>;const reasoning=selection.reasoning as Record<string,unknown>;
  return text(context.repositoryId)&&text(context.baseRevision)&&Number.isSafeInteger(context.configRevision)&&Number(context.configRevision)>0&&(reasoning.mode==="native-default" ? reasoning.value===undefined : reasoning.mode==="explicit"&&text(reasoning.value));
}
