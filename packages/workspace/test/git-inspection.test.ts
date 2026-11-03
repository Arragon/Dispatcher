import {expect,it} from "vitest";
import {readWorkspaceStatus} from "../src/git-inspection.js";

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it("starts independent policy reads together and waits for both barriers before status",async()=>{
 const policy=Promise.withResolvers<void>(),gitlinks=Promise.withResolvers<string>(),calls:string[]=[];
 const outcome=readWorkspaceStatus("/fixture",10_000,async args=>{
  calls.push(args[0]!);
  if(args[0]==="config"){await policy.promise;throw Object.assign(Error("absent"),{code:1});}
  if(args[0]==="ls-files"||args[0]==="ls-tree")return gitlinks.promise;
  return "clean";
 }).then(stdout=>({stdout}),error=>({error}));
 try{
  await turn();expect(calls).toEqual(["config","config"]);
  policy.resolve();await turn();expect(calls).toEqual(["config","config","ls-files","ls-tree"]);
  gitlinks.resolve("");expect(await outcome).toEqual({stdout:"clean"});expect(calls.at(-1)).toBe("status");
 }finally{policy.resolve();gitlinks.resolve("");await outcome;}
});
for(const stage of ["policy","gitlinks"] as const)it(`drains the held ${stage} peer before propagating its owner failure`,async()=>{
 const held=Promise.withResolvers<string>(),failure=new Error("OWNER_READ_FAILED"),calls:string[]=[];let settled=false;
 const outcome=readWorkspaceStatus("/fixture",10_000,args=>{
  const command=args[0]!;calls.push(command);
  if(command==="config"){
   if(stage==="policy"){if(args.at(-1)==="^filter\\.")throw failure;return held.promise;}
   return Promise.resolve("");
  }
  if(command==="ls-files"&&stage==="gitlinks")throw failure;
  if(command==="ls-tree"&&stage==="gitlinks")return held.promise;
  return Promise.resolve("");
 }).then(stdout=>{settled=true;return {stdout};},error=>{settled=true;return {error};});
 try{
  await turn();expect(calls).toEqual(stage==="policy"?["config","config"]:["config","config","ls-files","ls-tree"]);expect(settled).toBe(false);
  held.resolve("");const result=await outcome;if(!("error" in result))throw Error("Expected owner failure");expect(result.error).toBe(failure);expect(calls).not.toContain("status");
 }finally{held.resolve("");await outcome;}
});
