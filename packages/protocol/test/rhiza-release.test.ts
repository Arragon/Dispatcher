import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {afterEach,expect,it} from "vitest";
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const digest=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
const script=resolve("packages/protocol/scripts/export-rhiza-contract.ts");
function release(){const root=mkdtempSync(join(tmpdir(),"rhiza-contract-release-"));roots.push(root);const result=spawnSync(process.execPath,["--import","tsx",script,"--output",root],{encoding:"utf8"});expect(result.status,result.stderr).toBe(0);return root;}
it("exports a reproducible versioned schema and fixture pack from the sole source",()=>{
 const a=release(),b=release();for(const name of ["manifest.json","schema.json","fixtures.json"])expect(readFileSync(join(a,name))).toEqual(readFileSync(join(b,name)));
 const manifest=JSON.parse(readFileSync(join(a,"manifest.json"),"utf8"));expect(manifest).toMatchObject({artifactVersion:"1.1.0",protocolVersion:"1.1",eventSchemaVersion:"1"});
 for(const name of ["schema.json","fixtures.json"])expect(manifest.files[name].sha256).toBe(digest(readFileSync(join(a,name))));
 expect(existsSync(resolve("packages/protocol/releases/rhiza/1.1.0/manifest.json"))).toBe(true);
 expect(spawnSync(process.execPath,["--import","tsx",script,"--check"],{encoding:"utf8"}).status).toBe(0);
});
it("pins consumer bytes before parsing and refuses a mismatched artifact or changed fixture",async()=>{
 const root=release(),{loadContract}=await import("../../../scripts/rhiza-fake-client.mjs"),pin=digest(readFileSync(join(root,"manifest.json")));
 const contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:pin});expect(contract.validate("handshake",contract.fixtures.examples.handshake)).toBe(true);
 expect(()=>loadContract(root,{artifactVersion:"1.0.0",manifestSha256:pin})).toThrow("ARTIFACT_VERSION_MISMATCH");
 expect(()=>loadContract(root,{artifactVersion:"1.1.0",manifestSha256:"0".repeat(64)})).toThrow("ARTIFACT_DIGEST_MISMATCH");
 writeFileSync(join(root,"fixtures.json"),"{}");expect(()=>loadContract(root,{artifactVersion:"1.1.0",manifestSha256:pin})).toThrow("ARTIFACT_DIGEST_MISMATCH");
});
it("the isolated consumer rejects unknown DTO fields/states and revision regression",async()=>{
 const root=release(),{loadContract,FakeRhizaClient}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))}),snapshot=contract.fixtures.examples.snapshot;
 const responses=[{status:200,body:{...snapshot,revision:2}},{status:200,body:{...snapshot,revision:1}},{status:200,body:{...snapshot,state:"future-success"}},{status:200,body:{...snapshot,ownerToken:"secret"}}];
 const client=new FakeRhizaClient(contract,async()=>responses.shift()!);
 await client.request({method:"GET",path:`/jobs/${snapshot.jobId}`,status:200,responseSchema:"snapshot"});
 await expect(client.request({method:"GET",path:`/jobs/${snapshot.jobId}`,status:200,responseSchema:"snapshot"})).rejects.toThrow("REVISION_REGRESSION");
 for(let i=0;i<2;i++)await expect(client.request({method:"GET",path:`/jobs/${snapshot.jobId}`,status:200,responseSchema:"snapshot"})).rejects.toThrow("INVALID_RESPONSE");
});
it.each(["snapshot","artifacts","eventPage","receipt","controlReceipt"])("rejects a valid %s DTO returned for a different queried authority",async responseSchema=>{
 const root=release(),{loadContract,FakeRhizaClient}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))}),examples=contract.fixtures.examples;
 const spec=responseSchema==="snapshot"?{path:"/jobs/expected",value:examples.snapshot}:responseSchema==="artifacts"?{path:"/jobs/expected/artifacts",value:{schemaVersion:1,jobId:"wrong",artifacts:[]}}:responseSchema==="eventPage"?{path:"/events?jobId=expected&cursor=cursor",value:{schemaVersion:"1",events:[examples.event],cursor:"next",hasMore:false}}:responseSchema==="receipt"?{path:"/operations/by-key/expected",value:examples.receipt}:{path:"/jobs/job-a/inputs",value:{schemaVersion:1,commandId:"command",requestId:"input-a",jobId:"job-a",kind:"cancel",state:"accepted",acceptedAt:"2026-10-22T20:00:00.000Z"}};
 const client=new FakeRhizaClient(contract,async()=>({status:responseSchema==="controlReceipt"?202:200,body:spec.value}));await expect(client.request({method:responseSchema==="controlReceipt"?"POST":"GET",path:spec.path,body:responseSchema==="controlReceipt"?examples.inputRequest:undefined,status:responseSchema==="controlReceipt"?202:200,responseSchema})).rejects.toThrow("OBJECT_BINDING_MISMATCH");
});
it("deduplicates and reorders event observations without reducing authority, and rejects conflicting event IDs",async()=>{
 const root=release(),{loadContract,FakeRhizaClient}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))}),event=contract.fixtures.examples.event;
 const high={...event,eventId:"high",revision:3},low={...event,eventId:"low",revision:2},responses=[{schemaVersion:"1",events:[high,low],cursor:"cursor",hasMore:false},{schemaVersion:"1",events:[low,high],cursor:"cursor",hasMore:false},{schemaVersion:"1",events:[{...high,revision:4}],cursor:"cursor",hasMore:false}],client=new FakeRhizaClient(contract,async()=>({status:200,body:responses.shift()})),command={method:"GET",path:`/events?jobId=${event.jobId}`,status:200,responseSchema:"eventPage"};
 await client.request(command);expect(client.revision(event.jobId)).toBe(3);await client.request(command);expect(client.revision(event.jobId)).toBe(3);await expect(client.request(command)).rejects.toThrow("EVENT_ID_CONFLICT");
});
it("never retries a transport failure or changes the caller's request key",async()=>{
 const root=release(),{loadContract,FakeRhizaClient}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))});let calls=0;const client=new FakeRhizaClient(contract,async()=>{calls++;throw Error("connection lost after send");});
 await expect(client.request({method:"POST",path:"/jobs",body:contract.fixtures.examples.submitRequest,requestSchema:"submitRequest",status:202,responseSchema:"receipt"})).rejects.toThrow("connection lost after send");expect(calls).toBe(1);
});
it("rejects a self-consistent artifact envelope that names a model different from the frozen snapshot target",async()=>{
 const root=release(),{loadContract,FakeRhizaClient,semanticDigest}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))}),example=contract.fixtures.examples,artifact=structuredClone(example.artifact),snapshot={...example.snapshot,state:"candidate",runId:artifact.runId,runGeneration:artifact.generation};
 artifact.modelEvidence.requested.modelId="wrong-model";artifact.modelEvidence.resolved.modelId="wrong-model";artifact.modelEvidence.reported.modelId="wrong-model";const {artifactId,digest:oldDigest,...description}=artifact;expect(artifactId&&oldDigest).toBeTruthy();artifact.digest=semanticDigest(description);
 const responses=[snapshot,{schemaVersion:1,jobId:snapshot.jobId,artifacts:[artifact]}],client=new FakeRhizaClient(contract,async()=>({status:200,body:responses.shift()}));await client.request({method:"GET",path:`/jobs/${snapshot.jobId}`,status:200,responseSchema:"snapshot"});await expect(client.request({method:"GET",path:`/jobs/${snapshot.jobId}/artifacts`,status:200,responseSchema:"artifacts"})).rejects.toThrow("ARTIFACT_BINDING_MISMATCH");
});
it("does not advance an event page partially when a later event conflicts",async()=>{
 const root=release(),{loadContract,FakeRhizaClient}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))}),event=contract.fixtures.examples.event,responses=[{schemaVersion:"1",events:[event],cursor:"cursor",hasMore:false},{schemaVersion:"1",events:[{...event,eventId:"new",revision:4},{...event,revision:3}],cursor:"cursor",hasMore:false}],client=new FakeRhizaClient(contract,async()=>({status:200,body:responses.shift()})),command={method:"GET",path:`/events?jobId=${event.jobId}`,status:200,responseSchema:"eventPage"};
 await client.request(command);await expect(client.request(command)).rejects.toThrow("EVENT_ID_CONFLICT");expect(client.revision(event.jobId)).toBe(2);
});

it("resumes a nonempty cursor-only page and preserves known cursor/job authority across invalid replies",async()=>{
 const root=release(),{loadContract,FakeRhizaClient}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))}),example=contract.fixtures.examples,snapshot=example.snapshot,event=example.event;
 const page={schemaVersion:"1",events:[event],cursor:"next-cursor",hasMore:false},responses=[snapshot,page,{...page,events:[{...event,eventId:"foreign",jobId:"foreign-job",revision:4}]},{...page,events:[{...event,eventId:"future",revision:5},{...event,eventId:"bad",ownerToken:"unknown-field"}]},{...page,events:[]}],client=new FakeRhizaClient(contract,async()=>({status:200,body:responses.shift()}));
 await client.request({method:"GET",path:`/jobs/${snapshot.jobId}`,status:200,responseSchema:"snapshot"});const command={method:"GET",path:`/events?cursor=${snapshot.cursor}`,status:200,responseSchema:"eventPage"};expect(await client.request(command)).toEqual(page);expect(client.revision(snapshot.jobId)).toBe(2);
 await expect(client.request(command)).rejects.toThrow("OBJECT_BINDING_MISMATCH");expect(client.revision("foreign-job")).toBe(0);
 await expect(client.request(command)).rejects.toThrow("INVALID_RESPONSE");expect(client.revision(snapshot.jobId)).toBe(2);
 await expect(client.request({...command,path:`/events?cursor=next-cursor&jobId=foreign-job`})).rejects.toThrow("OBJECT_BINDING_MISMATCH");
});
it("permits an unknown opaque cursor-only resume without decoding or inventing its original filter",async()=>{
 const root=release(),{loadContract,FakeRhizaClient}=await import("../../../scripts/rhiza-fake-client.mjs"),contract=loadContract(root,{artifactVersion:"1.1.0",manifestSha256:digest(readFileSync(join(root,"manifest.json")))}),event=contract.fixtures.examples.event,page={schemaVersion:"1",events:[event],cursor:"resumed-cursor",hasMore:false},client=new FakeRhizaClient(contract,async()=>({status:200,body:page}));
 expect(await client.request({method:"GET",path:"/events?cursor=previous-process-cursor",status:200,responseSchema:"eventPage"})).toEqual(page);expect(client.revision(event.jobId)).toBe(event.revision);
});
