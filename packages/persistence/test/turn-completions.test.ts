import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {DispatcherDatabase,ModelInvocationStore} from "../src/index.js";
const invocation={version:1 as const,id:"turn",sessionId:"session",runId:"run",profileId:"p",backendId:"codex-exec-json",kind:"start" as const,invokedAt:"2026-10-24T10:00:00.000Z",execution:{generation:2,attempt:1,leaseId:"lease"},model:{id:"m",options:{}}};
const proof={version:1 as const,invocationId:"turn",sessionId:"session",runId:"run",profileId:"p",backendId:"codex-exec-json",providerSessionId:"native",producer:"owned-process-group" as const,outcome:"completed" as const,execution:{generation:2,attempt:1,leaseId:"lease"},completedAt:"2026-10-24T10:01:00.000Z"};
it("binds immutable completion to the exact recorded invocation rather than a terminal row",()=>{
 const db=new DispatcherDatabase(":memory:"),store=new ModelInvocationStore(db);try{
  expect(()=>store.appendCompletion(proof)).toThrow("NATIVE_COMPLETION_INVALID");store.append(invocation);
  for(const patch of [{runId:"other"},{sessionId:"other"},{providerSessionId:""},{completedAt:"2026-10-24T09:00:00.000Z"},{execution:{...proof.execution,leaseId:"other"}}])expect(()=>store.appendCompletion({...proof,...patch})).toThrow("NATIVE_COMPLETION_INVALID");
  expect(()=>db.transaction(()=>{store.appendCompletion(proof);throw Error("rollback");})).toThrow("rollback");expect(store.completion("turn")).toBeUndefined();
  store.appendCompletion(proof);store.appendCompletion(structuredClone(proof));expect(store.completion("turn")).toEqual(proof);
  expect(()=>store.appendCompletion({...proof,providerSessionId:"other"})).toThrow("NATIVE_COMPLETION_IMMUTABLE");
  expect(()=>db.handle.exec("UPDATE native_turn_completions SET record_json='{}'")).toThrow("NATIVE_COMPLETION_IMMUTABLE");
  expect(()=>db.handle.exec("DELETE FROM native_turn_completions")).toThrow("NATIVE_COMPLETION_IMMUTABLE");
  expect(()=>db.handle.exec("INSERT OR REPLACE INTO native_turn_completions SELECT * FROM native_turn_completions")).toThrow("NATIVE_COMPLETION_IMMUTABLE");
 }finally{db.close();}
});

it("retains the exact physical drain record across a fresh database connection",()=>{
 const root=mkdtempSync(join(tmpdir(),"native-drain-restart-")),path=join(root,"db");
 try{const db=new DispatcherDatabase(path);try{const store=new ModelInvocationStore(db);store.append(invocation);store.appendCompletion(proof);}finally{db.close();}
 const reopened=new DispatcherDatabase(path);try{expect(new ModelInvocationStore(reopened).completion("turn")).toEqual(proof);}finally{reopened.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
