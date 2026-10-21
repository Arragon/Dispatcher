import {spawn} from "node:child_process";
import {expect,it,vi} from "vitest";
import {readNativeDirectoryDialog} from "../src/local-directories.js";
it("keeps cancellation pending until the owned dialog exits and discards late output",async()=>{
 const controller=new AbortController();let child:ReturnType<typeof spawn>|undefined;let ready!:()=>void;const started=new Promise<void>(r=>{ready=r;});
 const pending=readNativeDirectoryDialog(controller.signal,{spawn:()=>{child=spawn(process.execPath,["-e","process.on('SIGTERM',()=>setTimeout(()=>{process.stdout.write('/late/private/path');process.exit(0)},300));process.stdout.write('ready\\n');setInterval(()=>{},1000)"],{detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});child.stdout!.once("data",()=>ready());return child;}});const result=expect(pending).rejects.toThrow("NATIVE_PICKER_CANCELLED");
 await started;controller.abort();let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});await new Promise(r=>setTimeout(r,50));expect(settled).toBe(false);await result;expect(child?.exitCode).toBe(0);if(process.platform!=="win32")expect(()=>process.kill(-child!.pid!,0)).toThrow();
});
it("does not create a dialog after pre-cancellation and bounds output before reporting failure",async()=>{
 const controller=new AbortController();controller.abort();const create=vi.fn();await expect(readNativeDirectoryDialog(controller.signal,{spawn:create})).rejects.toThrow("NATIVE_PICKER_CANCELLED");expect(create).not.toHaveBeenCalled();
 let child:ReturnType<typeof spawn>|undefined;await expect(readNativeDirectoryDialog(new AbortController().signal,{spawn:()=>{child=spawn(process.execPath,["-e","process.stdout.write('sensitive'.repeat(4096));setInterval(()=>{},1000)"],{detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});return child;}})).rejects.toThrow(/^NATIVE_PICKER_UNAVAILABLE$/);if(process.platform!=="win32")expect(()=>process.kill(-child!.pid!,0)).toThrow();
});
it("distinguishes native cancellation from valid selected paths after confirmed close",async()=>{
 const run=(program:string)=>()=>spawn(process.execPath,["-e",program],{detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
 await expect(readNativeDirectoryDialog(new AbortController().signal,{spawn:run("process.stderr.write('User canceled. (-128)');process.exit(1)")})).resolves.toBeUndefined();
 await expect(readNativeDirectoryDialog(new AbortController().signal,{spawn:run("process.stdout.write('/tmp/中文 空格/\\n')")})).resolves.toBe('/tmp/中文 空格/');
});
it("retains UTF-8 paths when native output splits a multibyte character",async()=>{
 const program="const b=Buffer.from('/tmp/中文 空格/\\n');process.stdout.write(b.subarray(0,6));setTimeout(()=>process.stdout.end(b.subarray(6)),30)";
 await expect(readNativeDirectoryDialog(new AbortController().signal,{spawn:()=>spawn(process.execPath,["-e",program],{detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]})})).resolves.toBe('/tmp/中文 空格/');
});
