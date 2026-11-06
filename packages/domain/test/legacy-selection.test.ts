import { expect, it } from "vitest";
import { isLegacyRunModelSelection } from "../src/index.js";

const legacy={version:1,profileId:"p",providerId:"codex",backendId:"exec",nativeSelectionId:"model",kind:"model",source:"explicit",context:{repositoryId:"repo",baseRevision:"sha",configRevision:1},catalogVersion:"catalog",selectedAt:"2026-10-20T00:00:00Z",reasoning:{mode:"native-default"},pricingSnapshot:{source:"native",unknownHistoricalField:true}};

it("reads a historical selection without replacing its raw price or inferring Runner identity",()=>{
  const raw=JSON.parse(JSON.stringify(legacy));
  expect(isLegacyRunModelSelection(raw)).toBe(true);
  expect(raw).toEqual(legacy);
  expect(raw).not.toHaveProperty("runnerId");
});

it("does not confuse another v1 shape or a partial legacy record with a legacy selection",()=>{
  expect(isLegacyRunModelSelection({version:1,mode:"manual",selectionType:"native-default",runnerId:"local"})).toBe(false);
  expect(isLegacyRunModelSelection({...legacy,context:{...legacy.context,baseRevision:""}})).toBe(false);
  expect(isLegacyRunModelSelection({...legacy,reasoning:{mode:"explicit"}})).toBe(false);
});
