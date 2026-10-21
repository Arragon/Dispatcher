import {expect,it} from "vitest";
import {redactNativeText,REDACTED} from "../src/index.js";
it("redacts credential assignments, flags, short bearer and private-key blocks before native metadata projection",()=>{
 for(const value of ['token=short-private','--api-key short-private','{"client_secret":"short-private"}','Bearer short-private','-----BEGIN PRIVATE KEY-----\nshort-private\n-----END PRIVATE KEY-----']){const result=redactNativeText(value);expect(result).not.toContain('short-private');expect(result).toContain(REDACTED);}
});
it("withholds native auth directories without masking ordinary workspaces or opaque identity hashes",()=>{
 for(const value of ['/Users/person/.codex/auth.json','--codex-home /private/home','/Users/person/.config/opencode/auth.json'])expect(redactNativeText(value)).toContain(REDACTED);
 for(const value of ['/Users/person/work/project','a'.repeat(64),'secret://linear/personal/main'])expect(redactNativeText(value)).toBe(value);
});
