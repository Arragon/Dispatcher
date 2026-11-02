import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ControllerService } from "../src/service.js";

const fixtures: Array<{ root: string; service: ControllerService }> = [];
const owner = { authorization: "Bearer fixture-rhiza-current-owner" };
afterEach(async () => {
  for (const { root, service } of fixtures.splice(0)) {
    await service.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

async function fixture(): Promise<ControllerService> {
  const root = mkdtempSync(join(tmpdir(), "dispatcher-rhiza-current-"));
  const service = new ControllerService({ dataDirectory: root, ownerToken: "fixture-rhiza-current-owner", backgroundWorker: { enabled: false }, logDestination: { write() {} } });
  fixtures.push({ root, service });
  await service.start({ listen: false });
  expect((await service.app.inject({ url: "/api/config", headers: owner })).statusCode).toBe(200);
  return service;
}

it.each([
  { method: "GET" as const, path: "/capabilities", payload: undefined },
  { method: "POST" as const, path: "/handshakes", payload: { protocolVersions: ["1.1"], requiredCapabilities: [], requiredScopes: [] } },
])("current candidate isolates owner authority from RHIZA service identity at $path", async ({ method, path, payload }) => {
  const service = await fixture();
  const response = await service.app.inject({ method, url: `/api/integrations/rhiza/v1${path}`, headers: owner, ...(payload ? { payload } : {}) });
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe("AUTH_REQUIRED");
  expect(service.database.listCanonicalTasks()).toEqual([]);
  expect(service.database.listEntities("run")).toEqual([]);
});
