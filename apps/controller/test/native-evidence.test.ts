import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { validateNativeEvidence } from "../../../scripts/validate-native-evidence.mjs";

const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const digest=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"native-evidence-"));roots.push(root);
  const tuple={providerId:"codex",product:"codex",region:"global",profileId:"profile-alias",backendId:"codex-app-server",runnerId:"local",os:"darwin",architecture:"arm64",binaryRef:"binary:codex",installedVersion:"fixture-1",schemaFingerprint:"a".repeat(64),accountFingerprint:"sha256:"+"b".repeat(64),nativeStoreRef:"store:fixture",client:{surface:"desktop",id:"native-client",version:"fixture-1"}};
  const contents=["auto-1\n","human-2\n","auto-3\n",Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lQAAAABJRU5ErkJggg==","base64"),"verification exit 0\n","synthetic release and readback trace\n"];
  const artifacts=contents.map((content,index)=>{const path="artifact-"+index;writeFileSync(join(root,path),content);return {id:"artifact-"+index,kind:index===3?"screenshot":index===4?"verification":index===5?"trace":"marker",path,sha256:digest(content),bytes:Buffer.byteLength(content),origin:"native-ui"};});
  const identity={taskId:"task",contractRevision:1,runId:"run",generation:1,sessionId:"canonical-session",nativeSessionId:"exact-native",nativeThreadId:"exact-native",executionRefId:"execution",workspaceRef:"workspace:work",reportedModel:"model",permissionFingerprint:"policy",accountFingerprint:tuple.accountFingerprint};
  const stage=(index:number)=>({...identity,at:"2026-10-11T08:0"+index+":00Z",controlEpoch:1+index*2,control:index===1?"HUMAN":"AUTOMATED",...(index===2?{snapshotCommit:"e".repeat(40)}:{}),artifactRefs:["artifact-"+index,...(index===1?["artifact-3","artifact-5"]:index===2?["artifact-4","artifact-5"]:[])]});
  const record={version:1,id:"roundtrip",capturedAt:"2026-10-11T08:03:00Z",baseCommit:"c".repeat(40),headCommit:"d".repeat(40),tuple,level:"ui-roundtrip-verified",provenance:{kind:"native-ui"},requestedModel:"model",stages:{initial:stage(0),human:stage(1),return:stage(2)},artifacts,scenarios:["E03","E04","E05","E06","E07"].map(id=>({id,outcome:"pass",artifactRefs:["artifact-3"]})),verification:{exitCode:0,commit:"e".repeat(40),artifactRef:"artifact-4"},controlEvidence:{exclusion:"cooperative",otherWriters:"none",readback:"complete",releaseArtifactRef:"artifact-5",reclaimArtifactRef:"artifact-5",providerCounterexample:{id:"codex-source-filter",outcome:"pass",artifactRefs:["artifact-5"]}},limitations:[]};
  const options=()=>({currentTuple:tuple,artifactRoot:root,reviewedRecordSha256:digest(JSON.stringify(record))});
  return {root,record,options};
}
// These synthetic records test the validator. They are never stored as provider qualification.
it("accepts a consistent reviewed three-stage record only with current tuple and matching artifact bytes",()=>{
  const f=fixture();expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:true,releaseEligible:true,requiresReverification:false,codes:[]});
});
it("never self-qualifies a record without trusted review or verified files",()=>{
  const f=fixture();expect(validateNativeEvidence(f.record,{currentTuple:f.record.tuple,artifactRoot:f.root})).toMatchObject({valid:true,releaseEligible:false,codes:expect.arrayContaining(["EVIDENCE_REVIEW_REQUIRED"])});
  expect(validateNativeEvidence(f.record,{currentTuple:f.record.tuple,reviewedRecordSha256:digest(JSON.stringify(f.record))})).toMatchObject({releaseEligible:false,codes:expect.arrayContaining(["ARTIFACTS_UNVERIFIED"])});
});
it("rejects fixture provenance claiming real UI evidence",()=>{
  const f=fixture();f.record.provenance.kind="fixture";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,releaseEligible:false,codes:expect.arrayContaining(["FIXTURE_QUALIFICATION_FORBIDDEN"])});
});
it("rejects a missing return stage",()=>{
  const f=fixture();const {return:returned,...stages}=f.record.stages;void returned;expect(validateNativeEvidence({...f.record,stages},f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["EVIDENCE_SCHEMA_INVALID"])});
});
it.each(["installedVersion","region","nativeStoreRef","accountFingerprint"] as const)("retains historical evidence but requires re-verification after %s drift",key=>{
  const f=fixture(),before=JSON.stringify(f.record);const currentTuple={...f.record.tuple,[key]:key==="accountFingerprint"?"sha256:"+"f".repeat(64):"changed"};
  expect(validateNativeEvidence(f.record,{...f.options(),currentTuple})).toMatchObject({valid:true,releaseEligible:false,requiresReverification:true,codes:expect.arrayContaining(["EVIDENCE_SCOPE_CHANGED"])});expect(JSON.stringify(f.record)).toBe(before);
});
it("documented or native runtime evidence cannot become UI qualification",()=>{
  const f=fixture();for(const level of ["documented","runtime-verified"]){const record={...f.record,level,provenance:{kind:level==="documented"?"documented":"native-runtime"}};expect(validateNativeEvidence(record,{...f.options(),reviewedRecordSha256:digest(JSON.stringify(record))})).toMatchObject({valid:true,releaseEligible:false,codes:expect.arrayContaining(["EVIDENCE_LEVEL_INSUFFICIENT"])});}
});
it.each(["nativeSessionId","nativeThreadId","executionRefId","runId","reportedModel","permissionFingerprint"] as const)("rejects stage drift in %s",key=>{
  const f=fixture();f.record.stages.human[key]="different";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,releaseEligible:false,codes:expect.arrayContaining(["EVIDENCE_IDENTITY_CHANGED"])});
});
it("rejects failed or missing core GUI scenarios and non-increasing control epochs",()=>{
  const f=fixture();f.record.scenarios[0]!.outcome="unverified";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["GUI_SCENARIOS_UNVERIFIED"])});
  f.record.scenarios[0]!.outcome="pass";f.record.stages.return.controlEpoch=3;expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["CONTROL_EPOCH_INVALID"])});
});
it("rejects changed artifact bytes and a stale review digest",()=>{
  const f=fixture();writeFileSync(join(f.root,"artifact-1"),"different\n");expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["ARTIFACT_MISMATCH"])});
  const other=fixture(),options=other.options();other.record.limitations.push("new limitation");expect(validateNativeEvidence(other.record,options)).toMatchObject({valid:true,releaseEligible:false,codes:expect.arrayContaining(["EVIDENCE_REVIEW_REQUIRED"])});
});
it("does not accept self-consistent hashes for wrong marker or screenshot contents",()=>{
  for(const index of [1,3]){const f=fixture();const content="made-up";writeFileSync(join(f.root,"artifact-"+index),content);f.record.artifacts[index]!.sha256=digest(content);f.record.artifacts[index]!.bytes=Buffer.byteLength(content);expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining([index===1?"MARKER_STAGE_INVALID":"SCREENSHOT_INVALID"])});}
});
it("rejects path traversal, linked artifacts and credential-shaped metadata",()=>{
  const f=fixture();f.record.artifacts[0]!.path="../outside";expect(validateNativeEvidence(f.record,f.options()).valid).toBe(false);
  f.record.artifacts[0]!.path="linked";symlinkSync(join(f.root,"artifact-0"),join(f.root,"linked"));expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["ARTIFACT_PATH_UNSAFE"])});
  f.record.artifacts[0]!.path="artifact-0";f.record.id="accessToken=private-test-value";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["EVIDENCE_SENSITIVE_METADATA"])});
});
it("the CLI returns redacted reason codes for an invalid file and never prints its contents",()=>{
  const f=fixture();const file=join(f.root,"bad.json");writeFileSync(file,'{"accessToken":"private-test-value"');const result=spawnSync(process.execPath,[resolve(import.meta.dirname,"../../../scripts/validate-native-evidence.mjs"),"--record",file],{encoding:"utf8"});expect(result.status).toBe(1);expect(result.stdout+result.stderr).toContain("EVIDENCE_FILE_INVALID");expect(result.stdout+result.stderr).not.toContain("private-test-value");
});
it("cannot qualify a roundtrip without explicit single-writer release and complete return proof",()=>{
  const f=fixture();const {controlEvidence,...record}=f.record;void controlEvidence;expect(validateNativeEvidence(record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["CONTROL_EVIDENCE_UNVERIFIED"])});
});
it("a failed safety scenario prevents UI qualification even when E03-E07 pass",()=>{
  const f=fixture();f.record.scenarios.push({id:"E17",outcome:"fail",artifactRefs:["artifact-3"]});expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["GUI_SCENARIOS_UNVERIFIED"])});
});
it("native runtime image metadata cannot stand in for a human GUI capture",()=>{
  const f=fixture();f.record.artifacts[3]!.origin="native-runtime";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["GUI_ARTIFACTS_UNVERIFIED"])});
});
it("bounds the total declared artifact bytes before reading any files",()=>{
  const f=fixture();for(let index=0;index<6;index++)f.record.artifacts.push({...f.record.artifacts[0]!,id:"large-"+index,bytes:10*1024*1024});
  expect(validateNativeEvidence(f.record,{currentTuple:f.record.tuple})).toMatchObject({valid:false,codes:expect.arrayContaining(["ARTIFACT_BUDGET_EXCEEDED"])});
});
it("requires the verification commit to match the returned snapshot and rejects unsafe control facts",()=>{
  const f=fixture();f.record.stages.return.snapshotCommit="f".repeat(40);expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["VERIFICATION_COMMIT_MISMATCH"])});
  f.record.stages.return.snapshotCommit=f.record.verification.commit;f.record.controlEvidence.otherWriters="unknown";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["CONTROL_EVIDENCE_UNVERIFIED"])});
});
it("rejects an unversioned tuple record and invalid timestamps",()=>{
  const f=fixture();expect(validateNativeEvidence({...f.record,version:2},f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["EVIDENCE_SCHEMA_INVALID"])});
  f.record.stages.human.at="2026-02-30T08:01:00Z";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["EVIDENCE_TIME_INVALID"])});
});
it("Codex GUI qualification requires the exact thread identity in every stage",()=>{
  const f=fixture();for(const stage of Object.values(f.record.stages)){const {nativeThreadId,...withoutThread}=stage;void nativeThreadId;Object.assign(stage,withoutThread);Reflect.deleteProperty(stage,"nativeThreadId");}
  expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["EVIDENCE_IDENTITY_CHANGED"])});
});
it("stage account identity cannot be replaced by the tuple's unchanged profile alias",()=>{
  const f=fixture();f.record.stages.human.accountFingerprint="sha256:"+"f".repeat(64);expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["EVIDENCE_IDENTITY_CHANGED"])});
});
it("requires the native reported model to match an explicit selection while permitting native defaults",()=>{
  const f=fixture();f.record.requestedModel="different-explicit-model";expect(validateNativeEvidence(f.record,f.options())).toMatchObject({valid:false,codes:expect.arrayContaining(["EVIDENCE_MODEL_CHANGED"])});
  const record={...f.record,requestedModel:null};expect(validateNativeEvidence(record,{...f.options(),reviewedRecordSha256:digest(JSON.stringify(record))})).toMatchObject({valid:true,releaseEligible:true,codes:[]});
});
it.each(["record","artifact"])("the CLI rejects a %s FIFO without waiting for a writer",kind=>{
  const f=fixture(),fifo=join(f.root,"fifo"),record=join(f.root,"record.json"),tuple=join(f.root,"tuple.json");
  const created=spawnSync("mkfifo",[fifo],{encoding:"utf8",timeout:2000});expect(created.status).toBe(0);
  if(kind==="artifact")f.record.artifacts[0]!.path="fifo";
  writeFileSync(record,JSON.stringify(f.record));writeFileSync(tuple,JSON.stringify(f.record.tuple));
  const result=spawnSync(process.execPath,[resolve(import.meta.dirname,"../../../scripts/validate-native-evidence.mjs"),"--record",kind==="record"?fifo:record,"--current-tuple",tuple,"--artifact-root",f.root],{encoding:"utf8",timeout:2000});
  expect(result.error).toBeUndefined();expect(result.status).toBe(1);expect(result.stdout+result.stderr).toContain(kind==="record"?"EVIDENCE_FILE_INVALID":"ARTIFACT_MISMATCH");
});
