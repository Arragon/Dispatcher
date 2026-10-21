import {expect,it} from "vitest";
import {redactNativeText,redactNativePayload,redactValue,REDACTED} from "../src/index.js";
it("redacts credential assignments, flags, short bearer and private-key blocks before native metadata projection",()=>{
 for(const value of ['token=short-private','--api-key short-private','{"client_secret":"short-private"}','Bearer short-private','-----BEGIN PRIVATE KEY-----\nshort-private\n-----END PRIVATE KEY-----']){const result=redactNativeText(value);expect(result).not.toContain('short-private');expect(result).toContain(REDACTED);}
});
it("sanitizes nested native evidence without rewriting opaque identities or ordinary logger policy",()=>{
 const input={id:"a".repeat(64),credentialRef:"secret://linear/personal/main",nested:{cookie:"fixture-cookie",codexHome:"/private/native",message:"token=fixture-private"}};
 expect(redactNativePayload(input)).toEqual({id:input.id,credentialRef:input.credentialRef,nested:{cookie:REDACTED,codexHome:REDACTED,message:REDACTED}});
 expect(redactNativePayload({credentialRef:"not-an-opaque-reference"})).toEqual({credentialRef:REDACTED});
 expect(redactValue({cookie:"fixture-cookie"})).toEqual({cookie:"fixture-cookie"});
 expect(input.nested.cookie).toBe("fixture-cookie");
});
it("withholds native auth directories without masking ordinary workspaces or opaque identity hashes",()=>{
 for(const value of ['/Users/person/.codex/auth.json','--codex-home /private/home','/Users/person/.config/opencode/auth.json'])expect(redactNativeText(value)).toContain(REDACTED);
 for(const value of ['/Users/person/work/project','a'.repeat(64),'secret://linear/personal/main'])expect(redactNativeText(value)).toBe(value);
});
