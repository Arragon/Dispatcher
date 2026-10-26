#!/usr/bin/env node
import {openSync,readSync,closeSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

/** Preserve raw archive bytes; a bad or absent source must fail the build. */
export function copyNativeCapabilityEvidence(source,target){
 let descriptor;
 try{
  descriptor=openSync(source,"r");const limit=512*1024,buffer=Buffer.alloc(limit+1);let bytes=0;
  while(bytes<buffer.length){const count=readSync(descriptor,buffer,bytes,buffer.length-bytes,null);if(count===0)break;bytes+=count;}
  if(bytes>limit)throw Error("CAPABILITY_ARCHIVE_TOO_LARGE");
  const raw=buffer.subarray(0,bytes),value=JSON.parse(raw.toString("utf8"));
  if(value===null||typeof value!=="object"||value.version!==1||!Array.isArray(value.rows))throw Error("CAPABILITY_ARCHIVE_INVALID");
  writeFileSync(target,raw);
 }finally{if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 copyNativeCapabilityEvidence(new URL("../docs/evidence/native-sessions/capabilities.json",import.meta.url),new URL("../apps/controller/dist/profile-capability-history.json",import.meta.url));
}
