import { expect, it } from "vitest";
import { remoteCatalog, remoteRunInventory,remoteCommitResult,remoteDeliveryTarget,remotePushResult } from "../src/remote-results.js";
const identity = { profileId: "p", runnerId: "remote", providerId: "codex" };
function catalog() { return { ...identity, backendId: "codex-exec-json", contextFingerprint: "context", revision: "catalog", fetchedAt: new Date().toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit", entries: [{ id: "model", displayName: "Model", kind: "model", selectable: true, access: "unconfirmed", parameterOptions: { reasoningEffort: ["low"] }, parameterDefaults: { reasoningEffort: "low" } }] }; }
it("rejects a foreign catalog identity, duplicate model identities and unknown provider payload fields", () => {
  const good = catalog();
  for (const invalid of [{ ...good, runnerId: "other" }, { ...good, profileId: "other" }, { ...good, entries: [...good.entries, ...good.entries] }, { ...good, nativePayload: { arbitrary: true } }, { ...good, entries: [{ ...good.entries[0], parameterDefaults: { reasoningEffort: "unsupported" } }] }]) expect(() => remoteCatalog(invalid, identity)).toThrow(expect.objectContaining({ code: "REMOTE_RESULT_INVALID" }));
});
it("preserves unconfirmed access and unsupported native evidence without manufacturing explicit availability", () => {
  const good = catalog(); expect(remoteCatalog(good, identity)).toEqual(good);
  const unavailable = { ...good, entries: [], freshness: "unverified", selectionSupport: "unsupported", failure: { code: "NATIVE_AUTH_REQUIRED", message: "Native login required" } };
  expect(remoteCatalog(unavailable, identity)).toEqual(unavailable);
});

it("rejects malformed or contradictory native ownership inventory",()=>{
  const row={runnerId:"remote",profileId:"p",runId:"run",state:"RUNNING",attached:true,resultAvailable:false,generation:1,leaseId:"lease",startCommandHash:"a".repeat(64),lease:{runnerId:"remote",runId:"run",leaseId:"lease",generation:1,expiresAt:"2026-10-16T12:00:00Z"}};
  expect(remoteRunInventory({runnerId:"remote",runs:[row]},"remote")[0]).toMatchObject({nativeState:"RUNNING",attached:true});
  for(const runs of [[row,row],[{...row,runnerId:"foreign"}],[{...row,startCommandHash:"wrong"}],[{...row,lease:{...row.lease,generation:2}}],[{...row,lease:{...row.lease,revokedAt:"invalid"}}],[{...row,attached:undefined}]])expect(()=>remoteRunInventory({runnerId:"remote",runs},"remote")).toThrow(expect.objectContaining({code:"REMOTE_RESULT_INVALID"}));
});

it("validates commit receipts against canonical ownership and rejects private or unsafe manifests",()=>{
 const expected={runId:"run",generation:1,branch:"dispatcher/task/run"},good={version:1,...expected,commit:"a".repeat(40),files:["result.txt"],created:true,completedAt:"2026-10-16T12:00:00Z"};
 expect(remoteCommitResult(good,expected)).toEqual(good);
 for(const patch of [{runId:"foreign"},{generation:2},{branch:"main"},{commit:"bad"},{files:["../private"]},{files:[".git/config"]},{files:["/private/path"]},{files:["a","a"]},{created:"yes"},{completedAt:"bad"},{credential:"secret"}])expect(()=>remoteCommitResult({...good,...patch},expected)).toThrow(expect.objectContaining({code:"REMOTE_RESULT_INVALID"}));
});

it("rejects unbounded or private fields from owning delivery target metadata",()=>{
 const target={version:1,host:"github.example",repository:"acme/repo",remoteFingerprint:"a".repeat(64)};expect(remoteDeliveryTarget(target)).toEqual(target);
 for(const patch of [{host:"git@private"},{host:"bad..host"},{repository:"../repo"},{remoteFingerprint:"bad"},{url:"ssh://private/target"}])expect(()=>remoteDeliveryTarget({...target,...patch})).toThrow(expect.objectContaining({code:"REMOTE_RESULT_INVALID"}));
});

it("qualifies a composite owning push receipt and rejects inconsistent identity, target or private fields",()=>{
 const target={version:1 as const,host:"github.example",repository:"acme/repo",remoteFingerprint:"a".repeat(64)},expected={runId:"run",generation:1,branch:"dispatcher/task/run",target};
 const commit={version:1,runId:expected.runId,generation:expected.generation,branch:expected.branch,commit:"a".repeat(40),files:["result.txt"],created:true,completedAt:"2026-10-16T12:00:00Z"};
 const push={version:1,...expected,commit:commit.commit,pushedAt:"2026-10-16T12:01:00Z"},good={version:1,commit,push};expect(remotePushResult(good,expected)).toEqual(good);
 for(const patch of [{generation:2},{commit:"b".repeat(40)},{target:{...target,remoteFingerprint:"b".repeat(64)}},{privatePayload:{token:"private"}}])expect(()=>remotePushResult({...good,push:{...push,...patch}},expected)).toThrow(expect.objectContaining({code:"REMOTE_RESULT_INVALID"}));
});
