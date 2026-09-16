export type LlmProtocol = "openai-responses" | "openai-chat" | "anthropic-messages" | "azure-openai-v1";

export type LlmRole = "command_parser" | "config_assistant" | "runtime_summarizer" | "error_classifier";

export type LlmHealthStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "AUTH_ERROR"
  | "MODEL_UNAVAILABLE"
  | "PROVIDER_DOWN"
  | "COOLDOWN"
  | "DISABLED"
  | "UNKNOWN";

export type LlmErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "AUTHENTICATION"
  | "FORBIDDEN"
  | "PROVIDER_ERROR"
  | "MALFORMED_RESPONSE"
  | "SCHEMA_MISMATCH"
  | "MODEL_MISSING"
  | "UNSUPPORTED_CAPABILITY"
  | "NO_AVAILABLE_PROFILE";

export interface LlmEndpoint {
  id: string;
  protocol: LlmProtocol;
  baseUrl: string;
  credentialRef: string;
  deployment?: string;
  apiVersion?: string;
}

export interface LlmProfile {
  id: string;
  endpointId: string;
  alias: string;
  model: string;
  enabled: boolean;
}

export interface LlmPool {
  id: string;
  profileIds: string[];
}

export interface LlmRoleBinding {
  role: LlmRole;
  poolId: string;
}

export interface LlmConfiguration {
  endpoints: LlmEndpoint[];
  profiles: LlmProfile[];
  pools: LlmPool[];
  roleBindings: LlmRoleBinding[];
  defaultPoolId?: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  messages: LlmMessage[];
  jsonSchema?: Record<string, unknown>;
  tools?: LlmToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmResponse {
  text: string;
  structured?: unknown;
  usage: LlmUsage;
  providerRequestId?: string;
}

export interface LlmCapabilities {
  structuredOutput: boolean;
  tools: boolean;
  streaming: boolean;
}

export interface LlmHealthRecord {
  profileId: string;
  status: LlmHealthStatus;
  checkedAt: string;
  source: "explicit" | "startup" | "lazy" | "request" | "circuit";
  reason?: string;
  retryAfterMs?: number;
  capabilities: LlmCapabilities;
}

export interface LlmCircuitState {
  failures: number;
  openedAt?: string;
  cooldownUntil?: string;
  consecutiveRecoveryProbes: number;
}

export interface LlmRuntimeState {
  mode: "ACTIVE" | "DEGRADED_NO_LLM";
  activeProfileByRole: Partial<Record<LlmRole, string>>;
  healthByProfile: Record<string, LlmHealthRecord>;
  circuits: Record<string, LlmCircuitState>;
  updatedAt: string;
}

export interface LlmAdapterContext {
  endpoint: LlmEndpoint;
  profile: LlmProfile;
  credential: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmProtocolAdapter {
  readonly protocol: LlmProtocol;
  readonly capabilities: LlmCapabilities;
  invoke(request: LlmRequest, context: LlmAdapterContext): Promise<LlmResponse>;
}

export class LlmRuntimeError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly fallbackAllowed: boolean,
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LlmRuntimeError";
  }
}
