// Isolated conformance consumer: imports published JSON, never product DTOs or RHIZA code.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import Ajv from "ajv";
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
export function canonicalJson(value){
 const seen=new Set();
 const quote=text=>{for(const char of text){const point=char.codePointAt(0);if(point>=0xd800&&point<=0xdfff)throw Error("INVALID_SEMANTIC_VALUE");}return JSON.stringify(text);};
 const visit=(item,depth)=>{
  if(depth>64)throw Error("INVALID_SEMANTIC_VALUE");
  if(item===null)return "null";
  if(typeof item==="string")return quote(item);
  if(typeof item==="boolean")return String(item);
  if(typeof item==="number"&&Number.isFinite(item))return JSON.stringify(item);
  if(typeof item!=="object"||seen.has(item)||!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item)))throw Error("INVALID_SEMANTIC_VALUE");
  seen.add(item);try{
   if(Array.isArray(item)){if(Object.keys(item).length!==item.length||Array.from({length:item.length},(_,i)=>!Object.hasOwn(item,i)).some(Boolean))throw Error("INVALID_SEMANTIC_VALUE");return `[${item.map(child=>visit(child,depth+1)).join(",")}]`;}
   return `{${Object.keys(item).sort().map(key=>`${quote(key)}:${visit(item[key],depth+1)}`).join(",")}}`;
  }finally{seen.delete(item);}
 };return visit(value,0);
}
export const semanticDigest=value=>sha256(canonicalJson(value));
export function freezeWorkOrder(input){
 const order=structuredClone(input);canonicalJson(order);order.context.inputHash=sha256(Buffer.from(order.context.content,"utf8"));
 const {approval,...workOrder}=order;order.approval.digest=semanticDigest({workOrder,approval:{reference:approval.reference,expiresAt:approval.expiresAt}});return order;
}
export function loadContract(directory,pin){
 const bytes=readFileSync(join(directory,"manifest.json"));if(sha256(bytes)!==pin.manifestSha256)throw Error("ARTIFACT_DIGEST_MISMATCH");
 const manifest=JSON.parse(bytes.toString("utf8"));if(manifest.artifactVersion!==pin.artifactVersion)throw Error("ARTIFACT_VERSION_MISMATCH");
 if(manifest.protocolVersion!=="1.1"||manifest.eventSchemaVersion!=="1"||manifest.synthetic!==true||Object.keys(manifest.files??{}).sort().join(",")!=="fixtures.json,schema.json")throw Error("INVALID_ARTIFACT_MANIFEST");
 const read=name=>{const content=readFileSync(join(directory,name)),entry=manifest.files[name];if(sha256(content)!==entry.sha256||content.length!==entry.bytes)throw Error("ARTIFACT_DIGEST_MISMATCH");return JSON.parse(content.toString("utf8"));};
 const schema=read("schema.json"),fixtures=read("fixtures.json"),ajv=new Ajv({strict:true,allErrors:true});ajv.addSchema(schema);
 const validate=(name,value)=>Object.hasOwn(schema.$defs,name)&&Boolean(ajv.getSchema(`${schema.$id}#/$defs/${name}`)(value));
 if(fixtures.kind!=="synthetic-wire-fixtures"||!fixtures.examples||!Object.entries(fixtures.examples).every(([name,value])=>validate(name,value)))throw Error("INVALID_ARTIFACT_FIXTURES");
 if(!fixtures.semanticVectors?.length||!fixtures.semanticVectors.every(vector=>canonicalJson(vector.value)===vector.canonical&&semanticDigest(vector.value)===vector.sha256))throw Error("INVALID_SEMANTIC_FIXTURES");
 return {manifest,fixtures,validate};
}
export class FakeRhizaClient {
 constructor(contract,transport){this.contract=contract;this.transport=transport;this.receipts=new Map();this.snapshots=new Map();this.revisions=new Map();this.events=new Map();this.cursorJobs=new Map();}
 revision(jobId){return this.revisions.get(jobId)??0;}
 async request(command){
  const {method,path,body,status,responseSchema,requestSchema,errorCode}=command;
  if(!["GET","POST"].includes(method)||!path.startsWith("/")||path.startsWith("//"))throw Error("INVALID_CLIENT_COMMAND");
  if(requestSchema&&!this.contract.validate(requestSchema,body))throw Error("INVALID_REQUEST");
  const response=await this.transport({method,path,body}); // Deliberately no retry or alternate request key.
  if(response.status!==status)throw Error(`UNEXPECTED_HTTP_STATUS:${response.status}`);
  if(!this.contract.validate(responseSchema,response.body))throw Error("INVALID_RESPONSE");
  const value=response.body,resource=new URL(path,"http://fixture"),job=resource.pathname.match(/^\/jobs\/([^/]+)(?:\/|$)/)?.[1];
  if(["snapshot","artifacts","controlReceipt"].includes(responseSchema)&&decodeURIComponent(job??"")!==value.jobId)throw Error("OBJECT_BINDING_MISMATCH");
  if(responseSchema==="receipt"&&method==="GET"&&decodeURIComponent(resource.pathname.slice("/operations/by-key/".length))!==value.requestId)throw Error("OBJECT_BINDING_MISMATCH");
  let pageJobId;
  if(responseSchema==="eventPage"){
   const explicit=resource.searchParams.get("jobId"),known=this.cursorJobs.get(resource.searchParams.get("cursor")),next=this.cursorJobs.get(value.cursor);
   if(explicit&&known&&explicit!==known)throw Error("OBJECT_BINDING_MISMATCH");
   pageJobId=explicit??known??value.events[0]?.jobId??next;
   if(next&&pageJobId&&next!==pageJobId||value.events.some(event=>event.jobId!==pageJobId))throw Error("OBJECT_BINDING_MISMATCH");
  }
  if(responseSchema==="controlReceipt"&&value.kind!==(resource.pathname.endsWith("/inputs")?"input":"cancel"))throw Error("OBJECT_BINDING_MISMATCH");
  if(errorCode&&value.code!==errorCode)throw Error("UNEXPECTED_ERROR_CODE");
  if(responseSchema==="preflight"){
   const {targetHash,...target}=value.target;
   if(targetHash!==semanticDigest(target)||targetHash!==semanticDigest(body.workOrder.target)||value.inputHash!==body.workOrder.context.inputHash||value.workOrderHash!==semanticDigest(body.workOrder))throw Error("PREFLIGHT_BINDING_MISMATCH");
  }
  if(responseSchema==="receipt"){
   if(body&&(value.requestId!==body.requestId||value.targetHash!==body.targetHash||value.inputHash!==body.workOrder.context.inputHash||canonicalJson(value.origin)!==canonicalJson(body.workOrder.origin)||value.requestHash!==semanticDigest({schemaVersion:1,targetHash:body.targetHash,workOrder:body.workOrder})||canonicalJson(value.reassignment??null)!==canonicalJson(body.workOrder.reassignment??null)))throw Error("RECEIPT_BINDING_MISMATCH");
   const prior=this.receipts.get(value.requestId);if(prior&&canonicalJson(prior)!==canonicalJson(value))throw Error("RECEIPT_CHANGED");this.receipts.set(value.requestId,structuredClone(value));
  }
  if(responseSchema==="snapshot"){
   const known=this.cursorJobs.get(value.cursor);if(known&&known!==value.jobId)throw Error("OBJECT_BINDING_MISMATCH");
   const {targetHash,...target}=value.target;if(semanticDigest(target)!==targetHash)throw Error("SNAPSHOT_BINDING_MISMATCH");
   if(value.revision<this.revision(value.jobId))throw Error("REVISION_REGRESSION");
   const receipt=[...this.receipts.values()].find(receipt=>receipt.jobId===value.jobId);
   if(receipt&&(value.taskId!==receipt.taskId||value.target.targetHash!==receipt.targetHash||value.inputHash!==receipt.inputHash||canonicalJson(value.origin)!==canonicalJson(receipt.origin)))throw Error("SNAPSHOT_BINDING_MISMATCH");
   this.revisions.set(value.jobId,value.revision);this.snapshots.set(value.jobId,structuredClone(value));this.cursorJobs.set(value.cursor,value.jobId);
  }
  if(responseSchema==="eventPage"){
   const checked=new Map(this.events);
   for(const event of value.events){const prior=checked.get(event.eventId),hash=semanticDigest(event);if(prior&&prior!==hash)throw Error("EVENT_ID_CONFLICT");checked.set(event.eventId,hash);}
   if(pageJobId){this.cursorJobs.set(value.cursor,pageJobId);const resumed=resource.searchParams.get("cursor");if(resumed)this.cursorJobs.set(resumed,pageJobId);}
   this.events=checked;for(const event of value.events)this.revisions.set(event.jobId,Math.max(this.revision(event.jobId),event.revision));
  }
  if(responseSchema==="artifacts")for(const artifact of value.artifacts){
   const {artifactId,digest,...description}=artifact;if(!artifactId||semanticDigest(description)!==digest||artifact.jobId!==value.jobId||artifact.modelEvidence.binding.runId!==artifact.runId||artifact.modelEvidence.binding.runGeneration!==artifact.generation||artifact.modelEvidence.binding.targetHash!==artifact.targetHash||artifact.verification.commit!==artifact.commit)throw Error("ARTIFACT_BINDING_MISMATCH");
   if(!["verified","configuration_confirmed"].includes(artifact.modelEvidence.status)||artifact.modelEvidence.status==="verified"&&artifact.modelEvidence.reported.modelId!==artifact.modelEvidence.requested.modelId)throw Error("ARTIFACT_BINDING_MISMATCH");
   const snapshot=this.snapshots.get(value.jobId);if(snapshot&&(artifact.modelEvidence.requested.modelId!==snapshot.target.modelId||canonicalJson(artifact.modelEvidence.requested.modelOptions)!==canonicalJson(snapshot.target.modelOptions)||canonicalJson(artifact.modelEvidence.resolved)!==canonicalJson(artifact.modelEvidence.requested)||snapshot.runId!==artifact.runId||snapshot.runGeneration!==artifact.generation||snapshot.target.targetHash!==artifact.targetHash||snapshot.inputHash!==artifact.inputHash||canonicalJson({...snapshot.origin,runId:snapshot.runId,runGeneration:snapshot.runGeneration,sessionId:artifact.modelEvidence.binding.sessionId,targetHash:snapshot.target.targetHash})!==canonicalJson(artifact.modelEvidence.binding)))throw Error("ARTIFACT_BINDING_MISMATCH");
  }
  if(responseSchema==="controlReceipt"&&(value.requestId!==body.requestId||!path.startsWith(`/jobs/${encodeURIComponent(value.jobId)}/`)))throw Error("CONTROL_BINDING_MISMATCH");
  return structuredClone(value);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const input=JSON.parse(readFileSync(0,"utf8")),contract=loadContract(input.artifactDirectory,input.pin),base=new URL(input.baseUrl);
  if(base.protocol!=="http:"||!["127.0.0.1","localhost","[::1]"].includes(base.hostname)||base.username||base.password||base.pathname!=="/")throw Error("ISOLATED_LOOPBACK_REQUIRED");
  const client=new FakeRhizaClient(contract,async({method,path,body})=>{const response=await fetch(`${base.origin}/api/integrations/rhiza/v1${path}`,{method,redirect:"error",headers:{authorization:`Bearer ${input.token}`,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};});
  const results=[];for(const command of input.commands){await client.request(command);results.push({method:command.method,status:command.status,schema:command.responseSchema});}
  process.stdout.write(JSON.stringify({passed:results.length,results})+"\n");
 }catch(error){const code=error instanceof Error&&/^[A-Z0-9_:-]+$/.test(error.message)?error.message:"CONFORMANCE_FAILED";process.stderr.write(code+"\n");process.exitCode=1;}
}
