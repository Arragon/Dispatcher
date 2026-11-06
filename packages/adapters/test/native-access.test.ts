import { expect, it } from "vitest";
import type { NativeBinding } from "@dispatcher/domain";
import { resolveNativeAccess, type NativeAccessViewerContext } from "../src/native-access.js";
const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"native",runnerId:"runner",nativeStoreRef:"store",nativeSessionId:"session",executionRefId:"execution",identityState:"bound"};
const evidence={version:1 as const,support:"supported" as const,level:"ui-roundtrip-verified" as const,scopeFingerprint:"scope",evidenceRef:"proof",verifiedAt:"2026-10-07T18:00:00Z"};
function fixture():NativeAccessViewerContext {return {runnerHostId:"host",viewerHostId:"host",scopeFingerprint:"scope",workspaceRef:"workspace:work",executionRefId:"execution",registrations:[{id:"entry",binding,surface:"web",target:"session",evidence,action:{kind:"web",url:"https://native.example/session/session",redirects:"none",credentials:"none"}}],policy:{webEntries:[{origin:"https://native.example",pathname:"/session/session"}],launchers:[]}};}
it("returns only an exact qualified session entry from a separate URL allowlist",()=>{
 const result=resolveNativeAccess(binding,fixture());expect(result).toHaveLength(1);expect(result[0]).toMatchObject({nativeSessionId:"session",availability:"verified",reasonCode:"NATIVE_SESSION_ENTRY_VERIFIED",action:{kind:"web-url",url:"https://native.example/session/session"}});
});
it.each(["https://native.example/session/session?token=secret","https://user:password@native.example/session/session","https://native.example/session/session#pairing-token","javascript:alert(1)","file:///tmp/session","https://untrusted.example/session/session","https://native.example/admin","https://127.0.0.2/session","https://169.254.169.254/session"])("rejects unsafe or unregistered URL %s without disclosing it",url=>{
 const ctx=fixture();ctx.registrations[0]!.action={kind:"web",url,redirects:"none",credentials:"none"};const result=resolveNativeAccess(binding,ctx);expect(result.every(entry=>entry.action.kind==="instructions")).toBe(true);expect(JSON.stringify(result)).not.toContain(url);expect(JSON.stringify(result)).not.toContain("password");
});
it("never gives a remote or unknown-host viewer a Runner loopback link",()=>{
 const ctx=fixture();ctx.registrations[0]!.action={kind:"web",url:"http://127.0.0.1:8123/session",redirects:"none",credentials:"none"};ctx.policy.webEntries=[{origin:"http://127.0.0.1:8123",pathname:"/session"}];expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("web-url");ctx.viewerHostId="phone";expect(resolveNativeAccess(binding,ctx)[0]).toMatchObject({reasonCode:"NATIVE_ACCESS_RUNNER_HOST_REQUIRED",action:{kind:"instructions"}});delete ctx.viewerHostId;expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");
});
it("requires known no-redirect qualification and stronger proof for exact session access",()=>{
 const ctx=fixture();ctx.registrations[0]!.action={kind:"web",url:"https://native.example/session/session",redirects:"unknown",credentials:"none"};expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");ctx.registrations[0]!.action={kind:"web",url:"https://native.example/session/session",redirects:"none",credentials:"none"};ctx.registrations[0]!.evidence={...evidence,level:"runtime-verified"};expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");
});
it("labels project/app entries explicitly without presenting them as exact session links",()=>{
 const ctx=fixture();ctx.registrations[0]!.target="project";const result=resolveNativeAccess(binding,ctx);expect(result[0]!.reasonCode).toBe("NATIVE_PROJECT_ENTRY_ONLY");expect(result[1]!.action).toMatchObject({kind:"instructions",text:expect.stringContaining("project entry")});ctx.registrations[0]!.target="application";expect(resolveNativeAccess(binding,ctx)[0]!.reasonCode).toBe("NATIVE_APPLICATION_ENTRY_ONLY");
});
it("uses a registered fixed executable/argv/workspace and keeps arguments literal",()=>{
 const ctx=fixture();const args=["resume","session; echo literal"];ctx.registrations[0]!.action={kind:"launch",launcherId:"codex-session"};ctx.registrations[0]!.surface="tui";ctx.policy.launchers=[{id:"codex-session",binding,executableKey:"codex",args,workspaceRef:"workspace:work",target:"session"}];const result=resolveNativeAccess(binding,ctx);expect(result[0]!.action).toEqual({kind:"local-launch",launcherId:"codex-session",args});expect(result[0]!.action).not.toHaveProperty("shell");args.push("mutated");expect((result[0]!.action as {args:string[]}).args).toHaveLength(2);ctx.viewerHostId="phone";expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");
});
it("rejects mismatched launcher workspace, binding, or a shell launcher",()=>{
 const ctx=fixture();ctx.registrations[0]!.action={kind:"launch",launcherId:"launcher"};ctx.policy.launchers=[{id:"launcher",binding,executableKey:"codex",args:["resume","session"],workspaceRef:"workspace:foreign",target:"session"}];expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");ctx.policy.launchers[0]!.workspaceRef="workspace:work";ctx.policy.launchers[0]!.executableKey="sh";expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");ctx.policy.launchers[0]!.executableKey="codex";ctx.policy.launchers[0]!.binding={...binding,profileId:"foreign"};expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");
});
it("does not reuse foreign scope/profile/store or deleted native identity",()=>{
 const ctx=fixture();ctx.registrations[0]!.binding={...binding,nativeStoreRef:"foreign"};expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");ctx.registrations[0]!.binding=binding;ctx.registrations[0]!.evidence={...evidence,scopeFingerprint:"foreign"};expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");expect(resolveNativeAccess({...binding,identityState:"deleted"},fixture())[0]!.action.kind).toBe("instructions");
});
it("gives a bounded host-specific explanation when no verified entry exists",()=>{
 const ctx=fixture();ctx.registrations=[];const result=resolveNativeAccess(binding,ctx);expect(result).toHaveLength(1);expect(result[0]).toMatchObject({availability:"unsupported",action:{kind:"instructions",text:expect.stringContaining("runner")}});expect(JSON.stringify(result)).not.toContain("store");expect(JSON.stringify(result)).not.toContain("codex://");
});

it("rejects pairing flows, credential paths and credential-bearing literal argv",()=>{
 const ctx=fixture();ctx.registrations[0]!.action={kind:"web",url:"https://native.example/session/session",redirects:"none",credentials:"pairing"};expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");
 ctx.registrations[0]!.action={kind:"web",url:"https://native.example/pairing/one-time-code",redirects:"none",credentials:"none"};ctx.policy.webEntries=[{origin:"https://native.example",pathname:"/pairing/one-time-code"}];expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");
 ctx.registrations[0]!.action={kind:"launch",launcherId:"launcher"};ctx.policy.launchers=[{id:"launcher",binding,executableKey:"codex",args:["--api-key","short-private-value"],workspaceRef:"workspace:work",target:"session"}];const result=resolveNativeAccess(binding,ctx);expect(result[0]!.action.kind).toBe("instructions");expect(JSON.stringify(result)).not.toContain("short-private-value");
});
it("handles a trailing-dot loopback host according to the actual viewer host",()=>{
 const ctx=fixture();ctx.viewerHostId="phone";ctx.registrations[0]!.action={kind:"web",url:"http://localhost.:8123/session",redirects:"none",credentials:"none"};ctx.policy.webEntries=[{origin:"http://localhost.:8123",pathname:"/session"}];expect(resolveNativeAccess(binding,ctx)[0]!.action.kind).toBe("instructions");
});
it.each([{args:["--access-token","synthetic-value"]},{args:["--client-secret","synthetic-value"]},{args:["access_token=synthetic-value"]},{args:["--token-file","private-file"]}])("refuses known prefixed credentials in argv %j",({args})=>{
 const ctx=fixture();ctx.registrations[0]!.action={kind:"launch",launcherId:"launcher"};ctx.policy.launchers=[{id:"launcher",binding,executableKey:"codex",args,workspaceRef:"workspace:work",target:"session"}];const result=resolveNativeAccess(binding,ctx);expect(result[0]!.action.kind).toBe("instructions");expect(JSON.stringify(result)).not.toContain(args.at(-1));
});
it("keeps generated instruction IDs unique when a registration has that suffix",()=>{
 const ctx=fixture();ctx.registrations[0]!.target="project";ctx.registrations.push({...ctx.registrations[0]!,id:"entry:instructions",target:"session"});const result=resolveNativeAccess(binding,ctx);expect(new Set(result.map(item=>item.id)).size).toBe(result.length);
});
