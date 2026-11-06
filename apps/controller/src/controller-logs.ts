import {closeSync,constants,fstatSync,lstatSync,mkdirSync,openSync,readSync} from "node:fs";
import {isAbsolute} from "node:path";
import {BoundedLogWriter,type LogBudget,stripAnsi} from "@dispatcher/runner";
import {redactValue} from "@dispatcher/observability";

export function createControllerLogDestination(directory:string,budget?:LogBudget):{write(message:string):void}{
  if(!isAbsolute(directory))throw Error("LOG_PATH_UNSAFE");
  mkdirSync(directory,{recursive:true,mode:0o700});
  if(lstatSync(directory).isSymbolicLink())throw Error("LOG_PATH_UNSAFE");
  const writer=new BoundedLogWriter(directory,"controller",budget);
  if(writer.chunkLimitBytes<64)throw Error("LOG_BUDGET_INVALID");
  return {write:message=>{
    for(const line of message.split("\n").filter(Boolean)){
      let safe:string;
      try{safe=JSON.stringify(redactValue(JSON.parse(line)));}catch{safe=JSON.stringify({level:40,msg:"LOG_ENTRY_WITHHELD"});}
      if(Buffer.byteLength(safe)+1>writer.chunkLimitBytes)safe=JSON.stringify({level:40,msg:"LOG_ENTRY_TOO_LARGE"});
      writer.write(safe+"\n");
    }
  }};
}

/** Only complete structured records are displayed; never dump unknown raw stderr. */
export function readControllerLogTail(path:string,lines=100,maxBytes=64*1024):string {
  if(!Number.isSafeInteger(lines)||lines<1||lines>1000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>256*1024)throw Error("LOG_READ_LIMIT_INVALID");
  const original=lstatSync(path);if(!original.isFile()||original.isSymbolicLink()||original.nlink!==1)throw Error("LOG_PATH_UNSAFE");
  const descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const file=fstatSync(descriptor);if(file.dev!==original.dev||file.ino!==original.ino||!file.isFile())throw Error("LOG_PATH_UNSAFE");
    const start=Math.max(0,file.size-maxBytes),buffer=Buffer.alloc(Math.min(file.size,maxBytes));let count=0;
    while(count<buffer.length){const read=readSync(descriptor,buffer,count,buffer.length-count,start+count);if(!read)break;count+=read;}
    let text=buffer.subarray(0,count).toString("utf8");
    if(start>0){const boundary=text.indexOf("\n");text=boundary<0?"":text.slice(boundary+1);}
    const entries=text.endsWith("\n")?text.slice(0,-1).split("\n"):text.split("\n");
    return entries.filter(Boolean).slice(-lines).map(line=>{try{return stripAnsi(JSON.stringify(redactValue(JSON.parse(line))));}catch{return "LOG_ENTRY_WITHHELD";}}).join("\n");
  }finally{closeSync(descriptor);}
}
