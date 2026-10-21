import {createHash,randomUUID} from "node:crypto";
import {accessSync,closeSync,constants,copyFileSync,fstatSync,lstatSync,openSync,readFileSync,readlinkSync,readSync,readdirSync,realpathSync,renameSync,rmSync,type Stats} from "node:fs";
import {isAbsolute,join,relative,sep} from "node:path";
import {isDeepStrictEqual} from "node:util";

interface ReleaseFile {path:string;kind:"file"|"symlink";sha256?:string;bytes?:number;mode?:number;target?:string}
export interface ReleaseMetadata {sourceSha:string;nodePath:string;nodeVersion:string;pnpmVersion:string;lockSha256:string;deployedLockSha256:string;platform:string;architecture:string;schemaVersion:number;writerProtocol:number}
export interface ControllerReleaseManifest extends ReleaseMetadata {
 version:1;kind:"dispatcher-controller-release";createdAt:string;smokeScope:"isolated-package-fixture";
 runtime:{entrypoint:"dist/cli.js";files:ReleaseFile[];totalBytes:number};
}
const persisted=/^(?:\.dispatcher|\.env(?:\..*)?|\.npmrc|auth\.json|secrets\.enc)$|\.sqlite(?:-wal|-shm|-journal)?$/i;
function hashFile(path:string,expected:Stats):string {
 const descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),hash=createHash("sha256"),chunk=Buffer.alloc(64*1024);
 try{
  const before=fstatSync(descriptor);if(!before.isFile()||before.nlink!==1||before.ino!==expected.ino||before.dev!==expected.dev||before.size!==expected.size||before.mtimeMs!==expected.mtimeMs||before.ctimeMs!==expected.ctimeMs)throw Error("RELEASE_CONTENT_CHANGED");
  let position=0;while(position<before.size){const count=readSync(descriptor,chunk,0,Math.min(chunk.length,before.size-position),position);if(!count)throw Error("RELEASE_CONTENT_CHANGED");hash.update(chunk.subarray(0,count));position+=count;}
  const after=fstatSync(descriptor);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.mode!==before.mode||readSync(descriptor,chunk,0,1,position)!==0)throw Error("RELEASE_CONTENT_CHANGED");
  return hash.digest("hex");
 }finally{closeSync(descriptor);}
}
function inside(root:string,path:string):boolean {const value=relative(root,path);return value!==".."&&!value.startsWith(`..${sep}`)&&!isAbsolute(value);}
export function inspectReleaseRuntime(directory:string):{files:ReleaseFile[];totalBytes:number}{
 if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink())throw Error("RELEASE_PATH_UNSAFE");
 const root=realpathSync(directory),files:ReleaseFile[]=[];let totalBytes=0;
 const walk=(path:string)=>{
  for(const name of readdirSync(path).sort()){
   if(persisted.test(name))throw Error("RELEASE_PERSISTED_STATE");
   const file=join(path,name),stat=lstatSync(file),id=relative(root,file).split(sep).join("/");
   if(stat.isSymbolicLink()){
    const target=readlinkSync(file);let resolved:string;
    try{resolved=realpathSync(file);}catch(error){throw Error("RELEASE_BROKEN_SYMLINK",{cause:error});}
    if(!inside(root,resolved))throw Error("RELEASE_SYMLINK_ESCAPE");
    if(isAbsolute(target))throw Error("RELEASE_ABSOLUTE_SYMLINK");
    files.push({path:id,kind:"symlink",target});
   }else if(stat.isDirectory())walk(file);
   else if(stat.isFile()){
    if(stat.nlink!==1)throw Error("RELEASE_HARDLINK_SHARED");
    totalBytes+=stat.size;files.push({path:id,kind:"file",sha256:hashFile(file,stat),bytes:stat.size,mode:stat.mode&0o777});
   }else throw Error("RELEASE_PATH_UNSAFE");
   if(files.length>100_000)throw Error("RELEASE_INVENTORY_LIMIT");
  }
 };
 walk(root);return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),totalBytes};
}
/** Only use on the newly created, inactive release tree owned by this staging run. */
export function detachReleaseHardlinks(directory:string):void {
 if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink())throw Error("RELEASE_PATH_UNSAFE");
 for(const name of readdirSync(directory)){
  const path=join(directory,name),stat=lstatSync(path);
  if(stat.isDirectory())detachReleaseHardlinks(path);
  else if(stat.isFile()&&stat.nlink>1){
   const temporary=`${path}.${randomUUID()}.copy`;
   try{copyFileSync(path,temporary,constants.COPYFILE_EXCL);const current=lstatSync(path);if(current.ino!==stat.ino||current.dev!==stat.dev||current.isSymbolicLink())throw Error("RELEASE_CONTENT_CHANGED");renameSync(temporary,path);}finally{rmSync(temporary,{force:true});}
  }else if(!stat.isFile()&&!stat.isSymbolicLink())throw Error("RELEASE_PATH_UNSAFE");
 }
}
function validMetadata(metadata:ReleaseMetadata):boolean {
 return !!metadata&&/^[a-f0-9]{40}$/.test(metadata.sourceSha)&&[metadata.lockSha256,metadata.deployedLockSha256].every(value=>/^[a-f0-9]{64}$/.test(value))&&typeof metadata.nodePath==="string"&&isAbsolute(metadata.nodePath)&&/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(metadata.nodeVersion)&&typeof metadata.pnpmVersion==="string"&&metadata.pnpmVersion.length>0&&[metadata.schemaVersion,metadata.writerProtocol].every(value=>Number.isSafeInteger(value)&&value>=1);
}
export function createControllerReleaseManifest(runtimeDirectory:string,metadata:ReleaseMetadata):ControllerReleaseManifest {
 if(!validMetadata(metadata))throw Error("RELEASE_METADATA_INVALID");
 const inventory=inspectReleaseRuntime(runtimeDirectory);
 if(JSON.parse(readFileSync(join(runtimeDirectory,"package.json"),"utf8")).name!=="@dispatcher/controller"||!inventory.files.some(file=>file.path==="dist/cli.js"&&file.kind==="file"))throw Error("RELEASE_ENTRYPOINT_MISSING");
 return {...metadata,version:1,kind:"dispatcher-controller-release",createdAt:new Date().toISOString(),smokeScope:"isolated-package-fixture",runtime:{entrypoint:"dist/cli.js",...inventory}};
}
export function verifyControllerRelease(directory:string):{manifest:ControllerReleaseManifest;cliPath:string;nodePath:string}{
 const root=realpathSync(directory);
 for(const marker of ["release-preparing.json","release-failed.json"]){try{lstatSync(join(root,marker));throw Error("RELEASE_NOT_READY");}catch(error){if(!error||typeof error!=="object"||!("code" in error)||error.code!=="ENOENT")throw error;}}
 const path=join(root,"release.json"),file=lstatSync(path);
 if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size>16*1024*1024)throw Error("RELEASE_MANIFEST_INVALID");
 let manifest:ControllerReleaseManifest;
 try{manifest=JSON.parse(readFileSync(path,"utf8")) as ControllerReleaseManifest;}catch(error){throw Error("RELEASE_MANIFEST_INVALID",{cause:error});}
 if(!manifest||manifest.version!==1||manifest.kind!=="dispatcher-controller-release"||manifest.smokeScope!=="isolated-package-fixture"||manifest.runtime?.entrypoint!=="dist/cli.js"||!validMetadata(manifest)||!Array.isArray(manifest.runtime.files)||!Number.isFinite(Date.parse(manifest.createdAt)))throw Error("RELEASE_MANIFEST_INVALID");
 if(manifest.platform!==process.platform||manifest.architecture!==process.arch||manifest.nodePath!==realpathSync(process.execPath)||manifest.nodeVersion!==process.versions.node)throw Error("RELEASE_RUNTIME_MISMATCH");
 accessSync(manifest.nodePath,constants.X_OK);
 const runtime=join(root,"runtime"),inventory=inspectReleaseRuntime(runtime);
 if(!isDeepStrictEqual(inventory.files,manifest.runtime.files)||inventory.totalBytes!==manifest.runtime.totalBytes)throw Error("RELEASE_CONTENT_CHANGED");
 if(JSON.parse(readFileSync(join(runtime,"package.json"),"utf8")).name!=="@dispatcher/controller")throw Error("RELEASE_MANIFEST_INVALID");
 return {manifest,cliPath:join(runtime,"dist","cli.js"),nodePath:manifest.nodePath};
}
