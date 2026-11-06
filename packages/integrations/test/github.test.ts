import { describe, expect, it } from "vitest";
import { GitHubScmConnector } from "../src/github.js";

function connector(status: Record<string, unknown>, pages: Array<Record<string, unknown>>) {
  const paths: string[] = [];
  const adapter = new GitHubScmConnector({
    instance: { id: "github", definitionId: "scm.github", kind: "scm", displayName: "GitHub", enabled: true, health: "HEALTHY", revision: 1, updatedAt: new Date(0).toISOString() },
    credentialRef: "secret://github/token", resolveSecret: async () => "fixture-token",
    transport: { ensureBranch: async () => undefined, push: async () => ({ commit: "abc" }) },
    fetch: async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname + url.search);
      const value = url.pathname.endsWith("/status") ? status : pages[Number(url.searchParams.get("page") ?? "1") - 1];
      if (!value) throw new Error("Unexpected page");
      return new Response(JSON.stringify(value));
    },
  });
  return { adapter, paths };
}

describe("GitHub CI aggregation", () => {
  it.each([
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [], want: "PENDING" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "success" }], want: "PASSED" },
    { statuses: { state: "success", total_count: 1, statuses: [{ state: "success" }] }, checks: [{ status: "in_progress", conclusion: null }], want: "PENDING" },
    { statuses: { state: "success", total_count: 1, statuses: [{ state: "success" }] }, checks: [{ status: "completed", conclusion: "failure" }], want: "FAILED" },
    { statuses: { state: "failure", total_count: 1, statuses: [{ state: "failure" }] }, checks: [{ status: "queued", conclusion: null }], want: "FAILED" },
    { statuses: { state: "pending", total_count: 1, statuses: [{ state: "pending" }] }, checks: [{ status: "completed", conclusion: "success" }], want: "PENDING" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "cancelled" }], want: "FAILED" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "neutral" }, { status: "completed", conclusion: "skipped" }], want: "PASSED" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "unexpected" }], want: "PENDING" },
  ])("combines statuses and Checks conservatively: $want ($checks)", async ({ statuses, checks, want }) => {
    const { adapter } = connector(statuses, [{ total_count: checks.length, check_runs: checks }]);
    expect((await adapter.getCiStatus({ owner: "acme", name: "repo" }, "abc")).state).toBe(want);
  });

  it("includes check runs on later pages", async () => {
    const { adapter, paths } = connector({ state: "pending", total_count: 0, statuses: [] }, [
      { total_count: 101, check_runs: Array.from({ length: 100 }, () => ({ status: "completed", conclusion: "success" })) },
      { total_count: 101, check_runs: [{ status: "completed", conclusion: "timed_out" }] },
    ]);
    expect((await adapter.getCiStatus({ owner: "acme", name: "repo" }, "abc")).state).toBe("FAILED");
    expect(paths).toContain("/repos/acme/repo/commits/abc/check-runs?filter=latest&per_page=100&page=2");
  });
});

it("qualifies a matching writable repository and base branch through read-only GitHub metadata",async()=>{
 const calls:Array<{url:string;method:string}>=[],adapter=new GitHubScmConnector({instance:{id:"chosen",definitionId:"scm.github",kind:"scm",displayName:"Chosen",enabled:true,health:"HEALTHY",revision:1,updatedAt:new Date().toISOString()},credentialRef:"secret://github/chosen",resolveSecret:async()=>"fixture",transport:{ensureBranch:async()=>{throw new Error("No Git mutation during preflight");},push:async()=>{throw new Error("No push during preflight");}},fetch:async(input,init)=>{const url=new URL(String(input));calls.push({url:url.pathname,method:init?.method??"GET"});return new Response(JSON.stringify(url.pathname.endsWith("/branches/main")?{name:"main",commit:{sha:"a".repeat(40)}}:{full_name:"Acme/Repo",archived:false,disabled:false,permissions:{push:true}}));}});
 expect(await adapter.inspectDeliveryRepository({owner:"acme",name:"repo"},"main")).toEqual({host:"github.com",repository:"acme/repo",baseBranch:"main"});expect(calls).toEqual([{url:"/repos/acme/repo",method:"GET"},{url:"/repos/acme/repo/branches/main",method:"GET"}]);
});
it.each([{full_name:"other/repo",permissions:{push:true}},{full_name:"acme/repo",archived:true,permissions:{push:true}},{full_name:"acme/repo",disabled:true,permissions:{push:true}},{full_name:"acme/repo",permissions:{push:false}},{full_name:"acme/repo"}])("does not qualify a mismatched, disabled or unconfirmed writable repository: %j",async metadata=>{
 const adapter=new GitHubScmConnector({instance:{id:"chosen",definitionId:"scm.github",kind:"scm",displayName:"Chosen",enabled:true,health:"HEALTHY",revision:1,updatedAt:new Date().toISOString()},credentialRef:"secret://github/chosen",resolveSecret:async()=>"fixture",transport:{ensureBranch:async()=>undefined,push:async()=>({commit:"unused"})},fetch:async()=>new Response(JSON.stringify({archived:false,disabled:false,...metadata}))});await expect(adapter.inspectDeliveryRepository({owner:"acme",name:"repo"},"main")).rejects.toMatchObject({code:"PERMANENT"});
});

it.each([{name:"other",commit:{sha:"a".repeat(40)}},{name:"main",commit:{sha:"bad"}},{name:"main"}])("refuses unqualified PR base metadata: %j",async branch=>{
 const adapter=new GitHubScmConnector({instance:{id:"chosen",definitionId:"scm.github",kind:"scm",displayName:"Chosen",enabled:true,health:"HEALTHY",revision:1,updatedAt:new Date().toISOString()},credentialRef:"secret://github/chosen",resolveSecret:async()=>"fixture",transport:{ensureBranch:async()=>undefined,push:async()=>({commit:"unused"})},fetch:async input=>new Response(JSON.stringify(String(input).includes("/branches/")?branch:{full_name:"acme/repo",archived:false,disabled:false,permissions:{push:true}}))});await expect(adapter.inspectDeliveryRepository({owner:"acme",name:"repo"},"main")).rejects.toMatchObject({code:"PERMANENT"});
});
