import Ajv from "ajv";
import {expect,it} from "vitest";
import {rhizaV1Schema} from "../src/index.js";
import {examples,workOrder} from "./fixtures/rhiza-v1.js";
const ajv=new Ajv({strict:true,allErrors:true});ajv.addSchema(rhizaV1Schema);
const valid=(name:string,value:unknown)=>Boolean(ajv.getSchema(`${rhizaV1Schema.$id}#/$defs/${name}`)!(value));
const predecessor={jobId:"old-job",expectedJobRevision:7,runId:"old-run",runGeneration:2};
it("binds an explicit predecessor to both work order and immutable acceptance",()=>{
 expect(valid("workOrder",{...workOrder,reassignment:predecessor})).toBe(true);
 expect(valid("receipt",{...examples.receipt,reassignment:predecessor})).toBe(true);
 expect(valid("workOrder",{...workOrder,reassignment:{...predecessor,runId:null}})).toBe(false);
 expect(valid("workOrder",{...workOrder,reassignment:{jobId:"old-job",expectedJobRevision:7,runId:null}})).toBe(true);
 expect(valid("workOrder",{...workOrder,reassignment:{...predecessor,ownerToken:"no"}})).toBe(false);
});
it("distinguishes the revised protocol from legacy peers rather than silently interpreting their schema",()=>{
 expect(valid("handshake",{...examples.handshake,protocolVersion:"1.1",capabilities:["jobs.reassign"]})).toBe(true);
 expect(valid("handshake",{...examples.handshake,protocolVersion:"1.0"})).toBe(false);
});
