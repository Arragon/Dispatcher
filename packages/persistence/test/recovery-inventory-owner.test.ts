import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {DispatcherDatabase,readRecoveryInventoryFromDatabase} from "../src/index.js";

it("reads recovery inventory through the current owner without releasing its outer SQLite writer lock",()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-recovery-owner-")),path=join(root,"dispatcher.sqlite"),database=new DispatcherDatabase(path);
 try{
  database.handle.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
  database.transaction(()=>{
   database.saveEntity("native-runtime","saved",{pid:process.pid,ownership:"owned",settings:{token:"fixture-private-canary"}});
   const inventory=readRecoveryInventoryFromDatabase(database);expect(inventory.processes).toEqual([{kind:"native-runtime",id:"saved",pid:process.pid,claimedOwnership:"owned",ownership:"unverified",orphan:true}]);expect(JSON.stringify(inventory)).not.toContain("fixture-private-canary");expect(database.handle.isTransaction).toBe(true);
   const script="const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{timeout:50});try{db.exec('BEGIN IMMEDIATE');console.log('WRITER_ACQUIRED');db.exec('ROLLBACK');}catch(error){if(error.errcode===5||error.errcode===6)console.log('WRITER_BLOCKED');else throw error;}finally{db.close();}";
   const writer=spawnSync(process.execPath,["-e",script,path],{encoding:"utf8",timeout:5000});expect(writer.status,writer.stderr).toBe(0);expect(writer.stdout.trim()).toBe("WRITER_BLOCKED");expect(database.getEntity("native-runtime","saved")).toMatchObject({pid:process.pid});
  });
  expect(database.handle.isTransaction).toBe(false);expect(database.getEntity("native-runtime","saved")).toMatchObject({pid:process.pid});
 }finally{database.close();rmSync(root,{recursive:true,force:true});}
});
