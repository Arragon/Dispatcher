import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControllerService } from "../src/service.js";
import type { SecretStore } from "@dispatcher/config";
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it("projects full metadata and archives only explicitly with revision and active-run guards", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "dispatcher-console-")); directories.push(dataDirectory);
  const secretStore: SecretStore = { put: async (reference) => ({ reference, backend: "encrypted-local", exists: true }), delete: async () => undefined, test: async () => false, metadata: async (reference) => ({ reference, backend: "encrypted-local", exists: false }), resolve: async () => { throw new Error("not configured"); } };
  const service = new ControllerService({ ownerToken: "console-owner-token-long-enough", dataDirectory, secretStore });
  await service.start({ listen: false });
  const headers = { authorization: "Bearer console-owner-token-long-enough" };
  const now = "2026-10-02T00:00:00Z";
  service.database.writeCanonicalTask("t", 0, { id: "t", projectId: "p", title: "Task", state: "DONE", currentRunId: "r", createdAt: now, updatedAt: now, platformExtensions: { linear: { projectId: "p", projectName: "Dispatcher", projectUrl: "https://linear.app/project/p" } } }, now);
  service.database.saveEntity("run", "r", { id: "r", taskId: "t", profileId: "ronna", state: "COMPLETE", startedAt: now, model: { id: "gpt-x", source: "configuration" }, tokens: { input: 10, output: 3 }, worktree: "/workspace/task" });
  try {
    expect((await service.app.inject({url:"/"})).headers["cache-control"]).toBe("no-cache");
    expect((await service.app.inject({url:"/tasks"})).headers["cache-control"]).toBe("no-cache");
    expect((await service.app.inject({url:"/assets/missing-build.js"})).statusCode).toBe(404);
    const snapshot = (await service.app.inject({headers, url: "/api/fleet"})).json().snapshot;
    expect(snapshot.projects).toContainEqual(expect.objectContaining({ id: "p", name: "Dispatcher", externalRefs: [expect.objectContaining({externalUrl: "https://linear.app/project/p"})] }));
    expect(snapshot.tasks[0].currentRunId).toBe("r");
    service.database.saveTaskContract("t", {version:1,revision:2,goal:"Task",scope:["src"],acceptanceCriteria:[],verification:[],constraints:[],delivery:{type:"none"}});
    service.database.saveEntity("run-contract", "r", {revision:1,goal:"Frozen contract",scope:["original"]});
    const detail=(await service.app.inject({headers,url:"/api/tasks/t"})).json();
    expect(detail).toMatchObject({revision:1,contract:{revision:2},runs:[{id:"r",model:{id:"gpt-x"}}]});
    expect((await service.app.inject({headers,url:"/api/runs/r"})).json().contract).toMatchObject({revision:1,scope:["original"]});

    expect(snapshot.tasks[0].archivedAt).toBeUndefined();
    expect(snapshot.runs[0]).toMatchObject({ model: { id: "gpt-x", source: "configuration" }, tokens: { input: 10, output: 3 }, worktree: "/workspace/task" });
    expect((await service.app.inject({headers, method: "POST", url: "/api/tasks/t/archive", payload: { archived: true, revision: 99, archiveRevision: 0 } })).statusCode).toBe(409);
    expect((await service.app.inject({headers, method: "POST", url: "/api/tasks/t/archive", payload: { archived: true, revision: 1, archiveRevision: 0 } })).statusCode).toBe(200);
    expect((await service.app.inject({headers, url: "/api/fleet"})).json().snapshot.tasks[0].archivedAt).toBeTruthy();
    expect((await service.app.inject({headers, method: "POST", url: "/api/tasks/t/archive", payload: { archived: false, revision: 1, archiveRevision: 0 } })).statusCode).toBe(409);
    expect((await service.app.inject({headers, method: "POST", url: "/api/tasks/t/archive", payload: { archived: false, revision: 1, archiveRevision: 1 } })).statusCode).toBe(200);
    service.database.saveEntity("run", "r", { id: "r", taskId: "t", profileId: "ronna", state: "ACTIVE", startedAt: now });
    expect((await service.app.inject({headers, method: "POST", url: "/api/tasks/t/archive", payload: { archived: true, revision: 1, archiveRevision: 2 } })).statusCode).toBe(409);
  } finally { await service.stop(); }
});

it("presents SSH repository addresses without embedding credentials", async () => {
  const { publicRepositoryAddress } = await import("../src/console-projection.js");
  expect(publicRepositoryAddress("git@github.com:Arragon/Dispatcher.git")).toBe("ssh://github.com/Arragon/Dispatcher.git");
  expect(publicRepositoryAddress("ssh://user:private@host/repo.git?token=private")).toBe("ssh://host/repo.git");
  expect(publicRepositoryAddress("javascript:alert(1)")).toBeUndefined();
});
