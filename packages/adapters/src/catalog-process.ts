import type {OwnedProcessGroup} from "./owned-process.js";
import {AdapterContractError} from "./contracts.js";

/** Physical ownership and drained callbacks are both required for a usable read. */
export async function drainCatalogProcess(group:OwnedProcessGroup,closed:Promise<void>):Promise<void>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await group.stop();
    const drained=await Promise.race([closed.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),2000);})]);
    if(!drained)throw new Error("Catalog callbacks remain open");
  }catch{throw new AdapterContractError("MODEL_CATALOG_CLEANUP_UNKNOWN","Native catalog process cleanup could not be confirmed");}
  finally{if(timer)clearTimeout(timer);}
}
