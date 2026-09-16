import {
  LlmRuntimeError,
  type LlmAdapterContext,
  type LlmCapabilities,
  type LlmProtocol,
  type LlmProtocolAdapter,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from "./contracts.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function errorText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : record;
  return [nested.type, nested.code, nested.message].filter((entry) => typeof entry === "string").join(" ").toLowerCase();
}

export function classifyHttpError(status: number, body: unknown, retryAfterMs?: number): LlmRuntimeError {
  const detail = errorText(body);
  if (status === 401) return new LlmRuntimeError("AUTHENTICATION", "LLM credential was rejected", false, true);
  if (status === 403) return new LlmRuntimeError("FORBIDDEN", "LLM request is forbidden", false, true);
  if (status === 404 || detail.includes("model_not_found") || detail.includes("deploymentnotfound")) {
    return new LlmRuntimeError("MODEL_MISSING", "Configured LLM model is unavailable", false, true);
  }
  if (status === 429 && /quota|credit|billing/.test(detail)) {
    return new LlmRuntimeError("QUOTA_EXHAUSTED", "LLM quota is exhausted", false, true, retryAfterMs);
  }
  if (status === 429) return new LlmRuntimeError("RATE_LIMITED", "LLM endpoint is rate limited", true, true, retryAfterMs);
  if (status >= 500) return new LlmRuntimeError("PROVIDER_ERROR", "LLM provider is unavailable", true, true, retryAfterMs);
  return new LlmRuntimeError("PROVIDER_ERROR", `LLM request failed with status ${status}`, false, true, retryAfterMs);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmRuntimeError("MALFORMED_RESPONSE", "LLM response is not an object", false, true);
  }
  return value as Record<string, unknown>;
}

function parseStructured(text: string, request: LlmRequest): unknown {
  if (!request.jsonSchema) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new LlmRuntimeError("SCHEMA_MISMATCH", "LLM did not return valid JSON", false, true, undefined, { cause: error });
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

abstract class HttpAdapter implements LlmProtocolAdapter {
  abstract readonly protocol: LlmProtocol;
  abstract readonly capabilities: LlmCapabilities;

  constructor(protected readonly fetcher: FetchLike = fetch) {}

  protected abstract request(context: LlmAdapterContext, request: LlmRequest): { url: string; init: RequestInit };
  protected abstract response(body: Record<string, unknown>, request: LlmRequest, response: Response): LlmResponse;

  async invoke(request: LlmRequest, context: LlmAdapterContext): Promise<LlmResponse> {
    if (request.jsonSchema && !this.capabilities.structuredOutput) {
      throw new LlmRuntimeError("UNSUPPORTED_CAPABILITY", "Protocol does not support strict structured output", false, true);
    }
    if (request.tools?.length && !this.capabilities.tools) {
      throw new LlmRuntimeError("UNSUPPORTED_CAPABILITY", "Protocol does not support tools", false, true);
    }
    const built = this.request(context, request);
    let response: Response;
    try {
      response = await this.fetcher(built.url, {
        ...built.init,
        signal: timeoutSignal(context.signal, context.timeoutMs ?? 15_000),
      });
    } catch (error) {
      if (error instanceof LlmRuntimeError) throw error;
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      throw new LlmRuntimeError(isTimeout ? "TIMEOUT" : "NETWORK", isTimeout ? "LLM request timed out" : "LLM network request failed", true, true, undefined, { cause: error });
    }
    const body = await response.json().catch(() => {
      throw new LlmRuntimeError("MALFORMED_RESPONSE", "LLM response body is not JSON", false, true);
    });
    if (!response.ok) throw classifyHttpError(response.status, body, retryAfter(response));
    return this.response(asObject(body), request, response);
  }
}

function openAiUsage(body: Record<string, unknown>): LlmUsage {
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  return {
    ...(typeof input === "number" ? { inputTokens: input } : {}),
    ...(typeof output === "number" ? { outputTokens: output } : {}),
  };
}

function openAiResponsesText(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  const texts = output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [];
    return content.flatMap((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, unknown>).text as string] : []);
  });
  if (texts.length === 0) throw new LlmRuntimeError("MALFORMED_RESPONSE", "OpenAI response has no text output", false, true);
  return texts.join("");
}

function requestId(response: Response): { providerRequestId: string } | Record<string, never> {
  const value = response.headers.get("x-request-id") ?? response.headers.get("request-id");
  return value ? { providerRequestId: value } : {};
}

export class OpenAiResponsesAdapter extends HttpAdapter {
  readonly protocol: LlmProtocol = "openai-responses";
  readonly capabilities = { structuredOutput: true, tools: true, streaming: false } as const;

  protected request(context: LlmAdapterContext, request: LlmRequest): { url: string; init: RequestInit } {
    const body: Record<string, unknown> = {
      model: context.profile.model,
      input: request.messages,
      max_output_tokens: request.maxOutputTokens,
      temperature: request.temperature,
    };
    if (request.jsonSchema) body.text = { format: { type: "json_schema", name: "dispatcher_output", strict: true, schema: request.jsonSchema } };
    if (request.tools?.length) body.tools = request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: true }));
    return { url: joinUrl(context.endpoint.baseUrl, "responses"), init: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${context.credential}` }, body: JSON.stringify(body) } };
  }

  protected response(body: Record<string, unknown>, request: LlmRequest, response: Response): LlmResponse {
    const text = openAiResponsesText(body);
    return { text, ...(request.jsonSchema ? { structured: parseStructured(text, request) } : {}), usage: openAiUsage(body), ...requestId(response) };
  }
}

export class OpenAiChatAdapter extends HttpAdapter {
  readonly protocol: LlmProtocol = "openai-chat";
  readonly capabilities = { structuredOutput: true, tools: true, streaming: false } as const;

  protected request(context: LlmAdapterContext, request: LlmRequest): { url: string; init: RequestInit } {
    const body: Record<string, unknown> = { model: context.profile.model, messages: request.messages, max_tokens: request.maxOutputTokens, temperature: request.temperature };
    if (request.jsonSchema) body.response_format = { type: "json_schema", json_schema: { name: "dispatcher_output", strict: true, schema: request.jsonSchema } };
    if (request.tools?.length) body.tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: true } }));
    return { url: joinUrl(context.endpoint.baseUrl, "chat/completions"), init: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${context.credential}` }, body: JSON.stringify(body) } };
  }

  protected response(body: Record<string, unknown>, request: LlmRequest, response: Response): LlmResponse {
    const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
    const message = choice && typeof choice === "object" ? (choice as Record<string, unknown>).message : undefined;
    const text = message && typeof message === "object" ? (message as Record<string, unknown>).content : undefined;
    if (typeof text !== "string") throw new LlmRuntimeError("MALFORMED_RESPONSE", "Chat response has no message content", false, true);
    return { text, ...(request.jsonSchema ? { structured: parseStructured(text, request) } : {}), usage: openAiUsage(body), ...requestId(response) };
  }
}

export class AnthropicMessagesAdapter extends HttpAdapter {
  readonly protocol: LlmProtocol = "anthropic-messages";
  readonly capabilities = { structuredOutput: false, tools: true, streaming: false } as const;

  protected request(context: LlmAdapterContext, request: LlmRequest): { url: string; init: RequestInit } {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const messages = request.messages.filter((message) => message.role !== "system");
    const body: Record<string, unknown> = { model: context.profile.model, messages, max_tokens: request.maxOutputTokens ?? 1_024, ...(system ? { system } : {}) };
    if (request.tools?.length) body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
    return { url: joinUrl(context.endpoint.baseUrl, "messages"), init: { method: "POST", headers: { "content-type": "application/json", "x-api-key": context.credential, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) } };
  }

  protected response(body: Record<string, unknown>, _request: LlmRequest, response: Response): LlmResponse {
    const content = Array.isArray(body.content) ? body.content : [];
    const text = content.flatMap((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, unknown>).text as string] : []).join("");
    if (!text) throw new LlmRuntimeError("MALFORMED_RESPONSE", "Anthropic response has no text content", false, true);
    const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
    return { text, usage: { ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}), ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}) }, ...requestId(response) };
  }
}

export class AzureOpenAiV1Adapter extends OpenAiResponsesAdapter {
  override readonly protocol: LlmProtocol = "azure-openai-v1";

  protected override request(context: LlmAdapterContext, request: LlmRequest): { url: string; init: RequestInit } {
    const built = super.request(context, request);
    const path = context.endpoint.deployment ? `openai/deployments/${encodeURIComponent(context.endpoint.deployment)}/responses` : "responses";
    const url = new URL(joinUrl(context.endpoint.baseUrl, path));
    if (context.endpoint.apiVersion) url.searchParams.set("api-version", context.endpoint.apiVersion);
    return { url: url.toString(), init: { ...built.init, headers: { "content-type": "application/json", "api-key": context.credential } } };
  }
}

export function createProtocolAdapter(protocol: LlmProtocol, fetcher: FetchLike = fetch): LlmProtocolAdapter {
  switch (protocol) {
    case "openai-responses": return new OpenAiResponsesAdapter(fetcher);
    case "openai-chat": return new OpenAiChatAdapter(fetcher);
    case "anthropic-messages": return new AnthropicMessagesAdapter(fetcher);
    case "azure-openai-v1": return new AzureOpenAiV1Adapter(fetcher);
  }
}
