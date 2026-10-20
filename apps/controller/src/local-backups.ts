import {lstatSync} from "node:fs";
import {join,resolve} from "node:path";
import {acquireInstanceLock,createDispatcherBackup,restoreDispatcherBackup} from "@dispatcher/persistence";
import {copyStableDatabaseSnapshot} from "./database-snapshot.js";

export async function createLocalDatabaseBackup(dataDirectory:string,bundleDirectory:string){
  const root=resolve(dataDirectory),source=join(root,"dispatcher.sqlite"),file=lstatSync(source);
  if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1)throw Error("DATABASE_PATH_UNSAFE");
  const ownership=acquireInstanceLock(root);
  try{
    const snapshot=copyStableDatabaseSnapshot(source,2*1024*1024*1024);
    try{return {scope:"database-only" as const,secretStoreIncluded:false,nativeStorageIncluded:false,manifest:await createDispatcherBackup(snapshot.path,resolve(bundleDirectory))};}finally{snapshot.close();}
  }finally{ownership.release();}
}
export function restoreLocalDatabase(bundleDirectory:string,targetDirectory:string,options:{execute?:boolean;confirmed?:boolean}={}){
  return restoreDispatcherBackup(resolve(bundleDirectory),resolve(targetDirectory),options);
}
