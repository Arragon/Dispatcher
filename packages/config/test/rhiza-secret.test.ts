import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { EncryptedLocalSecretStore } from "../src/index.js";
const directories: string[] = [];
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });
it("keeps RHIZA service credentials in integration authority and denies provider/Runner access", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhiza-secret-")); directories.push(root);
  const store = new EncryptedLocalSecretStore(join(root, "vault"), "isolated-fixture-master-key"), reference = "secret://rhiza/client-a";
  await store.put(reference, "synthetic-service-credential");
  await expect(store.resolve(reference, { principal: "controller", purpose: "integration" })).resolves.toBe("synthetic-service-credential");
  await expect(store.resolve(reference, { principal: "controller", purpose: "provider" })).rejects.toMatchObject({ code: "SECRET_ACCESS_DENIED" });
  await expect(store.resolve(reference, { principal: "runner:local", purpose: "integration" })).rejects.toMatchObject({ code: "SECRET_ACCESS_DENIED" });
});
