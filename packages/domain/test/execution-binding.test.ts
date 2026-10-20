import { expect, it } from "vitest";
import { isExecutionContextRef, validateExecutionBinding, type ExecutionBinding, type ExecutionSelection } from "../src/index.js";
const selection:ExecutionSelection={version:1,mode:"manual",source:"explicit",profileId:"p",runnerId:"local",providerId:"codex",backendId:"exec",selectionType:"explicit-model",requestedModel:"m",nativeParameters:{},catalogRevision:"catalog",contextFingerprint:"context",configRevision:1,selectedAt:"2026-10-20T00:00:00Z"};
const context={repositoryId:"repo",baseRevision:"sha"};
const binding:ExecutionBinding={profileId:"p",providerId:"codex",backendId:"exec",runnerId:"local",executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"}};
it("validates execution shapes independently of an optional model selection",()=>{
  expect(isExecutionContextRef(binding.executionRef)).toBe(true);
  for(const invalid of [null,[],{...binding.executionRef,kind:"toString"},{...binding.executionRef,kind:{toString:null}},{...binding.executionRef,pathRef:"/physical"},{...binding.executionRef,version:2},{...binding.executionRef,extra:"mixed-shape"}])expect(isExecutionContextRef(invalid)).toBe(false);
});
it("requires the exact model owner/backend and actual managed workspace context",()=>{
  expect(validateExecutionBinding(binding,selection,context)).toEqual({valid:true});
  expect(validateExecutionBinding({...binding,backendId:"other"},selection,context)).toEqual({valid:false,code:"MODEL_BINDING_DRIFT"});
  expect(validateExecutionBinding({...binding,profileId:"other"},selection,context)).toEqual({valid:false,code:"MODEL_BINDING_DRIFT"});
  expect(validateExecutionBinding({...binding,executionRef:{...binding.executionRef,baseRevision:"other"}},selection,context)).toEqual({valid:false,code:"EXECUTION_CONTEXT_DRIFT"});
});
it("rejects cloud contexts that claim unrelated local worktrees",()=>{
  const cloud={version:1 as const,id:"cloud",kind:"provider-cloud" as const,organizationRef:"org",environmentRef:"env",repositoryId:"repo",baseRevision:"sha"};
  expect(validateExecutionBinding({...binding,executionRef:cloud},selection,context)).toEqual({valid:true});
  expect(validateExecutionBinding({...binding,executionRef:{...cloud,pathRef:"workspace:fake"} as typeof cloud},selection,context)).toEqual({valid:false,code:"EXECUTION_CONTEXT_DRIFT"});
  expect(validateExecutionBinding({...binding,executionRef:{...cloud,baseRevision:"wrong"}},selection,context)).toEqual({valid:false,code:"EXECUTION_CONTEXT_DRIFT"});
});
it("requires native and execution identities to agree without inferring reported models",()=>{
  const nativeBinding={version:1 as const,product:"codex",region:"global",profileId:"p",backendId:"exec",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",identityState:"bound" as const,executionRefId:"execution"};
  expect(validateExecutionBinding({...binding,nativeBinding},selection,context)).toEqual({valid:true});
  expect(validateExecutionBinding({...binding,nativeBinding:{...nativeBinding,executionRefId:"wrong"}},selection,context)).toEqual({valid:false,code:"EXECUTION_CONTEXT_DRIFT"});
});

it("rejects another Runner and legacy v1 shapes instead of inventing execution authority",()=>{
  expect(validateExecutionBinding(binding,{...selection,runnerId:"foreign"},context)).toEqual({valid:false,code:"MODEL_BINDING_DRIFT"});
  const legacy={version:1,profileId:"p",providerId:"codex",backendId:"exec",nativeSelectionId:"m",context:{repositoryId:"repo",baseRevision:"sha",configRevision:1}};
  expect(validateExecutionBinding(binding,legacy as unknown as ExecutionSelection,context)).toEqual({valid:false,code:"MODEL_BINDING_DRIFT"});
});
