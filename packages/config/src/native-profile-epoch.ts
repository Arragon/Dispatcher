import {statSync} from "node:fs";
import {isAbsolute,join} from "node:path";
import {homedir} from "node:os";
import type {AgentProfileConfig} from "./schema.js";
/** Call only on the physical owner. Metadata fences native-file changes without reading secrets. */
export function nativeProfileEpoch(profile:AgentProfileConfig){
 const settings=profile.settings??{},paths=[
  typeof settings.executable==="string"&&isAbsolute(settings.executable)?settings.executable:undefined,
  ...(typeof settings.codexHome==="string"?[join(settings.codexHome,"auth.json"),join(settings.codexHome,"config.toml")]:[]),
  ...(typeof settings.configDir==="string"?[join(settings.configDir,"settings.json")]:[]),
  ...(profile.provider==="cursor"?[join(homedir(),".cursor","cli-config.json")]:[]),
 ].filter((path):path is string=>typeof path==="string");
 return paths.map(path=>{try{const s=statSync(path);return {path,size:s.size,mtime:s.mtimeMs,ino:s.ino};}catch{return {path,unavailable:true};}});
}
