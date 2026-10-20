import {expect,it} from "vitest";
import type {ExecutionSelection} from "../src/publication.js";
import {assessNativeDrift,isNativeAccountFingerprint} from "../src/native-drift.js";
const selection:ExecutionSelection={version:1,mode:"manual",source:"explicit",profileId:"p",runnerId:"local",providerId:"codex",backendId:"cli",selectionType:"explicit-model",requestedModel:"model",nativeParameters:{reasoningEffort:"medium"},contextFingerprint:"scope",configRevision:1,selectedAt:"2026-10-20T12:00:00Z"};
const account=`sha256:${"a".repeat(64)}`;
const policy={version:1 as const,mode:"compatible" as const,permissionFingerprint:"policy"};
it("compares frozen v3 model and effort without mutating selection or policy",()=>{
 const before=structuredClone(selection);
 const facts={model:{nativeSelectionId:"model",reasoning:"medium"},permissionFingerprint:"policy",accountFingerprint:account};
 expect(assessNativeDrift(selection,facts,{...policy,accountFingerprint:account})).toMatchObject({allowed:true,coverage:"complete",model:"matched"});
 expect(assessNativeDrift(selection,{...facts,model:{nativeSelectionId:"new-default",reasoning:"medium"}},policy)).toMatchObject({allowed:false,code:"MODEL_BINDING_DRIFT",requiresConfirmation:true});
 expect(assessNativeDrift(selection,{...facts,model:{nativeSelectionId:"model",reasoning:"high"}},policy)).toMatchObject({allowed:false,code:"MODEL_BINDING_DRIFT"});
 expect(assessNativeDrift(selection,{...facts,model:{nativeSelectionId:"model"}},policy)).toMatchObject({allowed:false,code:"NATIVE_MODEL_UNVERIFIED",model:"unknown"});
 expect(selection).toEqual(before);
});
it("keeps omitted native default and unknown account facts unproven",()=>{
 const nativeDefault={...selection,source:"native-default" as const,selectionType:"native-default" as const,requestedModel:undefined,nativeParameters:{}};
 expect(assessNativeDrift(nativeDefault,{model:{nativeSelectionId:"reported"},permissionFingerprint:"policy"},policy)).toMatchObject({allowed:false,code:"NATIVE_MODEL_UNVERIFIED",model:"unknown"});
 const facts={model:{nativeSelectionId:"model",reasoning:"medium"},permissionFingerprint:"policy"};
 expect(assessNativeDrift(selection,facts,policy)).toMatchObject({allowed:true,coverage:"partial",account:"unknown"});
 expect(assessNativeDrift(selection,facts,{...policy,mode:"exact",accountFingerprint:account})).toMatchObject({allowed:false,code:"NATIVE_ACCOUNT_UNVERIFIED"});
 expect(assessNativeDrift(selection,{...facts,permissionFingerprint:"expanded"},policy)).toMatchObject({allowed:false,code:"NATIVE_POLICY_DRIFT",requiresConfirmation:true});
});
it("rejects invalid policy, unsafe native reports and profile aliases as account identity",()=>{
 expect(isNativeAccountFingerprint("profile-p")).toBe(false);expect(isNativeAccountFingerprint(account)).toBe(true);
 expect(assessNativeDrift(selection,{model:{nativeSelectionId:"Bearer private-token"}},policy)).toMatchObject({reported:{state:"unknown"},allowed:false});
 expect(assessNativeDrift(selection,{}, {...policy,accountFingerprint:"profile-p"})).toMatchObject({allowed:false,code:"NATIVE_DRIFT_POLICY_INVALID"});
});
