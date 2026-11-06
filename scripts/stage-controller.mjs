#!/usr/bin/env node
import {execFile,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readlinkSync,readdirSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const persisted=/^(?:\.dispatcher|\.env(?:\..*)?|\.npmrc|auth\.json|secrets\.enc)$|\.sqlite(?:-wal|-shm|-journal)?$/i;
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function inside(root,path){const name=relative(root,path);return name!=='..'&&!name.startsWith(`..${sep}`)&&!isAbsolute(name);}
export function requireCleanSource(root){
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(sourceSha)||execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim())throw Error('RELEASE_SOURCE_DIRTY: preserve current work and commit the reviewed source before staging');
 return sourceSha;
}
export function copyStageWorkspace(source,workspace,tracked){
 mkdirSync(workspace,{mode:0o700});
 const packages=new Set();
 function copy(input,output){
  if(persisted.test(basename(input)))throw Error('RELEASE_PERSISTED_STATE');
  const stat=lstatSync(input);mkdirSync(dirname(output),{recursive:true,mode:0o700});
  if(stat.isSymbolicLink())symlinkSync(readlinkSync(input),output);
  else if(stat.isFile())copyFileSync(input,output);
  else throw Error('RELEASE_SOURCE_PATH_UNSAFE');
 }
 for(const name of tracked){
  if(isAbsolute(name)||!inside(source,resolve(source,name)))throw Error('RELEASE_SOURCE_PATH_UNSAFE');
  const match=name.match(/^(apps|packages)\/([^/]+)\/package\.json$/);if(match)packages.add(`${match[1]}/${match[2]}`);
  if(['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json'].includes(name)||/^(?:apps|packages)\/[^/]+\/(?:package\.json|src\/.*)$/.test(name))copy(join(source,name),join(workspace,name));
 }
 function copyDist(input,output){for(const name of readdirSync(input)){const from=join(input,name),to=join(output,name);if(persisted.test(name))throw Error('RELEASE_PERSISTED_STATE');if(lstatSync(from).isDirectory()){mkdirSync(to,{recursive:true,mode:0o700});copyDist(from,to);}else copy(from,to);}}
 for(const directory of packages){const dist=join(source,directory,'dist');if(existsSync(dist)){const output=join(workspace,directory,'dist');mkdirSync(output,{recursive:true,mode:0o700});copyDist(dist,output);}}
}
async function run(file,args,cwd){return execute(file,args,{cwd,maxBuffer:8*1024*1024,env:process.env});}
async function smoke(runtime){
 const code=String.raw`
 import {mkdtempSync,rmSync} from 'node:fs'; import {tmpdir} from 'node:os'; import {join} from 'node:path'; import {pathToFileURL} from 'node:url'; import {createRequire} from 'node:module';
 const runtime=process.argv[1],require=createRequire(join(runtime,'package.json'));
 const {ControllerService}=await import(pathToFileURL(join(runtime,'dist/service.js')).href);
 const {ProcessManager}=await import(pathToFileURL(require.resolve('@dispatcher/runner')).href);
 const {databaseWriterProtocol,migrations}=await import(pathToFileURL(require.resolve('@dispatcher/persistence')).href);
 const root=mkdtempSync(join(tmpdir(),'dispatcher-release-smoke-')),manager=new ProcessManager(join(root,'process-logs'));
 const service=new ControllerService({dataDirectory:join(root,'data'),ownerToken:'fixture-release-owner',withRunner:true,backgroundWorker:{enabled:false},logDestination:{write(){}}});
 try{
  await service.start({listen:false});
  const home=await service.app.inject({url:'/'}),ready=await service.app.inject({url:'/ready'});
  if(home.statusCode!==200||!/<!doctype html>/i.test(home.body)||ready.statusCode!==200)throw Error('RELEASE_HTTP_SMOKE_FAILED');
  const asset=home.body.match(/src="([^"]+\.js)"/)?.[1];if(!asset||(await service.app.inject({url:asset})).statusCode!==200)throw Error('RELEASE_ASSET_SMOKE_FAILED');
  const api=await service.app.inject({url:'/api/diagnostics',headers:{authorization:'Bearer fixture-release-owner'}});if(api.statusCode!==200)throw Error('RELEASE_API_SMOKE_FAILED');
  const handle=await manager.start({runId:'release-smoke',file:process.execPath,args:['-e',"console.log('isolated-pty-smoke')"],cwd:root,mode:'pty',timeoutMs:5000});const result=await handle.result();
  if(result.classification!=='success'||!result.stdoutTail.includes('isolated-pty-smoke'))throw Error('RELEASE_PTY_SMOKE_FAILED');
  console.log(JSON.stringify({http:true,asset:true,api:true,pty:true,schemaVersion:migrations.at(-1).version,writerProtocol:databaseWriterProtocol(service.database.handle),scope:'isolated-package-fixture',nativeProviderVerified:false}));
 }finally{await manager.shutdown();await service.stop();rmSync(root,{recursive:true,force:true});}
 `;
 const env={...process.env,NODE_PATH:'',NODE_OPTIONS:''};
 const result=await execute(process.execPath,['--input-type=module','-e',code,runtime],{cwd:runtime,env,maxBuffer:1024*1024,timeout:30000});
 const contract=JSON.parse((await execute(process.execPath,[join(runtime,'dist/cli.js'),'runtime-contract'],{cwd:runtime,env,maxBuffer:64*1024,timeout:5000})).stdout);
 if(contract.releaseAdmissionVersion!==1)throw Error('RELEASE_ADMISSION_UNSUPPORTED');
 return {...JSON.parse(result.stdout.trim()),releaseAdmissionVersion:contract.releaseAdmissionVersion};
}
async function main(){
 const args=process.argv.slice(2),source=resolve(dirname(fileURLToPath(import.meta.url)),'..');if(args[0]==='--')args.shift();
 const helper=()=>import(pathToFileURL(join(source,'apps/controller/dist/release-manifest.js')).href);
 if(args[0]==='verify'){
  const directory=args[1];if(!directory)throw Error('Use stage-controller.mjs verify <release-directory>');
  const verified=(await helper()).verifyControllerRelease(directory);console.log(JSON.stringify({verified:true,sourceSha:verified.manifest.sourceSha,cliPath:verified.cliPath,nodePath:verified.nodePath,smokeScope:verified.manifest.smokeScope,activationAdmission:verified.manifest.version===2&&verified.manifest.releaseAdmissionVersion===1}));return;
 }
 const index=args.indexOf('--out'),output=index>=0?args[index+1]:undefined;
 if(!output||!isAbsolute(output))throw Error('Use pnpm stage:controller --out <new-absolute-release-directory>');
 const sourceSha=requireCleanSource(source),nodePath=realpathSync(process.execPath),pnpmVersion=(await run('pnpm',['--version'],source)).stdout.trim();
 if(inside(source,resolve(output))||resolve(output).includes('/.codex/worktrees/'))throw Error('RELEASE_OUTPUT_UNSAFE');
 mkdirSync(dirname(output),{recursive:true,mode:0o700});const release=join(realpathSync(dirname(output)),basename(output));mkdirSync(release,{mode:0o700});
 writeFileSync(join(release,'release-preparing.json'),JSON.stringify({version:1,sourceSha}),{flag:'wx',mode:0o600});
 const temporary=mkdtempSync(join(tmpdir(),'dispatcher-stage-source-')),workspace=join(temporary,'workspace'),runtime=join(release,'runtime');
 let relocated=false;
 try{
  console.log(JSON.stringify({phase:'build',sourceSha}));await run('pnpm',['build'],source);
  if(requireCleanSource(source)!==sourceSha)throw Error('RELEASE_SOURCE_CHANGED');
  const dependencyState=join(source,'node_modules/.pnpm-workspace-state-v1.json'),dependencyStateHash=existsSync(dependencyState)?sha256(dependencyState):undefined;
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:source,encoding:'utf8'}).split('\0').filter(Boolean);
  copyStageWorkspace(source,workspace,tracked);const lockSha256=sha256(join(workspace,'pnpm-lock.yaml'));
  console.log(JSON.stringify({phase:'isolated-deploy',sourceSha}));
  await run('pnpm',['--dir',workspace,'--filter','@dispatcher/controller','deploy','--prod','--offline','--config.inject-workspace-packages=true','--config.package-import-method=copy',runtime],workspace);
  if(dependencyStateHash!==undefined&&sha256(dependencyState)!==dependencyStateHash)throw Error('RELEASE_SOURCE_DEPENDENCY_STATE_CHANGED');
  const {detachReleaseHardlinks,inspectReleaseRuntime,createControllerReleaseManifest,verifyControllerRelease}=await helper();
  detachReleaseHardlinks(runtime);inspectReleaseRuntime(runtime);
  const moved=join(release,'runtime-relocated');renameSync(runtime,moved);relocated=true;
  console.log(JSON.stringify({phase:'relocated-smoke',sourceSha}));const result=await smoke(moved);renameSync(moved,runtime);relocated=false;
  if(requireCleanSource(source)!==sourceSha)throw Error('RELEASE_SOURCE_CHANGED');
  const manifest=createControllerReleaseManifest(runtime,{sourceSha,nodePath,nodeVersion:process.versions.node,pnpmVersion,lockSha256,deployedLockSha256:sha256(join(runtime,'pnpm-lock.yaml')),platform:process.platform,architecture:process.arch,schemaVersion:result.schemaVersion,writerProtocol:result.writerProtocol,releaseAdmissionVersion:result.releaseAdmissionVersion});
  writeFileSync(join(release,'release.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});rmSync(join(release,'release-preparing.json'));
  const verified=verifyControllerRelease(release);console.log(JSON.stringify({phase:'verified',releaseDirectory:release,cliPath:verified.cliPath,nodePath:verified.nodePath,sourceSha,files:manifest.runtime.files.length,totalBytes:manifest.runtime.totalBytes,sourceDependencyStateUnchanged:true,smoke:result}));
 }catch(error){
  if(relocated&&existsSync(join(release,'runtime-relocated'))&&!existsSync(runtime))renameSync(join(release,'runtime-relocated'),runtime);
  writeFileSync(join(release,'release-failed.json'),JSON.stringify({version:1,sourceSha,reason:'RELEASE_PREPARATION_FAILED'})+'\n',{flag:'wx',mode:0o600});throw error;
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error instanceof Error?error.message:'Release preparation failed');process.exitCode=1;});
