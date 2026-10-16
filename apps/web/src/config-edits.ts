export interface ConfigurationEdit {op:"add"|"replace"|"remove";path:string;value?:unknown;entityId?:string}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const escaped=(key:string)=>key.replaceAll("~","~0").replaceAll("/","~1");
const identified=(items:unknown[]):items is Array<Record<string,unknown>&{id:string}>=>items.every(item=>object(item)&&typeof item.id==="string")&&new Set(items.map(item=>(item as {id:string}).id)).size===items.length;
/** Diff the displayed baseline; hidden values are never materialized or removed. */
export function configurationEdits(before:unknown,after:unknown):ConfigurationEdit[]{
  const edits:ConfigurationEdit[]=[];
  const push=(op:ConfigurationEdit["op"],path:string,value:unknown,entityId?:string)=>edits.push({op,path,...(op==="remove"?{}:{value:structuredClone(value)}),...(entityId?{entityId}:{})});
  const visit=(previous:unknown,next:unknown,path:string,entityId?:string):void=>{
    if(JSON.stringify(previous)===JSON.stringify(next))return;
    if(Array.isArray(previous)&&Array.isArray(next)&&identified(previous)&&identified(next)){
      const desired=new Map(next.map(entry=>[entry.id,entry]));
      for(let i=previous.length-1;i>=0;i--)if(!desired.has(previous[i]!.id))push("remove",`${path}/${i}`,undefined,previous[i]!.id);
      const retained=previous.filter(entry=>desired.has(entry.id));
      for(const [index,entry] of retained.entries())visit(entry,desired.get(entry.id),`${path}/${index}`,entry.id);
      const original=new Set(previous.map(entry=>entry.id));for(const entry of next)if(!original.has(entry.id))push("add",`${path}/-`,entry,entityId);
      return;
    }
    if(object(previous)&&object(next)){
      for(const key of new Set([...Object.keys(previous),...Object.keys(next)])){
        const location=`${path}/${escaped(key)}`;
        if(!Object.hasOwn(next,key))push("remove",location,undefined,entityId);
        else if(!Object.hasOwn(previous,key))push("add",location,next[key],entityId);
        else visit(previous[key],next[key],location,entityId);
      }
      return;
    }
    push("replace",path,next,entityId);
  };
  visit(before,after,"");return edits;
}
