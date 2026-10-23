import {afterEach,describe,expect,it,vi} from "vitest";
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,realpathSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,relative} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {normalizeOpenCodeCatalog,readOpenCodeCatalog} from "../src/opencode-catalog.js";
import {StructuredCliAdapter,type CliAgentProfile,type CliProviderDefinition} from "../src/ecosystem-cli.js";
import {OpenCodeAdapter} from "../src/native-cli.js";
import * as cleanup from "../src/catalog-process.js";
import {AdapterContractError} from "../src/contracts.js";
import {awaitFixtureReady,fixtureMarker,fixtureOutcome} from "./catalog-fixtures.js";

const context={profileId:"account",runnerId:"local",repositoryId:"repo",executionContextRef:"root",reason:"open" as const};
const model={id:"native/model",providerID:"provider",name:"Native",enabled:true,capabilities:{input:["text"],output:["text"]}};
const owned:Array<string>=[];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const path of owned.splice(0))rmSync(path,{recursive:true,force:true});});
function fixture(routes=""){
 const root=mkdtempSync(join(tmpdir(),"opencode-canonical-"));owned.push(root);
 const workspace=join(root,"workspace"),data=join(root,"data"),executable=join(root,"native"),closed=join(root,"closed"),requests=join(root,"requests");mkdirSync(workspace);mkdirSync(join(data,"opencode"),{recursive:true});
 const database=join(data,"opencode","opencode.db"),db=new DatabaseSync(database);
 db.exec("CREATE TABLE account_state(id TEXT,active_account_id TEXT,active_org_id TEXT);CREATE TABLE account(id TEXT,url TEXT);CREATE TABLE credential(id TEXT,integration_id TEXT,connector_id TEXT,method_id TEXT,active INTEGER,time_updated INTEGER);CREATE TABLE control_account(email TEXT,url TEXT,active INTEGER,time_updated INTEGER)");db.close();vi.stubEnv("XDG_DATA_HOME",data);
 writeFileSync(executable,`#!${process.execPath}\nconst fs=require('node:fs'),http=require('node:http');const model=${JSON.stringify(model)},location={directory:process.cwd(),project:{id:'native-project',directory:process.cwd(),canonical:process.cwd()}};let reads=0;const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),path=url.pathname;fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify({path,query:url.search,authorization:req.headers.authorization,cwd:process.cwd(),pwd:process.env.PWD,pid:process.pid,executable:process.argv[1]})+'\\n');res.setHeader('content-type','application/json');${routes};let response=path==='/api/info'?{version:'2.0.26',pid:process.pid}:path==='/api/location'?location:{location,data:path==='/api/model'?[model]:model};res.end(JSON.stringify(response));});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port})));process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(closed)},'closed');server.close(()=>process.exit(0));});`);chmodSync(executable,0o755);
 return {root,workspace,data,executable,closed,requests,database,input:{profile:{id:"account",alias:"A"},executable,context:{...context},workspacePath:workspace}};
}
function assertClosed(f:ReturnType<typeof fixture>){expect(readFileSync(f.closed,"utf8")).toBe("closed");}

 describe("canonical OpenCode catalog normalization",()=>{
 it("binds actual backend into revision while retaining standalone direct callers",()=>{
  const direct=normalizeOpenCodeCatalog([model],context,"same");
  const server=normalizeOpenCodeCatalog([model],context,"same","opencode-server-v2");
  expect(direct.backendId).toBe("opencode-cli-json");expect(server.backendId).toBe("opencode-server-v2");expect(server.revision).not.toBe(direct.revision);
 });
 it("keeps time and normalized order immaterial but preserves material labels",()=>{
  const other={...model,id:"other"};vi.useFakeTimers();try{const a=normalizeOpenCodeCatalog([model,other],context,"same");vi.setSystemTime(Date.now()+10000);const b=normalizeOpenCodeCatalog([other,model],context,"same");expect(a.fetchedAt).not.toBe(b.fetchedAt);expect(a.revision).toBe(b.revision);expect(normalizeOpenCodeCatalog([{...model,name:"New name"},other],context,"same").revision).not.toBe(a.revision);}finally{vi.useRealTimers();}
 });
 it.each([
  ["empty",[]],["duplicate",[model,model]],["disabled-only",[{...model,enabled:false}]],["empty id",[{...model,id:""}]],["provider slash",[{...model,providerID:"other/provider"}]],["provider variant",[{...model,providerID:"provider#high"}]],["model variant",[{...model,id:"native#high"}]],["DEL",[{...model,name:"private\u007f"}]],["modality array",[{...model,capabilities:{input:"text",output:["text"]}}]],["modality value",[{...model,capabilities:{input:["text",{}],output:["text"]}}]],["non-text only",[{...model,capabilities:{input:["image"],output:["image"]}}]],["4001",Array.from({length:4001},(_,id)=>({...model,id:String(id)}))]
 ])("rejects unsafe or unusable %s inventory",(_name,models)=>{expect(()=>normalizeOpenCodeCatalog(models,context,"same")).toThrow(AdapterContractError);});
 it("retains the existing 4000 model upper boundary",()=>{expect(normalizeOpenCodeCatalog(Array.from({length:4000},(_,id)=>({...model,id:String(id)})),context,"same").entries).toHaveLength(4000);});
 it("publishes only safe enabled text fields with unknown access/effort/billing",()=>{
  const catalog=normalizeOpenCodeCatalog([{...model,headers:{authorization:"private-header"},settings:{directory:"/private/home"},variants:[{id:"high"}],cost:{input:42}}, {...model,id:"off",enabled:false},{...model,id:"image",capabilities:{input:["text"],output:["image"]}}],context,"same");
  expect(catalog.entries).toEqual([{id:"provider/native/model",displayName:"Native",kind:"model",selectable:true,access:"unconfirmed",parameterOptions:{},billing:{mode:"unknown"}}]);expect(JSON.stringify(catalog)).not.toMatch(/private-header|private\/home|variants|settings|cost|isDefault|reasoning/);
 });
 });
 describe("captured OpenCode catalog reader",()=>{
 it("keeps exact owned cwd/PWD/read-only scope, cleans before success, and separates backend identity",async()=>{
  const f=fixture();const standalone=await readOpenCodeCatalog(f.input);assertClosed(f);
  const server=await readOpenCodeCatalog({...f.input,backendId:"opencode-server-v2"});assertClosed(f);
  expect(server).toMatchObject({backendId:"opencode-server-v2",profileId:"account",runnerId:"local",freshness:"native-fresh",entries:[{id:"provider/native/model"}]});expect(server.contextFingerprint).not.toBe(standalone.contextFingerprint);expect(server.revision).not.toBe(standalone.revision);
  const records=readFileSync(f.requests,"utf8").trim().split("\n").map(line=>JSON.parse(line));expect(records.every(r=>r.cwd===realpathSync(f.workspace)&&r.pwd===f.workspace)).toBe(true);expect(records.every(r=>["/api/info","/api/location","/api/model","/api/model/default"].includes(r.path))).toBe(true);expect(records.filter(r=>r.path!=="/api/info").every(r=>new URLSearchParams(r.query).get("location[directory]")===f.workspace)).toBe(true);expect(records.every(r=>r.authorization.startsWith("Basic "))).toBe(true);expect(JSON.stringify(server)).not.toContain(f.root);
 });
 it.each(["opencode-cli-json","opencode-server-v2"])("queries the actual owning OpenCode Adapter %s without native execution",async backendId=>{
  const f=fixture(),adapter=new OpenCodeAdapter({...f.input.profile,executable:f.executable},{backendId,start:()=>{throw Error("execution is forbidden");}});expect(adapter.manifest.backends[0]!.id).toBe(backendId);expect(adapter.supportsExecutionSelection).toBe(true);expect(await adapter.modelCatalog({...context,workspacePath:f.workspace})).toMatchObject({backendId,entries:[{id:"provider/native/model",access:"unconfirmed",parameterOptions:{},billing:{mode:"unknown"}}]});assertClosed(f);
 });
 it.each(["profile","runner","repository","execution","reason","backend"])("rejects invalid %s context before resolver/native I/O",async field=>{
  let resolved=false;const f=fixture(),bad={...f.input,executable:async()=>{resolved=true;return f.executable;},context:{...context},backendId:"opencode-cli-json"};
  if(field==="profile")bad.context.profileId="foreign";if(field==="runner")bad.context.runnerId="";if(field==="repository")bad.context.repositoryId="";if(field==="execution")bad.context.executionContextRef="";if(field==="reason")Object.assign(bad.context,{reason:"invalid"});if(field==="backend")bad.backendId="foreign";
  await expect(readOpenCodeCatalog(bad)).rejects.toMatchObject({code:"NATIVE_CONTEXT_CHANGED"});expect(resolved).toBe(false);expect(existsSync(f.requests)).toBe(false);
 });
 it("rejects a relative effective native account path before account, resolver or native I/O",async()=>{
  const f=fixture();vi.stubEnv("XDG_DATA_HOME",relative(process.cwd(),f.data));const queries=vi.spyOn(DatabaseSync.prototype,"prepare");let resolved=false;
  await expect(readOpenCodeCatalog({...f.input,executable:async()=>{resolved=true;return f.executable;}})).rejects.toMatchObject({code:"OPENCODE_CATALOG_UNAVAILABLE"});expect(queries).not.toHaveBeenCalled();expect(resolved).toBe(false);expect(existsSync(f.requests)).toBe(false);
 });
 it("pins physical workspace before resolver and rejects replacement without spawning",async()=>{
  const f=fixture();let resolved=false;
  await expect(readOpenCodeCatalog({...f.input,executable:async()=>{resolved=true;renameSync(f.workspace,`${f.workspace}-old`);mkdirSync(f.workspace);return f.executable;}})).rejects.toMatchObject({code:"NATIVE_CONTEXT_CHANGED"});expect(resolved).toBe(true);expect(existsSync(f.requests)).toBe(false);
 });
 it("captures original reader callback receiver, context, signal and account environment before suspension",async()=>{
  const f=fixture(),abort=new AbortController(),input={...f.input,backendId:"opencode-server-v2",signal:abort.signal,executable:async function(this:{workspacePath:string}){expect(this).toBe(input);Object.assign(input.context,{profileId:"foreign",runnerId:"other",repositoryId:"changed",executionContextRef:"changed"});input.profile.id="foreign";input.workspacePath="/missing/private";input.backendId="foreign";input.signal=new AbortController().signal;process.env.XDG_DATA_HOME="/missing/private";return f.executable;}};
  expect(await readOpenCodeCatalog(input)).toMatchObject({profileId:"account",runnerId:"local",backendId:"opencode-server-v2"});assertClosed(f);
 });
 it("captures an executable callback property exactly once",async()=>{
  const f=fixture();let reads=0;const input={...f.input,get executable(){reads++;if(reads!==1)throw Error("private getter reread");return async()=>f.executable;}};expect(await readOpenCodeCatalog(input)).toMatchObject({freshness:"native-fresh"});expect(reads).toBe(1);assertClosed(f);
 });
 it("executes the captured physical file rather than a caller alias",async()=>{
  const f=fixture(),alias=join(f.root,"alias");symlinkSync(f.executable,alias);expect(await readOpenCodeCatalog({...f.input,executable:alias})).toMatchObject({freshness:"native-fresh"});expect(readFileSync(f.requests,"utf8").trim().split("\n").map(line=>JSON.parse(line)).every(row=>row.executable===realpathSync(f.executable))).toBe(true);assertClosed(f);
 });
 it("captures Adapter resolver receiver and cloned profile before entering its await",async()=>{
  const f=fixture(),profile:CliAgentProfile={id:"account",alias:"A",executable:f.executable},request={...context,workspacePath:f.workspace};let calls=0;
  const definition:CliProviderDefinition={manifest:new OpenCodeAdapter(profile).manifest,catalogProvider:"opencode",defaultExecutable:f.executable,versionArgs:[],authArgs:[],supportsResume:false,startArgs:()=>[],async resolveExecutable(captured){expect(this).toBe(definition);calls++;await Promise.resolve();profile.id="foreign";profile.executable="/private/missing";request.profileId="foreign";request.runnerId="other";expect(captured).toEqual({id:"account",alias:"A",executable:f.executable});return captured.executable!;}};
  const adapter=new StructuredCliAdapter(definition,profile,{backendId:"opencode-server-v2",start:()=>{throw Error("execution is forbidden");}});
  expect(await adapter.modelCatalog(request)).toMatchObject({profileId:"account",runnerId:"local",backendId:"opencode-server-v2"});expect(calls).toBe(1);assertClosed(f);
 });
 it("pins safe optional native project fields without inventing workspace path semantics",async()=>{
  const f=fixture("location.project={id:'p'.repeat(512),directory:'d'.repeat(512),canonical:'c'.repeat(512)};");expect(await readOpenCodeCatalog(f.input)).toMatchObject({freshness:"native-fresh"});assertClosed(f);
 });
 it.each([undefined,null])("allows absent native default %s without inventing public default",async absent=>{
  const f=fixture(`if(path==='/api/model/default'){res.end(JSON.stringify({location,data:${JSON.stringify(absent)??"undefined"}}));return;}`);const catalog=await readOpenCodeCatalog(f.input);expect(catalog.entries[0]).not.toHaveProperty("isDefault");assertClosed(f);
 });
 it.each(["missing","disabled","variant"])("rejects native default %s outside eligible exact selectors",async kind=>{
  const data=kind==="variant"?{...model,id:"native/model#high"}:{...model,id:kind};
  const inventory=kind==="disabled"?"if(path==='/api/model'){res.end(JSON.stringify({location,data:[model,{...model,id:'disabled',enabled:false}]}));return;}":"";
  const f=fixture(`${inventory}if(path==='/api/model/default'){res.end(JSON.stringify({location,data:${JSON.stringify(data)}}));return;}`);await expect(readOpenCodeCatalog(f.input)).rejects.toMatchObject({code:"OPENCODE_CATALOG_UNAVAILABLE"});assertClosed(f);
 });
 it("makes native default identity material without exposing it",async()=>{
  const f=fixture(`if(path==='/api/model'){res.end(JSON.stringify({location,data:[model,{...model,id:'other'}]}));return;}if(path==='/api/model/default'){res.end(JSON.stringify({location,data:fs.existsSync(${JSON.stringify("REPLACE")})?{...model,id:'other'}:model}));return;}`.replace(JSON.stringify("REPLACE"),"__filename+'.default'"));const a=await readOpenCodeCatalog(f.input);writeFileSync(`${f.executable}.default`,"");const b=await readOpenCodeCatalog(f.input);expect(a.contextFingerprint).not.toBe(b.contextFingerprint);expect(a.revision).not.toBe(b.revision);assertClosed(f);
 });
 it.each([
  ["wrong PID","if(path==='/api/info'){res.end(JSON.stringify({version:'2.0.26',pid:process.pid+1}));return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["late PID change","if(path==='/api/info'&&reads>0){res.end(JSON.stringify({version:'2.0.26',pid:process.pid+1}));return;}if(path==='/api/model')reads++;","OPENCODE_CATALOG_UNAVAILABLE"],
  ["unsupported schema version","if(path==='/api/info'){res.end(JSON.stringify({version:'2.0.22',pid:process.pid}));return;}","NATIVE_VERSION_UNSUPPORTED"],
  ["wrong location","if(path==='/api/location'){res.end(JSON.stringify({...location,directory:'/'}));return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["foreign model project","if(path==='/api/model'){res.end(JSON.stringify({location:{...location,project:{id:'foreign'}},data:[model]}));return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["foreign default project","if(path==='/api/model/default'){res.end(JSON.stringify({location:{...location,project:{id:'foreign'}},data:model}));return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["changed supplied project directory","if(path==='/api/model'){res.end(JSON.stringify({location:{...location,project:{...location.project,directory:'/'}},data:[model]}));return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["changed project","if(path==='/api/location'&&reads>0){res.end(JSON.stringify({...location,project:{...location.project,id:'changed'}}));return;}if(path==='/api/model')reads++;","NATIVE_CONTEXT_CHANGED"],
  ["changed model","if(path==='/api/model'){res.end(JSON.stringify({location,data:[{...model,name:reads++?'changed':'Native'}]}));return;}","NATIVE_CONTEXT_CHANGED"],
  ["bad JSON","if(path==='/api/model'){res.end('private-secret invalid JSON');return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["bad model schema","if(path==='/api/model'){res.end(JSON.stringify({location,data:{private:'secret'}}));return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["unknown native code","if(path==='/api/model'){res.statusCode=500;res.end(JSON.stringify({code:'NATIVE_VERSION_UNSUPPORTED',message:'private-secret'}));return;}","OPENCODE_CATALOG_UNAVAILABLE"],
  ["transport loss","if(path==='/api/model'){req.socket.destroy();return;}","OPENCODE_CATALOG_UNAVAILABLE"]
 ])("fails closed on %s and reaps owned host",async(_name,routes,code)=>{
  const f=fixture(routes);const failure=await readOpenCodeCatalog(f.input).catch(error=>error);expect(failure).toBeInstanceOf(AdapterContractError);expect(failure).toMatchObject({code});expect(failure.message).not.toMatch(/private|secret|canonical-|ENOENT|JSON/);assertClosed(f);
 });
 it.each(["malformed handshake","spawn permission"])("sanitizes %s startup failures and drains its owned process",async kind=>{
  const f=fixture();if(kind==="spawn permission")chmodSync(f.executable,0o644);else writeFileSync(f.executable,`#!${process.execPath}\nconst fs=require('node:fs');process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(f.closed)},'closed');process.exit(0);});process.stderr.write('private-secret stderr');console.log('private-secret invalid handshake');setInterval(()=>{},1000);`);
  const error=await readOpenCodeCatalog(f.input).catch(error=>error);expect(error).toBeInstanceOf(AdapterContractError);expect(error).toMatchObject({code:"OPENCODE_CATALOG_UNAVAILABLE"});expect(error.message).not.toMatch(/private|secret|EACCES/);if(kind==="malformed handshake")assertClosed(f);expect(existsSync(f.requests)).toBe(false);
 });
 it("returns exact cancellation after an admitted read stalls and confirms host cleanup",async()=>{
  const f=fixture("if(path==='/api/info'){fs.writeFileSync(__filename+'.ready','ready');return;}"),abort=new AbortController(),marker=fixtureMarker(`${f.executable}.ready`),outcome=fixtureOutcome(readOpenCodeCatalog({...f.input,signal:abort.signal}));
  try{await awaitFixtureReady(marker.ready,outcome);abort.abort();expect(await outcome).toMatchObject({error:{code:"MODEL_CATALOG_CANCELLED"}});assertClosed(f);}finally{abort.abort();await outcome;marker.close();}
 });
 it("keeps root loss with uncertain cleanup unusable and creates no replacement host",async()=>{
  const f=fixture("if(path==='/api/model'){process.exit(1);return;}"),drain=cleanup.drainCatalogProcess;
  vi.spyOn(cleanup,"drainCatalogProcess").mockImplementation(async(...args)=>{await Promise.allSettled([drain(...args)]);throw new AdapterContractError("MODEL_CATALOG_CLEANUP_UNKNOWN","Native catalog process cleanup could not be confirmed");});
  await expect(readOpenCodeCatalog(f.input)).rejects.toMatchObject({code:"MODEL_CATALOG_CLEANUP_UNKNOWN"});const records=readFileSync(f.requests,"utf8").trim().split("\n").map(line=>JSON.parse(line));expect(records.filter(row=>row.path==="/api/model")).toHaveLength(1);expect(new Set(records.map(row=>row.pid)).size).toBe(1);
 });
 it("rejects account metadata changes while executable resolution is pending",async()=>{
  const f=fixture();await expect(readOpenCodeCatalog({...f.input,executable:async()=>{const db=new DatabaseSync(f.database);db.exec("INSERT INTO account(id,url) VALUES ('changed','https://private.invalid')");db.close();return f.executable;}})).rejects.toMatchObject({code:"NATIVE_CONTEXT_CHANGED"});expect(existsSync(f.requests)).toBe(false);
 });
 it("rejects an unqualified native account schema without starting a host",async()=>{
  const f=fixture(),db=new DatabaseSync(f.database);db.exec("DROP TABLE credential");db.close();await expect(readOpenCodeCatalog(f.input)).rejects.toMatchObject({code:"NATIVE_VERSION_UNSUPPORTED"});expect(existsSync(f.requests)).toBe(false);
 });
 it("honors original cancellation during owned cleanup before returning a late catalog",async()=>{
  const f=fixture(),abort=new AbortController(),drain=cleanup.drainCatalogProcess;vi.spyOn(cleanup,"drainCatalogProcess").mockImplementation(async(...args)=>{await drain(...args);abort.abort();});await expect(readOpenCodeCatalog({...f.input,signal:abort.signal})).rejects.toMatchObject({code:"MODEL_CATALOG_CANCELLED"});assertClosed(f);
 });
 it("bounds empty snapshots at thirty reads and leaves no usable candidate",async()=>{
  const f=fixture("if(path==='/api/model'){res.end(JSON.stringify({location,data:[]}));return;}");await expect(readOpenCodeCatalog(f.input)).rejects.toMatchObject({code:"OPENCODE_CATALOG_UNAVAILABLE"});assertClosed(f);expect(readFileSync(f.requests,"utf8").trim().split("\n").map(line=>JSON.parse(line)).filter(row=>row.path==="/api/model")).toHaveLength(30);
 });
 it.each([new Error("private-secret"),Object.assign(new Error("private-secret"),{code:"NATIVE_VERSION_UNSUPPORTED"}),new AdapterContractError("NATIVE_VERSION_UNSUPPORTED","private-secret"),new AdapterContractError("UNKNOWN_NATIVE_CODE","private-secret")])("sanitizes resolver error %# without reflecting raw diagnostic",async failure=>{
  const f=fixture();const error=await readOpenCodeCatalog({...f.input,executable:async()=>{throw failure;}}).catch(error=>error);expect(error).toBeInstanceOf(AdapterContractError);expect(error.message).not.toContain("private-secret");expect(error.code).toBe(failure instanceof AdapterContractError&&failure.code==="NATIVE_VERSION_UNSUPPORTED"?"NATIVE_VERSION_UNSUPPORTED":"OPENCODE_CATALOG_UNAVAILABLE");expect(existsSync(f.requests)).toBe(false);
 });
 it("sanitizes filesystem errors before a host exists",async()=>{const f=fixture();const error=await readOpenCodeCatalog({...f.input,workspacePath:join(f.root,"private-secret")}).catch(error=>error);expect(error).toBeInstanceOf(AdapterContractError);expect(error).toMatchObject({code:"OPENCODE_CATALOG_UNAVAILABLE"});expect(error.message).not.toContain(f.root);});
 it.each(["success","known failure"])("cleanup uncertainty overrides %s",async kind=>{
  const f=fixture(kind==="known failure"?"if(path==='/api/info'){res.end(JSON.stringify({version:'future',pid:process.pid}));return;}":"");const drain=cleanup.drainCatalogProcess;vi.spyOn(cleanup,"drainCatalogProcess").mockImplementation(async(...args)=>{await drain(...args);throw new AdapterContractError("MODEL_CATALOG_CLEANUP_UNKNOWN","Native catalog process cleanup could not be confirmed");});await expect(readOpenCodeCatalog(f.input)).rejects.toMatchObject({code:"MODEL_CATALOG_CLEANUP_UNKNOWN"});assertClosed(f);
 });
 it.each(["workspace","executable","account"])("rejects %s replacement during confirmed cleanup",async kind=>{
  const f=fixture(),drain=cleanup.drainCatalogProcess;vi.spyOn(cleanup,"drainCatalogProcess").mockImplementation(async(...args)=>{await drain(...args);const path=kind==="workspace"?f.workspace:kind==="executable"?f.executable:f.database;renameSync(path,`${path}.old`);if(kind==="workspace")mkdirSync(path);else if(kind==="executable"){writeFileSync(path,readFileSync(`${path}.old`));chmodSync(path,0o755);}else {const db=new DatabaseSync(path);db.close();}});await expect(readOpenCodeCatalog(f.input)).rejects.toMatchObject({code:"NATIVE_CONTEXT_CHANGED"});assertClosed(f);
 });
 it("spawns the fingerprinted physical binary and rejects later caller alias retargeting",async()=>{
  const f=fixture(),alias=join(f.root,"alias");symlinkSync(f.executable,alias);const drain=cleanup.drainCatalogProcess;vi.spyOn(cleanup,"drainCatalogProcess").mockImplementation(async(...args)=>{await drain(...args);unlinkSync(alias);symlinkSync(process.execPath,alias);});await expect(readOpenCodeCatalog({...f.input,executable:alias})).rejects.toMatchObject({code:"NATIVE_CONTEXT_CHANGED"});assertClosed(f);
 });
 it("retains original cancellation signal despite caller replacement during resolution",async()=>{
  const f=fixture(),abort=new AbortController(),input={...f.input,signal:abort.signal,executable:async()=>{input.signal=new AbortController().signal;abort.abort();return f.executable;}};await expect(readOpenCodeCatalog(input)).rejects.toMatchObject({code:"MODEL_CATALOG_CANCELLED"});expect(existsSync(f.requests)).toBe(false);
 });
 });
