export interface PassiveTurnResult<T>{status:"pending"|"ready"|"failed";value?:T;observedAt?:string;refreshing?:boolean}
export function rememberTurnResult<T>(cache:WeakMap<object,PassiveTurnResult<T>>,turn:object,value:T):void{
  try{cache.set(turn,{status:"ready",value:structuredClone(value),observedAt:new Date().toISOString()});}
  catch{if(cache.get(turn)?.status!=="ready")cache.set(turn,{status:"failed"});}
}

/** Observe an already settled legacy result, never await an executing or draining turn. */
export async function readReadyTurnResult<T>(turn:{status():"running"|"completed";result():Promise<T>}|undefined,cache:WeakMap<object,PassiveTurnResult<T>>,poll:boolean):Promise<PassiveTurnResult<T>|undefined>{
  if(!turn)return;
  if(poll&&!cache.get(turn)?.refreshing){
    try{
      if(turn.status()==="completed"){
        cache.set(turn,{...(cache.get(turn)??{status:"pending" as const}),refreshing:true});
        void turn.result().then(value=>rememberTurnResult(cache,turn,value),()=>{const previous=cache.get(turn);cache.set(turn,{status:"failed",...(previous?.value!==undefined?{value:previous.value}:{}),...(previous?.observedAt?{observedAt:previous.observedAt}:{})});});
      }
    }catch{if(cache.get(turn)?.status!=="ready")cache.set(turn,{status:"failed"});}
  }
  // A ready legacy Promise can publish its cache in this microtask. Pending
  // native work is left alone, without a timer or another request while its current read is pending.
  await Promise.resolve();
  return cache.get(turn);
}
export const usageSnapshotUnavailable=()=>({telemetry:{status:"unknown",reasonCode:"USAGE_SNAPSHOT_UNAVAILABLE"}} as const);
