import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EncryptedLocalSecretStore,
  MacOsKeychainSecretStore,
  SecretStoreError,
  type CommandExecutor,
} from "../src/index.js";

const temporaryDirectories: string[] = [];
function storePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-secrets-"));
  temporaryDirectories.push(directory);
  return join(directory, "secrets.enc");
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const access = { principal: "controller", purpose: "test" } as const;

describe("EncryptedLocalSecretStore", () => {
  it("stores only ciphertext with mode 0600 and resolves for an authorized consumer", async () => {
    const path = storePath();
    const store = new EncryptedLocalSecretStore(path, "a-secure-test-master-key");
    await store.put("secret://linear/main", "canary-secret-value");
    const file = readFileSync(path, "utf8");
    expect(file).not.toContain("canary-secret-value");
    await expect(store.resolve("secret://linear/main", access)).resolves.toBe("canary-secret-value");
  });

  it("fails closed for unauthorized access and a wrong key", async () => {
    const path = storePath();
    const store = new EncryptedLocalSecretStore(path, "a-secure-test-master-key");
    await store.put("secret://linear/main", "canary-secret-value");
    await expect(store.resolve("secret://linear/main", { principal: "web-user", purpose: "test" })).rejects.toMatchObject({
      code: "SECRET_ACCESS_DENIED",
    });
    const wrong = new EncryptedLocalSecretStore(path, "a-different-master-key");
    await expect(wrong.resolve("secret://linear/main", access)).rejects.toMatchObject({ code: "SECRET_STORE_DECRYPT_FAILED" });
  });

  it("rejects insecure file permissions", async () => {
    const path = storePath();
    const store = new EncryptedLocalSecretStore(path, "a-secure-test-master-key");
    await store.put("secret://linear/main", "canary-secret-value");
    chmodSync(path, 0o644);
    await expect(store.metadata("secret://linear/main")).rejects.toMatchObject({ code: "INSECURE_SECRET_STORE_PERMISSIONS" });
  });
});

describe("MacOsKeychainSecretStore", () => {
  it("passes secret through stdin rather than process arguments", async () => {
    const executor: CommandExecutor = vi.fn(async () => ({ stdout: "canary-secret-value\n", stderr: "" }));
    const store = new MacOsKeychainSecretStore(executor);
    await store.put("secret://linear/main", "canary-secret-value");
    expect(executor).toHaveBeenCalledWith(
      "/usr/bin/security",
      ["add-generic-password", "-U", "-a", "secret://linear/main", "-s", "AgentDispatcher", "-w"],
      "canary-secret-value",
    );
    expect(JSON.stringify((executor as ReturnType<typeof vi.fn>).mock.calls[0]?.[1])).not.toContain("canary-secret-value");
  });

  it("does not silently substitute an unavailable backend", async () => {
    const executor: CommandExecutor = async () => {
      throw new SecretStoreError("KEYCHAIN_COMMAND_FAILED", "unavailable");
    };
    const store = new MacOsKeychainSecretStore(executor);
    await expect(store.put("secret://linear/main", "value")).rejects.toMatchObject({ code: "KEYCHAIN_COMMAND_FAILED" });
  });
});
