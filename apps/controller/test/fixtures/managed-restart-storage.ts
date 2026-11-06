import type {Run} from "@dispatcher/domain";
import {InteractionStore,type DispatcherDatabase} from "@dispatcher/persistence";

export type StoredEdit=readonly [kind:string,path:string,value:unknown];
export function editStored(db:DispatcherDatabase,run:Run,[kind,path,value]:StoredEdit){
 const id=kind==="run"||kind==="run-contract"?run.id:run.sessionId,document=db.getEntity(kind,id) as Record<string,unknown>,keys=path.split(".");let target=document;
 for(const key of keys.slice(0,-1))target=target[key] as Record<string,unknown>;
 const key=keys.at(-1)!;if(value===undefined)delete target[key];else target[key]=value;
 db.handle.prepare("UPDATE entities SET document_json=? WHERE kind=? AND id=?").run(JSON.stringify(document),kind,id);
}
export function replaceBindingCopies(db:DispatcherDatabase,run:Run,field:string,value:unknown){
 const original=new InteractionStore(db).binding(run.sessionId)!,binding={...original,[field]:value};
 db.handle.prepare("UPDATE native_bindings SET binding_key=?,document_json=? WHERE session_id=?").run(JSON.stringify([binding.product,binding.region,binding.nativeStoreRef,binding.nativeSessionId,binding.nativeThreadId??""]),JSON.stringify(binding),run.sessionId);
 for(const kind of ["session","adapter-session"])editStored(db,run,[kind,"nativeBinding",binding]);
 if(field==="nativeSessionId")for(const [kind,path] of [["run","providerSessionId"],["session","nativeSessionId"],["adapter-session","providerSessionId"]])editStored(db,run,[kind!,path!,value]);
 if(field==="backendId")for(const [kind,path] of [["run","executionSelection.backendId"],["adapter-session","executionSelection.backendId"],["adapter-session","backendId"]])editStored(db,run,[kind!,path!,value]);
}
