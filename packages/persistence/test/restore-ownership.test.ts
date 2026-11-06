import {existsSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import type * as FileSystem from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {DispatcherDatabase,createDispatcherBackup,restoreDispatcherBackup,acquireInstanceLock} from "../src/index.js";

const race=vi.hoisted(()=>({afterMkdir:undefined as ((path:string)=>void)|undefined}));
vi.mock("node:fs",async importOriginal=>{const fs=await importOriginal<typeof FileSystem>();return {...fs,mkdirSync:(...args:Parameters<typeof fs.mkdirSync>)=>{const result=fs.mkdirSync(...args);race.afterMkdir?.(String(args[0]));return result;}};});
it("leaves a restore target won by another Controller intact instead of copying over its ownership",async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-restore-ownership-"))),source=join(root,"source.sqlite"),bundle=join(root,"bundle"),target=join(root,"restored");let ownership:ReturnType<typeof acquireInstanceLock>|undefined;
 try{
  const db=new DispatcherDatabase(source);db.close();await createDispatcherBackup(source,bundle);
  race.afterMkdir=path=>{if(path===target){race.afterMkdir=undefined;ownership=acquireInstanceLock(target);writeFileSync(join(target,"local-uncommitted.txt"),"preserve new owner work");}};
  expect(()=>restoreDispatcherBackup(bundle,target,{execute:true,confirmed:true})).toThrow("DATA_DIRECTORY_IN_USE");expect(ownership).toBeDefined();expect(existsSync(join(target,"dispatcher.sqlite"))).toBe(false);expect(existsSync(join(target,"dispatcher.sqlite.restore-pending"))).toBe(false);expect(readFileSync(join(target,"local-uncommitted.txt"),"utf8")).toBe("preserve new owner work");
 }finally{race.afterMkdir=undefined;ownership?.release();rmSync(root,{recursive:true,force:true});}
});
