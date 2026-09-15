import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { REDACTED, assertExternalPayloadSafe, createLogger, redactValue } from "../src/index.js";

describe("shared redaction", () => {
  it("redacts nested fields and token-shaped strings", () => {
    const value = redactValue({ password: "canary-password", nested: { message: "Bearer abcdefghijklmnop" } });
    expect(value).toEqual({ password: REDACTED, nested: { message: REDACTED } });
  });

  it("retains opaque credential references", () => {
    expect(redactValue({ credentialRef: "secret://linear/main" })).toEqual({ credentialRef: "secret://linear/main" });
  });

  it("refuses secret-like outbound payloads", () => {
    for (const payload of [
      { destination: "linear", text: "sk-test_abcdefghijk" },
      { destination: "slack", authorization: "Bearer abcdefghijklmnop" },
    ]) {
      expect(() => assertExternalPayloadSafe(payload)).toThrowError(
        expect.objectContaining({ code: "SECRET_LIKE_EXTERNAL_PAYLOAD" }),
      );
    }
  });

  it("redacts canaries across nested arrays and common credential keys", () => {
    const canaries = [
      { apiKey: "canary-api-key" },
      { headers: [{ authorization: "Bearer abcdefghijklmnop" }] },
      { nested: { private_key: "canary-private-key" } },
      { tokens: ["ghp_abcdefghijklmno"] },
    ];
    const output = JSON.stringify(redactValue(canaries));
    for (const canary of ["canary-api-key", "abcdefghijklmnop", "canary-private-key", "ghp_abcdefghijklmno"]) {
      expect(output).not.toContain(canary);
    }
  });

  it("redacts logger output", async () => {
    const stream = new PassThrough();
    let output = "";
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
    const logger = createLogger({}, stream);
    logger.info({ token: "canary-token", credentialRef: "secret://linear/main" }, "Bearer abcdefghijklmnop");
    await new Promise((resolve) => setImmediate(resolve));
    expect(output).not.toContain("canary-token");
    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).toContain("secret://linear/main");
  });
});
