import { expect, it } from "vitest";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { CredentialContext } from "../src/credential-context.js";

it("invalidates only referenced credentials, before a write and across restart, without persisting values", async () => {
  const database = new DispatcherDatabase(":memory:"), context = new CredentialContext(database);
  const account = { credentialRef: "secret://provider/a", settings: { nested: ["secret://provider/b"] } };
  const original = context.fingerprint(account), other = context.fingerprint({ credentialRef: "secret://provider/c" });
  const gate = Promise.withResolvers<void>();
  const pending = context.change("secret://provider/a", () => gate.promise);
  expect(context.fingerprint(account)).not.toBe(original);
  expect(() => context.assertAvailable(account)).toThrow(expect.objectContaining({ code: "CREDENTIAL_CHANGE_PENDING" }));
  await expect(context.change("secret://provider/a", async () => undefined)).rejects.toMatchObject({ code: "CREDENTIAL_CHANGE_PENDING" });
  const changing = context.fingerprint(account); gate.resolve(); await pending;
  expect(context.fingerprint(account)).not.toBe(changing);
  expect(context.fingerprint({ credentialRef: "secret://provider/c" })).toBe(other);
  expect(new CredentialContext(database).fingerprint(account)).toBe(context.fingerprint(account));
  expect(JSON.stringify(database.listEntities("credential-context"))).not.toContain("secret://");
  database.close();
});

it("keeps prior evidence invalid after a failed or uncertain secret-store write", async () => {
  const database = new DispatcherDatabase(":memory:"), context = new CredentialContext(database), account = { credentialRef: "secret://provider/a" };
  const before = context.fingerprint(account);
  await expect(context.change("secret://provider/a", async () => { throw new Error("store failed"); })).rejects.toThrow("store failed");
  expect(context.fingerprint(account)).not.toBe(before);
  expect(() => context.assertAvailable(account)).not.toThrow();
  expect(new CredentialContext(database).fingerprint(account)).toBe(context.fingerprint(account)); database.close();
});
