import {closeSync,constants,fstatSync,lstatSync,mkdtempSync,openSync,readSync,rmSync,writeSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {isDeepStrictEqual} from "node:util";
import {DatabaseCompatibilityError} from "@dispatcher/persistence";
function present(path:string):boolean {
  try{lstatSync(path);return true;}catch(error){if(error&&typeof error==="object"&&"code" in error&&error.code==="ENOENT")return false;throw error;}
}
export function copyStableDatabaseSnapshot(path:string,maxFileBytes=256*1024*1024):{path:string;close():void}{
  const temporary=mkdtempSync(join(tmpdir(),"dispatcher-doctor-snapshot-")),descriptors:number[]=[],copies:Array<{source:string;fd:number;before:ReturnType<typeof signature>}>=[];
  function signature(fd:number){const value=fstatSync(fd,{bigint:true});return {dev:value.dev,ino:value.ino,size:value.size,mtime:value.mtimeNs,ctime:value.ctimeNs};}
  try{
    if(present(`${path}-journal`))throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_BUSY");
    const hadWal=present(`${path}-wal`);
    for(const source of [path,...(hadWal?[`${path}-wal`]:[])]){
      const fd=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);descriptors.push(fd);copies.push({source,fd,before:signature(fd)});
      const info=fstatSync(fd);if(!info.isFile()||info.nlink!==1||info.size>maxFileBytes)throw new DatabaseCompatibilityError("DIAGNOSTIC_SNAPSHOT_LIMIT");
    }
    const destination=join(temporary,"dispatcher.sqlite"),chunk=Buffer.alloc(64*1024);
    for(const copy of copies){
      const output=openSync(copy.source===path?destination:`${destination}-wal`,"wx",0o600);
      try{let position=0;while(position<Number(copy.before.size)){const count=readSync(copy.fd,chunk,0,Math.min(chunk.length,Number(copy.before.size)-position),position);if(count===0)throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_CHANGED");let written=0;while(written<count)written+=writeSync(output,chunk,written,count-written);position+=count;}}finally{closeSync(output);}
    }
    for(const copy of copies){const current=lstatSync(copy.source,{bigint:true});if(current.isSymbolicLink()||current.dev!==copy.before.dev||current.ino!==copy.before.ino||!isDeepStrictEqual(signature(copy.fd),copy.before))throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_CHANGED");}
    if(hadWal!==present(`${path}-wal`)||present(`${path}-journal`))throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_CHANGED");
    return {path:destination,close:()=>rmSync(temporary,{recursive:true,force:true})};
  }catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
  finally{for(const fd of descriptors)closeSync(fd);}
}
