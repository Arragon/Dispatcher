import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {RHIZA_PROTOCOL_VERSION,RHIZA_EVENT_SCHEMA_VERSION,RHIZA_SCHEMA_ARTIFACT_VERSION,rhizaV1Schema} from "../src/rhiza-v1.js";
import {examples,semanticVectors} from "../test/fixtures/rhiza-v1.js";
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const args=process.argv.slice(2),check=args.length===1&&args[0]==="--check";
if(!check&&!(args.length===2&&args[0]==="--output"&&args[1]))throw Error("Use --check or --output <directory>");
const output=check?join(packageRoot,"releases/rhiza",RHIZA_SCHEMA_ARTIFACT_VERSION):resolve(args[1]!);
const encode=(value:unknown)=>JSON.stringify(value,null,2)+"\n";
const sha256=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
const files={"schema.json":encode(rhizaV1Schema),"fixtures.json":encode({kind:"synthetic-wire-fixtures",examples,semanticVectors})};
const sources=["src/rhiza-v1.ts","test/fixtures/rhiza-v1.ts","scripts/export-rhiza-contract.ts"];
const manifest=encode({artifactVersion:RHIZA_SCHEMA_ARTIFACT_VERSION,protocolVersion:RHIZA_PROTOCOL_VERSION,eventSchemaVersion:RHIZA_EVENT_SCHEMA_VERSION,synthetic:true,files:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,{sha256:sha256(content),bytes:Buffer.byteLength(content)}])),sources:Object.fromEntries(sources.map(name=>[name,sha256(readFileSync(join(packageRoot,name)))]))});
const generated={...files,"manifest.json":manifest};
if(check){for(const [name,content] of Object.entries(generated))if(readFileSync(join(output,name),"utf8")!==content)throw Error(`CONTRACT_ARTIFACT_STALE:${name}`);}
else{mkdirSync(output,{recursive:true});for(const [name,content] of Object.entries(generated))writeFileSync(join(output,name),content);}
console.log(JSON.stringify({artifactVersion:RHIZA_SCHEMA_ARTIFACT_VERSION,manifestSha256:sha256(manifest),checked:check}));
