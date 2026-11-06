import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import Ajv from "ajv";
import { redactNativePayload } from "../packages/observability/dist/index.js";

const schema=JSON.parse(readFileSync(new URL("../docs/evidence/native-sessions/roundtrip.schema.json",import.meta.url),"utf8"));
const ajv=new Ajv({strict:true,allErrors:true});
const shape=ajv.compile(schema);
const tupleShape=ajv.compile({$schema:schema.$schema,definitions:schema.definitions,$ref:"#/definitions/tuple"});
const sha256=value=>createHash("sha256").update(value).digest("hex");
const invalid=code=>({valid:false,releaseEligible:false,requiresReverification:false,codes:[code]});
const safeDate=value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);

function readBounded(fd,maximum){
  const before=fstatSync(fd);if(!before.isFile()||before.size>maximum)throw new Error("ARTIFACT_MISMATCH");
  const bytes=Buffer.alloc(before.size+1);let length=0;
  while(length<bytes.length){const count=readSync(fd,bytes,length,bytes.length-length,null);if(count===0)break;length+=count;}
  const after=fstatSync(fd);
  if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error("ARTIFACT_MISMATCH");return bytes.subarray(0,length);
}
function readArtifact(root,artifact){
  const relativePath=relative(root,resolve(root,artifact.path));
  if(!relativePath||isAbsolute(relativePath)||relativePath===".."||relativePath.startsWith(".."+sep))throw new Error("ARTIFACT_PATH_UNSAFE");
  let path=root;
  for(const part of relativePath.split(sep)){path=resolve(path,part);if(lstatSync(path).isSymbolicLink())throw new Error("ARTIFACT_PATH_UNSAFE");}
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const bytes=readBounded(fd,10*1024*1024);
    if(bytes.length!==artifact.bytes||sha256(bytes)!==artifact.sha256)throw new Error("ARTIFACT_MISMATCH");return bytes;
  }finally{closeSync(fd);}
}
const isScreenshot=bytes=>bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.subarray(0,3).equals(Buffer.from([255,216,255]))||bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP";

/** Consistency is separate from trusted, out-of-record qualification review. Never changes configuration. */
export function validateNativeEvidence(record,options={}){
  let encoded;
  try{encoded=JSON.stringify(record);if(!encoded||Buffer.byteLength(encoded)>512*1024)return invalid("EVIDENCE_SCHEMA_INVALID");if(!isDeepStrictEqual(record,redactNativePayload(record)))return invalid("EVIDENCE_SENSITIVE_METADATA");}catch{return invalid("EVIDENCE_SCHEMA_INVALID");}
  if(!shape(record))return invalid("EVIDENCE_SCHEMA_INVALID");
  if(record.provenance.kind==="fixture"&&["runtime-verified","ui-roundtrip-verified"].includes(record.level))return invalid("FIXTURE_QUALIFICATION_FORBIDDEN");
  const ui=record.level==="ui-roundtrip-verified";
  if(ui&&(record.provenance.kind!=="native-ui"||record.artifacts.some(artifact=>artifact.origin==="fixture"||artifact.origin==="documented")))return invalid("FIXTURE_QUALIFICATION_FORBIDDEN");
  if(record.level==="runtime-verified"&&!["native-runtime","native-ui"].includes(record.provenance.kind))return invalid("EVIDENCE_LEVEL_INVALID");
  const stages=[record.stages.initial,record.stages.human,record.stages.return];
  const identity=["taskId","contractRevision","runId","generation","sessionId","nativeSessionId","nativeThreadId","executionRefId","workspaceRef","reportedModel","permissionFingerprint"];
  if(stages.some(stage=>identity.some(key=>!isDeepStrictEqual(stage[key],stages[0][key])))||ui&&stages.some(stage=>stage.accountFingerprint!==record.tuple.accountFingerprint))return invalid("EVIDENCE_IDENTITY_CHANGED");
  if(ui&&record.tuple.product==="codex"&&stages.some(stage=>!stage.nativeThreadId))return invalid("EVIDENCE_IDENTITY_CHANGED");
  if(record.requestedModel!==null&&stages.some(stage=>stage.reportedModel!==record.requestedModel))return invalid("EVIDENCE_MODEL_CHANGED");
  if(stages.some(stage=>!Number.isSafeInteger(stage.controlEpoch))||stages.map(stage=>stage.control).join(",")!=="AUTOMATED,HUMAN,AUTOMATED"||stages[0].controlEpoch>=stages[1].controlEpoch||stages[1].controlEpoch>=stages[2].controlEpoch)return invalid("CONTROL_EPOCH_INVALID");
  const times=[...stages.map(stage=>stage.at),record.capturedAt];
  if(times.some(time=>!safeDate(time))||times.some((time,index)=>index>0&&Date.parse(time)<Date.parse(times[index-1])))return invalid("EVIDENCE_TIME_INVALID");
  const artifacts=new Map(record.artifacts.map(artifact=>[artifact.id,artifact]));
  if(record.artifacts.reduce((sum,artifact)=>sum+artifact.bytes,0)>50*1024*1024)return invalid("ARTIFACT_BUDGET_EXCEEDED");
  if(artifacts.size!==record.artifacts.length||new Set(record.scenarios.map(scenario=>scenario.id)).size!==record.scenarios.length)return invalid("EVIDENCE_REFERENCE_INVALID");
  const refs=[...stages.flatMap(stage=>stage.artifactRefs),...record.scenarios.flatMap(scenario=>scenario.artifactRefs),record.verification.artifactRef];
  if(refs.some(ref=>!artifacts.has(ref))||artifacts.get(record.verification.artifactRef).kind!=="verification")return invalid("EVIDENCE_REFERENCE_INVALID");
  if(ui&&(["E03","E04","E05","E06","E07"].some(id=>!record.scenarios.some(scenario=>scenario.id===id&&scenario.outcome==="pass"))||record.scenarios.some(scenario=>scenario.outcome==="fail")))return invalid("GUI_SCENARIOS_UNVERIFIED");
  if(ui&&(record.verification.exitCode!==0||!record.stages.human.artifactRefs.some(ref=>artifacts.get(ref).kind==="screenshot"&&artifacts.get(ref).origin==="native-ui")||!record.stages.return.artifactRefs.includes(record.verification.artifactRef)))return invalid("GUI_ARTIFACTS_UNVERIFIED");
  if(ui&&record.stages.return.snapshotCommit!==record.verification.commit)return invalid("VERIFICATION_COMMIT_MISMATCH");
  if(ui){
    const proof=record.controlEvidence;const counterexample={codex:"codex-source-filter",opencode:"opencode-cancel-isolation"}[record.tuple.product];
    if(!proof||proof.exclusion==="none"||proof.otherWriters!=="none"||proof.readback!=="complete"||proof.providerCounterexample.outcome!=="pass"||counterexample&&proof.providerCounterexample.id!==counterexample)return invalid("CONTROL_EVIDENCE_UNVERIFIED");
    if(!record.stages.human.artifactRefs.includes(proof.releaseArtifactRef)||!record.stages.return.artifactRefs.includes(proof.reclaimArtifactRef)||[proof.releaseArtifactRef,proof.reclaimArtifactRef,...proof.providerCounterexample.artifactRefs].some(ref=>artifacts.get(ref)?.kind!=="trace"))return invalid("CONTROL_EVIDENCE_UNVERIFIED");
  }
  const codes=[];let requiresReverification=false,artifactsVerified=false;
  if(!tupleShape(options.currentTuple))codes.push("CURRENT_TUPLE_REQUIRED");
  else if(!isDeepStrictEqual(record.tuple,options.currentTuple)){requiresReverification=true;codes.push("EVIDENCE_SCOPE_CHANGED");}
  if(options.artifactRoot){
    let root;try{root=realpathSync(options.artifactRoot);}catch{return invalid("ARTIFACT_PATH_UNSAFE");}
    const contents=new Map();
    try{for(const artifact of record.artifacts)contents.set(artifact.id,readArtifact(root,artifact));}
    catch(error){return invalid(["ARTIFACT_PATH_UNSAFE","ARTIFACT_MISMATCH"].includes(error.message)?error.message:"ARTIFACT_MISMATCH");}
    if(ui){
      for(const [index,stage] of stages.entries()){const markerRefs=stage.artifactRefs.filter(ref=>artifacts.get(ref).kind==="marker");if(markerRefs.length!==1||contents.get(markerRefs[0]).toString("utf8")!==["auto-1\n","human-2\n","auto-3\n"][index])return invalid("MARKER_STAGE_INVALID");}
      if(record.artifacts.some(artifact=>artifact.kind==="screenshot"&&!isScreenshot(contents.get(artifact.id))))return invalid("SCREENSHOT_INVALID");
    }
    artifactsVerified=true;
  }else codes.push("ARTIFACTS_UNVERIFIED");
  if(!ui)codes.push("EVIDENCE_LEVEL_INSUFFICIENT");
  const recordSha256=sha256(encoded);
  // This digest must come from a trusted reviewer, never a field in the submitted record.
  if(options.reviewedRecordSha256!==recordSha256)codes.push("EVIDENCE_REVIEW_REQUIRED");
  return {valid:true,releaseEligible:ui&&artifactsVerified&&codes.length===0,requiresReverification,recordSha256,codes};
}

function readJson(path){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{return JSON.parse(readBounded(fd,512*1024).toString("utf8"));}finally{closeSync(fd);}}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const args=process.argv.slice(2);const allowed=new Set(["--record","--current-tuple","--artifact-root"]);const values={};
    for(let index=0;index<args.length;index+=2){if(!allowed.has(args[index])||!args[index+1]||values[args[index]])throw new Error("invalid");values[args[index]]=args[index+1];}
    const record=readJson(values["--record"]);const currentTuple=values["--current-tuple"]?readJson(values["--current-tuple"]):undefined;
    const result=validateNativeEvidence(record,{currentTuple,artifactRoot:values["--artifact-root"]});console.log(JSON.stringify(result));process.exitCode=result.valid&&!result.requiresReverification&&!result.codes.some(code=>["CURRENT_TUPLE_REQUIRED","ARTIFACTS_UNVERIFIED"].includes(code))?0:1;
  }catch{console.error(JSON.stringify(invalid("EVIDENCE_FILE_INVALID")));process.exitCode=1;}
}
