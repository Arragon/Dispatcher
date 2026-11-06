import {closeSync,constants,lstatSync,mkdirSync,openSync,realpathSync} from "node:fs";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";

export const INSTANCE_LOCK_FILE=".controller-instance.sqlite";
export interface InstanceLock {dataDirectory:string;release():void}

/** A separate SQLite transaction holds the OS lock without locking the business database. */
export function acquireInstanceLock(directory:string):InstanceLock {
  mkdirSync(resolve(directory),{recursive:true,mode:0o700});
  const dataDirectory=realpathSync(resolve(directory)),path=join(dataDirectory,INSTANCE_LOCK_FILE);
  let database:DatabaseSync|undefined;
  try{
    try{closeSync(openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600));}catch(error){if(!error||typeof error!=="object"||!("code" in error)||error.code!=="EEXIST")throw error;}
    // Never open/close an extra descriptor for an existing lock inode: POSIX
    // close would release this process's fcntl locks owned by another connection.
    const original=lstatSync(path);
    if(!original.isFile()||original.nlink!==1||process.getuid&&original.uid!==process.getuid())throw Error("INSTANCE_LOCK_UNSAFE");
    database=new DatabaseSync(path,{timeout:0});
    const current=lstatSync(path);
    if(current.isSymbolicLink()||current.dev!==original.dev||current.ino!==original.ino)throw Error("INSTANCE_LOCK_UNSAFE");
    // Do not change journal mode: this dedicated file never uses WAL or stores user data.
    database.exec("BEGIN EXCLUSIVE");
    const owned=database;database=undefined;
    let released=false;
    return {dataDirectory,release(){if(released)return;owned.close();released=true;}};
  }catch(error){
    database?.close();
    const code=error&&typeof error==="object"&&"code" in error?error.code:undefined;
    const errno=error&&typeof error==="object"&&"errcode" in error?error.errcode:undefined;
    if(errno===5||errno===6)throw Error("DATA_DIRECTORY_IN_USE: another Controller or offline operation owns this directory",{cause:error});
    if(code==="ELOOP")throw Error("INSTANCE_LOCK_UNSAFE",{cause:error});
    throw error;
  }
}
