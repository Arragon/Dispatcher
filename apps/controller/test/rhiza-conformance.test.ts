import {afterEach,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {spawn} from "node:child_process";
import {loadContract,FakeRhizaClient,freezeWorkOrder,semanticDigest} from "../../../scripts/rhiza-fake-client.mjs";
import {RHIZA_CAPABILITIES} from "@dispatcher/protocol";
import type {JsonValue} from "@dispatcher/persistence";
import {rhizaAdmissionFixture} from "./fixtures/rhiza-admission.js";
import {rhizaReadJobFixture,seedRhizaCandidate} from "./fixtures/rhiza-read-job.js";
import {waitingRhizaJob} from "./fixtures/rhiza-waiting-job.js";
import {clientHeaders,clientToken,rhizaServiceFixture} from "./fixtures/rhiza-service.js";
const artifactDirectory=resolve("packages/protocol/releases/rhiza/1.1.0"),pin=JSON.parse(readFileSync(resolve("packages/protocol/test/fixtures/rhiza-release-pin.json"),"utf8"));
const contract=loadContract(artifactDirectory,pin),opened:Array<{close():Promise<void>}>=[];
afterEach(async()=>{for(const f of opened.splice(0))await f.close();});
function consumer(service:Awaited<ReturnType<typeof rhizaServiceFixture>>["service"]){return new FakeRhizaClient(contract,async({method,path,body})=>{const response=await service.app.inject({method,url:`/api/integrations/rhiza/v1${path}`,headers:clientHeaders,...(body===undefined?{}:{payload:body})});return {status:response.statusCode,body:response.json()};});}
async function syntheticAdmission(){
 const f=await rhizaAdmissionFixture(undefined,[...RHIZA_CAPABILITIES].filter(capability=>capability!=="model.verified"));opened.push(f);
 // Test-only native/SCM facts + deferred runtime. No production enablement path.
 Reflect.set(f.service,"rhizaAuth",f.auth);Reflect.set(f.service,"rhizaTargets",f.targets);Reflect.set(f.service,"rhizaJobs",f.jobs);return {...f,client:consumer(f.service)};
}
async function accepted(){const f=await syntheticAdmission(),order=freezeWorkOrder(f.request.workOrder),preflight=await f.client.request({method:"POST",path:"/jobs/preflights",requestSchema:"preflightRequest",body:{workOrder:order},status:200,responseSchema:"preflight"}),request={requestId:"fake-client-submit",preflightId:preflight.preflightId,targetHash:semanticDigest(order.target),workOrder:order},receipt=await f.client.request({method:"POST",path:"/jobs",requestSchema:"submitRequest",body:request,status:202,responseSchema:"receipt"});return {...f,request,receipt};}
it("a detached Node consumer loads only the pinned release and negotiates real loopback HTTP",async()=>{
 const f=await rhizaServiceFixture();opened.push(f);const baseUrl=await f.service.app.listen({host:"127.0.0.1",port:0});
 const commands=[{method:"GET",path:"/capabilities",status:200,responseSchema:"capabilities"},{method:"POST",path:"/handshakes",requestSchema:"handshakeRequest",body:{protocolVersions:["1.1"],requiredCapabilities:["targets.read"],requiredScopes:["targets:read"]},status:200,responseSchema:"handshake"}];
 const child=spawn(process.execPath,[resolve("scripts/rhiza-fake-client.mjs")],{stdio:["pipe","pipe","pipe"]}),chunks:string[]=[],errors:string[]=[];child.stdout.on("data",bytes=>chunks.push(bytes.toString()));child.stderr.on("data",bytes=>errors.push(bytes.toString()));
 const exited=new Promise<number|null>((done,fail)=>{child.once("error",fail);child.once("exit",done);});child.stdin.end(JSON.stringify({baseUrl,token:clientToken,artifactDirectory,pin,commands}));expect(await exited,errors.join("")).toBe(0);expect(JSON.parse(chunks.join(""))).toMatchObject({passed:2});expect(chunks.join("")).not.toContain(clientToken);
 const capabilities=await consumer(f.service).request(commands[0]);expect(capabilities.capabilities).not.toContain("jobs.submit");expect(capabilities.capabilities).not.toContain("jobs.reassign");expect(capabilities.capabilities).not.toContain("model.verified");
});
it("handshake rejects legacy versions, unknown required capability and missing scopes deterministically",async()=>{
 const f=await rhizaServiceFixture();opened.push(f);const client=consumer(f.service);
 for(const [body,errorCode] of [[{protocolVersions:["1.0"],requiredCapabilities:[],requiredScopes:[]},"PROTOCOL_UNSUPPORTED"],[{protocolVersions:["1.1"],requiredCapabilities:["future.remote-control"],requiredScopes:[]},"CAPABILITY_REQUIRED"]] as const)await client.request({method:"POST",path:"/handshakes",requestSchema:"handshakeRequest",body,status:409,responseSchema:"error",errorCode});
 await f.configure(config=>{config.rhizaIngress!.clients[0]!.scopes=["jobs:read"];});await client.request({method:"POST",path:"/handshakes",requestSchema:"handshakeRequest",body:{protocolVersions:["1.1"],requiredCapabilities:[],requiredScopes:["jobs:submit"]},status:403,responseSchema:"error",errorCode:"ACCESS_DENIED"});
});
it("uses independent hashing through preflight/submit/lookup and never promotes accepted into execution",async()=>{
 const f=await syntheticAdmission(),client=f.client;await client.request({method:"POST",path:"/handshakes",requestSchema:"handshakeRequest",body:{protocolVersions:["1.1"],requiredCapabilities:["jobs.submit","jobs.reassign"],requiredScopes:["jobs:submit"]},status:200,responseSchema:"handshake"});
 const catalog=await client.request({method:"GET",path:"/targets?repositoryId=repo-a",status:200,responseSchema:"targetCatalog"});expect(catalog.targets[0].releaseQualified).toBe(false);
 const order=freezeWorkOrder({...f.request.workOrder,context:{...f.request.workOrder.context,content:"\nIndependent client 😀\r\n"}}),preflight=await client.request({method:"POST",path:"/jobs/preflights",requestSchema:"preflightRequest",body:{workOrder:order},status:200,responseSchema:"preflight"});expect(f.service.database.listCanonicalTasks()).toEqual([]);expect(f.starts).toEqual([]);
 const request={requestId:"independent-client",preflightId:preflight.preflightId,targetHash:semanticDigest(order.target),workOrder:order},command={method:"POST",path:"/jobs",requestSchema:"submitRequest",body:request,status:202,responseSchema:"receipt"};
 const [receipt,replay]=await Promise.all([client.request(command),client.request(command)]);expect(replay).toEqual(receipt);expect(f.service.database.listCanonicalTasks()).toHaveLength(1);expect(f.scheduled).toHaveLength(1);expect(f.starts).toEqual([]);
 expect(await client.request({method:"GET",path:`/operations/by-key/${request.requestId}`,status:200,responseSchema:"receipt"})).toEqual(receipt);
 await client.request({...command,body:{...request,workOrder:freezeWorkOrder({...order,constraints:[...order.constraints,"different semantics"]})},status:409,responseSchema:"error",errorCode:"IDEMPOTENCY_CONFLICT"});
 await client.request({...command,body:{...request,ownerToken:"invalid-field"},requestSchema:undefined,status:400,responseSchema:"error",errorCode:"INVALID_REQUEST"});expect(f.starts).toEqual([]);
});
it("replays durable events, rejects expired cursor and re-snapshots without duplicate dispatch",async()=>{
 const f=await accepted(),path=`/jobs/${f.receipt.jobId}`,snapshot=await f.client.request({method:"GET",path,status:200,responseSchema:"snapshot"});
 const job=f.service.database.getEntity<JsonValue>("rhiza-job",f.receipt.jobId) as Record<string,JsonValue>;f.service.database.saveEntity("rhiza-job",f.receipt.jobId,{...job,dispatch:{state:"pending",code:"FIXTURE_PROGRESS"}});
 const eventPath=`/events?jobId=${f.receipt.jobId}&cursor=${snapshot.cursor}`,page=await f.client.request({method:"GET",path:eventPath,status:200,responseSchema:"eventPage"});expect(page.events.length).toBeGreaterThan(0);expect(await f.client.request({method:"GET",path:`/events?cursor=${snapshot.cursor}`,status:200,responseSchema:"eventPage"})).toEqual(page);const revision=f.client.revision(f.receipt.jobId);expect(await f.client.request({method:"GET",path:eventPath,status:200,responseSchema:"eventPage"})).toEqual(page);expect(f.client.revision(f.receipt.jobId)).toBe(revision);
 f.clock.now=new Date(f.clock.now.getTime()+25*60*60*1000);await f.client.request({method:"GET",path:eventPath,status:409,responseSchema:"error",errorCode:"CURSOR_EXPIRED"});const fresh=await f.client.request({method:"GET",path,status:200,responseSchema:"snapshot"});expect(fresh.cursor).not.toBe(snapshot.cursor);expect(f.service.database.listCanonicalTasks()).toHaveLength(1);expect(f.starts).toEqual([]);
});
it("cancels queued work once and preserves cleanup access on disable, then denies revoked credentials",async()=>{
 const f=await accepted(),path=`/jobs/${f.receipt.jobId}`,snapshot=await f.client.request({method:"GET",path,status:200,responseSchema:"snapshot"}),body={requestId:"fake-cancel",expectedJobRevision:snapshot.revision,runId:null,generation:f.request.workOrder.origin.generation},command={method:"POST",path:`${path}/cancellations`,requestSchema:"cancellationRequest",body,status:202,responseSchema:"controlReceipt"},receipt=await f.client.request(command);await f.service["rhizaCancellations"].drain();expect(await f.client.request(command)).toEqual(receipt);expect((await f.client.request({method:"GET",path,status:200,responseSchema:"snapshot"})).state).toBe("canceled");
 await f.configure(config=>{config.rhizaIngress!.enabled=false;});await f.client.request({method:"GET",path:`/operations/by-key/${f.request.requestId}`,status:200,responseSchema:"receipt"});await f.client.request({method:"GET",path:"/capabilities",status:503,responseSchema:"error",errorCode:"INGRESS_DISABLED"});
 await f.configure(config=>{config.rhizaIngress!.clients[0]!.enabled=false;});await f.client.request({method:"GET",path,status:401,responseSchema:"error",errorCode:"AUTH_REQUIRED"});expect(f.starts).toEqual([]);
});
it("validates original-session input receipts and rejects stale generation without a second send",async()=>{
 const {f,run,job,payload}=await waitingRhizaJob();opened.push(f);const client=consumer(f.service),path=`/jobs/${job.jobId}/inputs`;
 const command={method:"POST",path,requestSchema:"inputRequest",body:payload,status:202,responseSchema:"controlReceipt"},receipt=await client.request(command);await f.service["rhizaInputs"].drain();expect(await client.request(command)).toEqual(receipt);expect(f.starts()).toBe(2);
 await client.request({...command,body:{...payload,requestId:"stale-generation",runGeneration:run.generation+1},status:409,responseSchema:"error",errorCode:"REVISION_CONFLICT"});expect(f.starts()).toBe(2);
});
it("checks candidate digests and exact run/target/input binding using canonical synthetic provenance",async()=>{
 const f=await rhizaReadJobFixture(true);opened.push(f);seedRhizaCandidate(f);const client=consumer(f.service),path=`/jobs/${f.jobId}`,snapshot=await client.request({method:"GET",path,status:200,responseSchema:"snapshot"});expect(snapshot.state).toBe("candidate");const response=await client.request({method:"GET",path:`${path}/artifacts`,status:200,responseSchema:"artifacts"});expect(response.artifacts).toHaveLength(1);expect(response.artifacts[0].modelEvidence.status).toBe("configuration_confirmed");expect(response.artifacts[0].runId).toBe(f.runId);
});
it("a fresh Controller preserves pinned-client lookup and receipt replay without adopting accepted launches",async()=>{
 const f=await accepted();f.jobs.closeAdmissions();await f.service.stop();const {ControllerService}=await import("../src/service.js"),restarted=new ControllerService({dataDirectory:resolve(f.root,"controller"),ownerToken:"synthetic-owner-rhiza-test",secretStore:f.secrets,clock:()=>f.clock.now});
 try{await restarted.start({listen:false});const client=consumer(restarted);expect(await client.request({method:"GET",path:`/operations/by-key/${f.request.requestId}`,status:200,responseSchema:"receipt"})).toEqual(f.receipt);expect(await client.request({method:"POST",path:"/jobs",requestSchema:"submitRequest",body:f.request,status:202,responseSchema:"receipt"})).toEqual(f.receipt);expect((await client.request({method:"GET",path:`/jobs/${f.receipt.jobId}`,status:200,responseSchema:"snapshot"})).state).toBe("unknown");expect(restarted.database.listEntities("run")).toEqual([]);expect(restarted.database.listCanonicalTasks()).toHaveLength(1);
 }finally{await restarted.stop();}
});
