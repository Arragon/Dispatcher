import { describe, expect, it, vi } from "vitest";
import { DispatcherDatabase } from "@dispatcher/persistence";
import {
  AnthropicMessagesAdapter,
  AzureOpenAiV1Adapter,
  classifyHttpError,
  LlmRuntime,
  LlmRuntimeError,
  OpenAiChatAdapter,
  OpenAiResponsesAdapter,
  validateLlmConfiguration,
  type FetchLike,
  type LlmAdapterContext,
  type LlmConfiguration,
  type LlmProtocolAdapter,
} from "../src/index.js";

function context(protocol: LlmAdapterContext["endpoint"]["protocol"]): LlmAdapterContext {
  return {
    endpoint: {
      id: protocol,
      protocol,
      baseUrl: "https://llm.example/v1",
      credentialRef: "secret://llm/test",
      ...(protocol === "azure-openai-v1" ? { deployment: "dispatcher", apiVersion: "2025-01-01-preview" } : {}),
    },
    profile: { id: `profile-${protocol}`, endpointId: protocol, alias: protocol, model: "model-a", enabled: true },
    credential: "fixture-credential-value",
  };
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("LLM protocol contracts", () => {
  it.each([
    ["openai-responses", OpenAiResponsesAdapter, { output_text: "{\"ok\":true}", usage: { input_tokens: 2, output_tokens: 3 } }],
    ["openai-chat", OpenAiChatAdapter, { choices: [{ message: { content: "{\"ok\":true}" } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }],
  ] as const)("normalizes %s strict JSON responses without placing credentials in payloads", async (_name, Adapter, fixture) => {
    let requestBody = "";
    const fetcher: FetchLike = vi.fn(async (_input, init) => {
      requestBody = String(init?.body ?? "");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-credential-value");
      return jsonResponse(fixture, 200, { "x-request-id": "req-1" });
    });
    const adapter: LlmProtocolAdapter = new Adapter(fetcher);
    const result = await adapter.invoke({
      messages: [{ role: "user", content: "answer" }],
      jsonSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
    }, context(adapter.protocol));
    expect(result).toMatchObject({ text: "{\"ok\":true}", structured: { ok: true }, usage: { inputTokens: 2, outputTokens: 3 }, providerRequestId: "req-1" });
    expect(requestBody).not.toContain("fixture-credential-value");
  });

  it("normalizes Anthropic and Azure responses while keeping protocol details inside adapters", async () => {
    const seen: string[] = [];
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      seen.push(String(input));
      if (String(input).includes("deployments")) {
        expect(new Headers(init?.headers).get("api-key")).toBe("fixture-credential-value");
        return jsonResponse({ output_text: "azure", usage: { input_tokens: 1, output_tokens: 1 } });
      }
      expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-credential-value");
      return jsonResponse({ content: [{ type: "text", text: "anthropic" }], usage: { input_tokens: 4, output_tokens: 5 } });
    });
    const anthropic = await new AnthropicMessagesAdapter(fetcher).invoke({ messages: [{ role: "user", content: "ping" }] }, context("anthropic-messages"));
    const azure = await new AzureOpenAiV1Adapter(fetcher).invoke({ messages: [{ role: "user", content: "ping" }] }, context("azure-openai-v1"));
    expect(anthropic).toMatchObject({ text: "anthropic", usage: { inputTokens: 4, outputTokens: 5 } });
    expect(azure.text).toBe("azure");
    expect(seen[1]).toContain("/openai/deployments/dispatcher/responses?api-version=");
  });

  it.each([
    [401, { error: { message: "bad key" } }, "AUTHENTICATION"],
    [403, { error: { message: "denied" } }, "FORBIDDEN"],
    [404, { error: { code: "model_not_found" } }, "MODEL_MISSING"],
    [429, { error: { message: "quota exhausted" } }, "QUOTA_EXHAUSTED"],
    [429, { error: { message: "slow down" } }, "RATE_LIMITED"],
    [503, { error: { message: "offline" } }, "PROVIDER_ERROR"],
  ])("classifies HTTP %s deterministically", (status, body, code) => {
    expect(classifyHttpError(status, body)).toMatchObject({ code, fallbackAllowed: true });
  });

  it("rejects malformed and unsupported structured output deterministically", async () => {
    const malformed = new OpenAiResponsesAdapter(async () => jsonResponse({ output: [] }));
    await expect(malformed.invoke({ messages: [{ role: "user", content: "ping" }] }, context("openai-responses"))).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    const anthropic = new AnthropicMessagesAdapter(async () => jsonResponse({ content: [{ text: "{}" }] }));
    await expect(anthropic.invoke({ messages: [], jsonSchema: { type: "object" } }, context("anthropic-messages"))).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
  });
});

function configuration(): LlmConfiguration {
  return {
    endpoints: [
      { id: "primary-endpoint", protocol: "openai-responses", baseUrl: "https://primary.example/v1", credentialRef: "secret://llm/primary" },
      { id: "backup-endpoint", protocol: "openai-chat", baseUrl: "https://backup.example/v1", credentialRef: "secret://llm/backup" },
    ],
    profiles: [
      { id: "primary", endpointId: "primary-endpoint", alias: "Primary", model: "model-a", enabled: true },
      { id: "backup", endpointId: "backup-endpoint", alias: "Backup", model: "model-b", enabled: true },
    ],
    pools: [{ id: "default", profileIds: ["primary", "backup"] }],
    roleBindings: [{ role: "command_parser", poolId: "default" }],
    defaultPoolId: "default",
  };
}

describe("LLM runtime", () => {
  it("validates references, aliases, and URLs", () => {
    expect(validateLlmConfiguration(configuration()).profiles).toHaveLength(2);
    const invalid = configuration();
    invalid.profiles[1]!.alias = "primary";
    expect(() => validateLlmConfiguration(invalid)).toThrow(/Duplicate LLM profile alias/);
  });

  it("falls back, opens a circuit, persists state, and keeps deterministic services alive", async () => {
    const database = new DispatcherDatabase(":memory:");
    const fetcher: FetchLike = vi.fn(async (input) => String(input).includes("primary")
      ? jsonResponse({ error: { message: "provider down" } }, 503)
      : jsonResponse({ choices: [{ message: { content: "backup-ok" } }], usage: {} }));
    const runtime = new LlmRuntime(database, async () => "secret-value", fetcher, { failureThreshold: 1, cooldownMs: 60_000 });
    runtime.configure(configuration());
    const response = await runtime.invoke("command_parser", { messages: [{ role: "user", content: "status" }] });
    expect(response.text).toBe("backup-ok");
    expect(runtime.snapshot().state).toMatchObject({ mode: "ACTIVE", activeProfileByRole: { command_parser: "backup" } });
    expect(runtime.snapshot().state.circuits.primary?.cooldownUntil).toBeDefined();
    const restarted = new LlmRuntime(database, async () => "secret-value", fetcher);
    restarted.configure(configuration());
    expect(restarted.snapshot().state.activeProfileByRole.command_parser).toBe("backup");
    database.close();
  });

  it("rolls back a failed safe switch and enters DEGRADED_NO_LLM when every profile fails", async () => {
    const database = new DispatcherDatabase(":memory:");
    let backupFails = false;
    const fetcher: FetchLike = vi.fn(async (input) => {
      if (String(input).includes("backup") && backupFails) return jsonResponse({ error: { message: "bad key" } }, 401);
      return String(input).includes("responses")
        ? jsonResponse({ output_text: "primary-ok", usage: {} })
        : jsonResponse({ choices: [{ message: { content: "backup-ok" } }], usage: {} });
    });
    const runtime = new LlmRuntime(database, async () => "secret-value", fetcher);
    runtime.configure(configuration());
    await runtime.invoke("command_parser", { messages: [{ role: "user", content: "start" }] });
    backupFails = true;
    await expect(runtime.switchProfile("command_parser", "backup")).rejects.toBeInstanceOf(LlmRuntimeError);
    expect(runtime.snapshot().state.activeProfileByRole.command_parser).toBe("primary");
    const unavailable = new LlmRuntime(database, async () => "secret-value", async () => jsonResponse({ error: { message: "offline" } }, 503), { failureThreshold: 1 });
    unavailable.configure(configuration());
    await expect(unavailable.invoke("command_parser", { messages: [{ role: "user", content: "fail" }] })).rejects.toMatchObject({ code: "NO_AVAILABLE_PROFILE" });
    expect(unavailable.snapshot().state.mode).toBe("DEGRADED_NO_LLM");
    database.close();
  });
});
