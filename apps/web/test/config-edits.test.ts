import {expect,it} from "vitest";
import {configurationEdits} from "../src/config-edits.js";
it("sends only changed fields from a safe baseline with an entity identity",()=>{
  const before={controller:{id:"keep"},agentProfiles:[{id:"a",alias:"Account",settings:{model:"old"}}]};
  const after=structuredClone(before);after.agentProfiles[0]!.settings.model="new";
  expect(configurationEdits(before,after)).toEqual([{op:"replace",path:"/agentProfiles/0/settings/model",value:"new",entityId:"a"}]);expect(before.agentProfiles[0]!.settings.model).toBe("old");
});
it("preserves identity when removals shift indices and appends new fully specified entities",()=>{
  const before={agentProfiles:[{id:"a",alias:"A"},{id:"b",alias:"B"}]},after={agentProfiles:[{id:"b",alias:"Changed"},{id:"c",alias:"C",settings:{codexHome:"/explicit/new"}}]};
  expect(configurationEdits(before,after)).toEqual([{op:"remove",path:"/agentProfiles/0",entityId:"a"},{op:"replace",path:"/agentProfiles/0/alias",entityId:"b",value:"Changed"},{op:"add",path:"/agentProfiles/-",value:after.agentProfiles[1]}]);
});
it("does not interpret canonical entity ordering as account replacement, and preserves pool priority arrays",()=>{
  const before={agentProfiles:[{id:"a",alias:"A"},{id:"b",alias:"B"}],internalLlm:{pools:[{id:"pool",profileIds:["a","b"]}]}};
  const after=structuredClone(before);after.agentProfiles.reverse();after.internalLlm.pools[0]!.profileIds.reverse();
  expect(configurationEdits(before,after)).toEqual([{op:"replace",path:"/internalLlm/pools/0/profileIds",entityId:"pool",value:["b","a"]}]);
});
it("escapes pointer keys and never turns untouched omitted fields into removals",()=>{
  expect(configurationEdits({agentProfiles:[{id:"a",settings:{"label/name":"old"}}]},{agentProfiles:[{id:"a",settings:{"label/name":"new"}}]})).toEqual([{op:"replace",path:"/agentProfiles/0/settings/label~1name",entityId:"a",value:"new"}]);
  expect(configurationEdits({settings:{}},{settings:{}})).toEqual([]);
});
