import type { ErrorObject } from "ajv";
import Ajv2020Module, { type Ajv2020 as Ajv2020Instance, type Options } from "ajv/dist/2020.js";
import type { JsonValue } from "@dispatcher/persistence";
import { isAbsolute } from "node:path";

export interface RunnerConfig {
  id: string;
  displayName: string;
  mode: "embedded" | "remote";
  capacity: number;
  tags: string[];
  credentialRef?: string;
}

export interface IntegrationConfig {
  enabled: boolean;
  credentialRef?: string;
}

export interface ConnectorInstanceConfig {
  id: string;
  definitionId: string;
  kind: "task" | "messaging" | "scm";
  displayName: string;
  enabled: boolean;
  credentialRef?: string;
  settings?: Record<string, JsonValue>;
}

export interface AgentProfileConfig {
  id: string;
  provider: string;
  alias: string;
  runnerId: string;
  credentialRef?: string;
  settings?: Record<string, JsonValue>;
}

export interface RepositoryConfig {
  id: string;
  root: string;
  remote?: string;
  defaultBaseRef: string;
  scopePaths: string[];
  verificationCommands: Array<{
    id: string;
    file: string;
    args: string[];
    required: boolean;
    timeoutMs: number;
    outputLimitBytes: number;
  }>;
}

export interface LlmEndpointConfig {
  id: string;
  protocol: "openai-responses" | "openai-chat" | "anthropic-messages" | "azure-openai-v1";
  baseUrl: string;
  credentialRef: string;
  deployment?: string;
  apiVersion?: string;
}

export interface LlmProfileConfig {
  id: string;
  endpointId: string;
  alias: string;
  model: string;
  enabled: boolean;
}

export interface LlmPoolConfig {
  id: string;
  profileIds: string[];
}

export type LlmRoleConfig = "command_parser" | "config_assistant" | "runtime_summarizer" | "error_classifier";

export interface LlmRoleBindingConfig {
  role: LlmRoleConfig;
  poolId: string;
}

export interface DispatcherConfig {
  schemaVersion: 1;
  controller: {
    id: string;
    listen: string;
    port: number;
    deploymentMode: "embedded" | "controller";
    adminStrategy: "local-only" | "disabled";
  };
  runners: RunnerConfig[];
  integrations: {
    linear: IntegrationConfig;
    github: IntegrationConfig;
    slack: IntegrationConfig;
  };
  connectors: ConnectorInstanceConfig[];
  repositories: RepositoryConfig[];
  internalLlm: {
    configured: boolean;
    endpoints: LlmEndpointConfig[];
    profiles: LlmProfileConfig[];
    pools: LlmPoolConfig[];
    roleBindings: LlmRoleBindingConfig[];
    defaultPoolId?: string;
  };
  agentProfiles: AgentProfileConfig[];
  policies: {
    highRiskRequiresConfirmation: boolean;
    rawShellDefault: "deny";
  };
}

const integrationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled"],
  properties: {
    enabled: { type: "boolean", default: false },
    credentialRef: { type: "string", pattern: "^secret://[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$" },
  },
} as const;

export const dispatcherConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dispatcher.local/schemas/config-v1.json",
  title: "Agent Dispatcher configuration",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "controller", "runners", "integrations", "connectors", "repositories", "internalLlm", "agentProfiles", "policies"],
  properties: {
    schemaVersion: { const: 1 },
    controller: {
      type: "object",
      title: "Controller",
      additionalProperties: false,
      required: ["id", "listen", "port", "deploymentMode", "adminStrategy"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-z0-9][a-z0-9._-]*$", title: "Controller ID" },
        listen: { type: "string", minLength: 1, title: "Listen address" },
        port: { type: "integer", minimum: 1, maximum: 65535, title: "Port" },
        deploymentMode: { enum: ["embedded", "controller"], title: "Deployment mode" },
        adminStrategy: { enum: ["local-only", "disabled"], title: "Local administration" },
      },
    },
    runners: {
      type: "array",
      title: "Runners",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "displayName", "mode", "capacity", "tags"],
        properties: {
          id: { type: "string", minLength: 1 },
          displayName: { type: "string", minLength: 1 },
          mode: { enum: ["embedded", "remote"] },
          capacity: { type: "integer", minimum: 1, maximum: 64 },
          tags: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
          credentialRef: { type: "string", pattern: "^secret://runner/[a-z0-9][a-z0-9._/-]*$" },
        },
      },
    },
    integrations: {
      type: "object",
      title: "Integrations",
      additionalProperties: false,
      required: ["linear", "github", "slack"],
      properties: { linear: integrationSchema, github: integrationSchema, slack: integrationSchema },
    },
    connectors: {
      type: "array",
      title: "Connectors",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "definitionId", "kind", "displayName", "enabled"],
        properties: {
          id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
          definitionId: { type: "string", minLength: 1, pattern: "^(task|messaging|scm)\\.[a-z0-9][a-z0-9._-]*$" },
          kind: { enum: ["task", "messaging", "scm"] },
          displayName: { type: "string", minLength: 1 },
          enabled: { type: "boolean" },
          credentialRef: integrationSchema.properties.credentialRef,
          settings: { type: "object", additionalProperties: true },
        },
      },
    },
    repositories: {
      type: "array",
      title: "Repositories",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "root", "defaultBaseRef", "scopePaths", "verificationCommands"],
        properties: {
          id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._/-]*$" },
          root: { type: "string", minLength: 1 },
          remote: { type: "string", minLength: 1 },
          defaultBaseRef: { type: "string", minLength: 1 },
          scopePaths: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
          verificationCommands: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "file", "args", "required", "timeoutMs", "outputLimitBytes"],
              properties: {
                id: { type: "string", minLength: 1 },
                file: { type: "string", minLength: 1 },
                args: { type: "array", items: { type: "string" } },
                required: { type: "boolean" },
                timeoutMs: { type: "integer", minimum: 1, maximum: 3_600_000 },
                outputLimitBytes: { type: "integer", minimum: 1, maximum: 10_485_760 },
              },
            },
          },
        },
      },
    },
    internalLlm: {
      type: "object",
      title: "Internal LLM",
      additionalProperties: false,
      required: ["configured", "endpoints", "profiles", "pools", "roleBindings"],
      properties: {
        configured: { type: "boolean" },
        defaultPoolId: { type: "string", minLength: 1 },
        endpoints: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "protocol", "baseUrl", "credentialRef"],
            properties: {
              id: { type: "string", minLength: 1 },
              protocol: { enum: ["openai-responses", "openai-chat", "anthropic-messages", "azure-openai-v1"] },
              baseUrl: { type: "string", pattern: "^https?://" },
              credentialRef: { type: "string", pattern: "^secret://llm/[a-z0-9][a-z0-9._/-]*$" },
              deployment: { type: "string", minLength: 1 },
              apiVersion: { type: "string", minLength: 1 },
            },
          },
        },
        profiles: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "endpointId", "alias", "model", "enabled"],
            properties: {
              id: { type: "string", minLength: 1 },
              endpointId: { type: "string", minLength: 1 },
              alias: { type: "string", minLength: 1 },
              model: { type: "string", minLength: 1 },
              enabled: { type: "boolean" },
            },
          },
        },
        pools: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "profileIds"],
            properties: {
              id: { type: "string", minLength: 1 },
              profileIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
            },
          },
        },
        roleBindings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "poolId"],
            properties: {
              role: { enum: ["command_parser", "config_assistant", "runtime_summarizer", "error_classifier"] },
              poolId: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    agentProfiles: {
      type: "array",
      title: "Agent profiles",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "provider", "alias", "runnerId"],
        properties: {
          id: { type: "string", minLength: 1 },
          provider: { type: "string", minLength: 1 },
          alias: { type: "string", minLength: 1 },
          runnerId: { type: "string", minLength: 1 },
          credentialRef: integrationSchema.properties.credentialRef,
          settings: { type: "object", additionalProperties: true },
        },
      },
    },
    policies: {
      type: "object",
      title: "Policies",
      additionalProperties: false,
      required: ["highRiskRequiresConfirmation", "rawShellDefault"],
      properties: {
        highRiskRequiresConfirmation: { type: "boolean" },
        rawShellDefault: { const: "deny" },
      },
    },
  },
} as const;

export const dispatcherConfigUiSchema = {
  controller: { port: { "ui:widget": "updown" } },
  runners: { items: { credentialRef: { "ui:widget": "hidden" } } },
  integrations: {
    linear: { credentialRef: { "ui:widget": "hidden" } },
    github: { credentialRef: { "ui:widget": "hidden" } },
    slack: { credentialRef: { "ui:widget": "hidden" } },
  },
  connectors: { items: { credentialRef: { "ui:widget": "hidden" } } },
  internalLlm: {
    endpoints: { items: { credentialRef: { "ui:widget": "hidden" } } },
  },
  agentProfiles: { items: { credentialRef: { "ui:widget": "hidden" } } },
} as const;

export const defaultDispatcherConfig: DispatcherConfig = {
  schemaVersion: 1,
  controller: {
    id: "home-controller",
    listen: "127.0.0.1",
    port: 8347,
    deploymentMode: "embedded",
    adminStrategy: "local-only",
  },
  runners: [{ id: "local", displayName: "Local Mac", mode: "embedded", capacity: 1, tags: ["personal"] }],
  integrations: {
    linear: { enabled: false },
    github: { enabled: false },
    slack: { enabled: false },
  },
  connectors: [],
  repositories: [],
  internalLlm: { configured: false, endpoints: [], profiles: [], pools: [], roleBindings: [] },
  agentProfiles: [],
  policies: { highRiskRequiresConfirmation: true, rawShellDefault: "deny" },
};

export class ConfigValidationError extends Error {
  readonly code = "INVALID_CONFIGURATION";

  constructor(readonly issues: string[]) {
    super(`Configuration validation failed: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
  }
}

type Ajv2020Constructor = new (options?: Options) => Ajv2020Instance;
const Ajv2020 = (
  typeof Ajv2020Module === "function"
    ? Ajv2020Module
    : (Ajv2020Module as unknown as { Ajv2020: Ajv2020Constructor }).Ajv2020
) as unknown as Ajv2020Constructor;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(dispatcherConfigSchema);

function issueText(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}

export function normalizeConfig(input: DispatcherConfig): DispatcherConfig {
  const normalized = structuredClone(input);
  normalized.runners.sort((left, right) => left.id.localeCompare(right.id));
  normalized.runners = normalized.runners.map((runner) => ({ ...runner, tags: [...runner.tags].sort() }));
  normalized.agentProfiles.sort((left, right) => left.id.localeCompare(right.id));
  normalized.connectors.sort((left, right) => left.id.localeCompare(right.id));
  normalized.repositories.sort((left, right) => left.id.localeCompare(right.id));
  normalized.internalLlm.endpoints.sort((left, right) => left.id.localeCompare(right.id));
  normalized.internalLlm.profiles.sort((left, right) => left.id.localeCompare(right.id));
  normalized.internalLlm.pools.sort((left, right) => left.id.localeCompare(right.id));
  normalized.internalLlm.roleBindings.sort((left, right) => left.role.localeCompare(right.role));
  return normalized;
}

export function validateConfig(input: unknown): DispatcherConfig {
  const candidate = structuredClone(input) as Record<string, unknown>;
  candidate.connectors ??= [];
  candidate.repositories ??= [];
  if (Array.isArray(candidate.repositories)) {
    for (const repository of candidate.repositories) {
      if (repository && typeof repository === "object") (repository as Record<string, unknown>).verificationCommands ??= [];
    }
  }
  const internal = candidate && typeof candidate === "object" && candidate.internalLlm && typeof candidate.internalLlm === "object"
    ? candidate.internalLlm as Record<string, unknown>
    : undefined;
  if (internal) {
    internal.endpoints ??= [];
    internal.profiles ??= [];
    internal.pools ??= [];
    internal.roleBindings ??= [];
    if ("globalDefault" in internal && !("defaultPoolId" in internal)) {
      internal.defaultPoolId = internal.globalDefault;
      delete internal.globalDefault;
    }
  }
  if (!validateSchema(candidate)) throw new ConfigValidationError((validateSchema.errors ?? []).map(issueText));
  const config = normalizeConfig(candidate as unknown as DispatcherConfig);
  const runnerIds = new Set(config.runners.map((runner) => runner.id));
  if (runnerIds.size !== config.runners.length) throw new ConfigValidationError(["/runners contains duplicate id"]);
  for (const runner of config.runners) {
    if (runner.mode === "remote" && !runner.credentialRef) throw new ConfigValidationError([`/runners/${runner.id}/credentialRef is required for remote runners`]);
    if (runner.credentialRef && !runner.credentialRef.startsWith("secret://runner/")) throw new ConfigValidationError([`/runners/${runner.id}/credentialRef must use the runner secret namespace`]);
  }
  const profileIds = new Set<string>();
  const aliases = new Set<string>();
  for (const profile of config.agentProfiles) {
    if (profileIds.has(profile.id)) throw new ConfigValidationError(["/agentProfiles contains duplicate id"]);
    profileIds.add(profile.id);
    const alias = `${profile.provider}:${profile.alias}`.toLocaleLowerCase();
    if (aliases.has(alias)) throw new ConfigValidationError(["/agentProfiles contains duplicate provider alias"]);
    aliases.add(alias);
    if (!runnerIds.has(profile.runnerId)) {
      throw new ConfigValidationError([`/agentProfiles/${profile.id} references unknown runner ${profile.runnerId}`]);
    }
    if (profile.provider === "codex" && (typeof profile.settings?.codexHome !== "string" || !profile.settings.codexHome)) {
      throw new ConfigValidationError([`/agentProfiles/${profile.id}/settings/codexHome is required for Codex`]);
    }
  }
  for (const [name, integration] of Object.entries(config.integrations)) {
    if (integration.enabled && !integration.credentialRef) {
      throw new ConfigValidationError([`/integrations/${name}/credentialRef is required when enabled`]);
    }
    if (integration.credentialRef && !integration.credentialRef.startsWith(`secret://${name}/`)) {
      throw new ConfigValidationError([`/integrations/${name}/credentialRef must use the ${name} secret namespace`]);
    }
  }
  const connectorIds = new Set<string>();
  for (const connector of config.connectors) {
    if (connectorIds.has(connector.id)) throw new ConfigValidationError(["/connectors contains duplicate id"]);
    connectorIds.add(connector.id);
    if (!connector.definitionId.startsWith(`${connector.kind}.`)) {
      throw new ConfigValidationError([`/connectors/${connector.id}/definitionId must match connector kind`]);
    }
    if (connector.enabled && !connector.credentialRef) {
      throw new ConfigValidationError([`/connectors/${connector.id}/credentialRef is required when enabled`]);
    }
    if (connector.credentialRef) {
      const namespace = connector.definitionId.split(".")[1];
      if (!namespace || !connector.credentialRef.startsWith(`secret://${namespace}/`)) {
        throw new ConfigValidationError([`/connectors/${connector.id}/credentialRef must use the ${namespace ?? "connector"} secret namespace`]);
      }
    }
    const namespace = connector.definitionId.split(".")[1];
    for (const [key, value] of Object.entries(connector.settings ?? {})) {
      if (key.toLowerCase().endsWith("ref") && (typeof value !== "string" || !namespace || !value.startsWith(`secret://${namespace}/`))) {
        throw new ConfigValidationError([`/connectors/${connector.id}/settings/${key} must use the ${namespace ?? "connector"} secret namespace`]);
      }
    }
    if (connector.definitionId === "task.linear" && (typeof connector.settings?.webhookSecretRef !== "string" || !connector.settings.webhookSecretRef)) {
      throw new ConfigValidationError([`/connectors/${connector.id}/settings/webhookSecretRef is required for Linear`]);
    }
    if (connector.definitionId === "messaging.slack" && (typeof connector.settings?.signingSecretRef !== "string" || !connector.settings.signingSecretRef)) {
      throw new ConfigValidationError([`/connectors/${connector.id}/settings/signingSecretRef is required for Slack`]);
    }
  }
  const repositoryIds = new Set<string>();
  for (const repository of config.repositories) {
    if (repositoryIds.has(repository.id)) throw new ConfigValidationError(["/repositories contains duplicate id"]);
    repositoryIds.add(repository.id);
    if (!isAbsolute(repository.root)) throw new ConfigValidationError([`/repositories/${repository.id}/root must be absolute`]);
    if (repository.scopePaths.some((path) => isAbsolute(path) || path.split(/[\\/]/).includes(".."))) {
      throw new ConfigValidationError([`/repositories/${repository.id}/scopePaths must stay relative to the worktree`]);
    }
    const commandIds = new Set(repository.verificationCommands.map((command) => command.id));
    if (commandIds.size !== repository.verificationCommands.length) throw new ConfigValidationError([`/repositories/${repository.id}/verificationCommands contains duplicate id`]);
  }
  const endpointIds = new Set<string>();
  for (const endpoint of config.internalLlm.endpoints) {
    if (endpointIds.has(endpoint.id)) throw new ConfigValidationError(["/internalLlm/endpoints contains duplicate id"]);
    endpointIds.add(endpoint.id);
    try {
      const url = new URL(endpoint.baseUrl);
      if (url.username || url.password) throw new Error("embedded credentials");
    } catch {
      throw new ConfigValidationError([`/internalLlm/endpoints/${endpoint.id}/baseUrl is invalid`]);
    }
  }
  const llmProfileIds = new Set<string>();
  const llmAliases = new Set<string>();
  for (const profile of config.internalLlm.profiles) {
    if (llmProfileIds.has(profile.id)) throw new ConfigValidationError(["/internalLlm/profiles contains duplicate id"]);
    llmProfileIds.add(profile.id);
    if (llmAliases.has(profile.alias.toLowerCase())) throw new ConfigValidationError(["/internalLlm/profiles contains duplicate alias"]);
    llmAliases.add(profile.alias.toLowerCase());
    if (!endpointIds.has(profile.endpointId)) throw new ConfigValidationError([`/internalLlm/profiles/${profile.id} references unknown endpoint`]);
  }
  const poolIds = new Set<string>();
  for (const pool of config.internalLlm.pools) {
    if (poolIds.has(pool.id)) throw new ConfigValidationError(["/internalLlm/pools contains duplicate id"]);
    poolIds.add(pool.id);
    for (const profileId of pool.profileIds) if (!llmProfileIds.has(profileId)) throw new ConfigValidationError([`/internalLlm/pools/${pool.id} references unknown profile`]);
  }
  if (config.internalLlm.defaultPoolId && !poolIds.has(config.internalLlm.defaultPoolId)) throw new ConfigValidationError(["/internalLlm/defaultPoolId references unknown pool"]);
  const boundRoles = new Set<string>();
  for (const binding of config.internalLlm.roleBindings) {
    if (boundRoles.has(binding.role)) throw new ConfigValidationError(["/internalLlm/roleBindings contains duplicate role"]);
    boundRoles.add(binding.role);
    if (!poolIds.has(binding.poolId)) throw new ConfigValidationError([`/internalLlm/roleBindings/${binding.role} references unknown pool`]);
  }
  if (config.internalLlm.configured && (!config.internalLlm.endpoints.length || !config.internalLlm.profiles.length || !config.internalLlm.pools.length)) {
    throw new ConfigValidationError(["/internalLlm requires an endpoint, profile, and pool when configured"]);
  }
  return config;
}

export function requiredSecretReferences(config: DispatcherConfig): string[] {
  const references = Object.values(config.integrations)
    .filter((integration) => integration.enabled)
    .flatMap((integration) => integration.credentialRef ? [integration.credentialRef] : []);
  for (const profile of config.agentProfiles) {
    if (profile.credentialRef) references.push(profile.credentialRef);
  }
  for (const connector of config.connectors) {
    if (connector.enabled && connector.credentialRef) references.push(connector.credentialRef);
    for (const [key, value] of Object.entries(connector.settings ?? {})) {
      if (key.toLowerCase().endsWith("ref") && typeof value === "string") references.push(value);
    }
  }
  for (const endpoint of config.internalLlm.endpoints) references.push(endpoint.credentialRef);
  return [...new Set(references)].sort();
}

export function configToJson(config: DispatcherConfig): JsonValue {
  return JSON.parse(JSON.stringify(config)) as JsonValue;
}

function mergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key];
    result[key] =
      value && previous && typeof value === "object" && typeof previous === "object" && !Array.isArray(value) && !Array.isArray(previous)
        ? mergeObjects(previous as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return result;
}

export function resolveEffectiveConfig(input: {
  bootstrap?: Partial<DispatcherConfig>;
  canonical?: DispatcherConfig;
  runtime?: Partial<DispatcherConfig>;
}): DispatcherConfig {
  const mergedBootstrap = mergeObjects(defaultDispatcherConfig as unknown as Record<string, unknown>, input.bootstrap as Record<string, unknown> ?? {});
  const canonical = input.canonical ?? validateConfig(mergedBootstrap);
  return validateConfig(mergeObjects(canonical as unknown as Record<string, unknown>, input.runtime as Record<string, unknown> ?? {}));
}
