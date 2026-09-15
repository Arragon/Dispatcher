import type { ErrorObject } from "ajv";
import Ajv2020Module, { type Ajv2020 as Ajv2020Instance, type Options } from "ajv/dist/2020.js";
import type { JsonValue } from "@dispatcher/persistence";

export interface RunnerConfig {
  id: string;
  displayName: string;
  mode: "embedded" | "remote";
  capacity: number;
  tags: string[];
}

export interface IntegrationConfig {
  enabled: boolean;
  credentialRef?: string;
}

export interface AgentProfileConfig {
  id: string;
  provider: string;
  alias: string;
  runnerId: string;
  credentialRef?: string;
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
  internalLlm: {
    configured: boolean;
    globalDefault?: string;
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
  required: ["schemaVersion", "controller", "runners", "integrations", "internalLlm", "agentProfiles", "policies"],
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
    internalLlm: {
      type: "object",
      title: "Internal LLM",
      additionalProperties: false,
      required: ["configured"],
      properties: {
        configured: { type: "boolean" },
        globalDefault: { type: "string", minLength: 1 },
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
  integrations: {
    linear: { credentialRef: { "ui:widget": "hidden" } },
    github: { credentialRef: { "ui:widget": "hidden" } },
    slack: { credentialRef: { "ui:widget": "hidden" } },
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
  internalLlm: { configured: false },
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
  return normalized;
}

export function validateConfig(input: unknown): DispatcherConfig {
  if (!validateSchema(input)) throw new ConfigValidationError((validateSchema.errors ?? []).map(issueText));
  const config = normalizeConfig(input as DispatcherConfig);
  const runnerIds = new Set(config.runners.map((runner) => runner.id));
  if (runnerIds.size !== config.runners.length) throw new ConfigValidationError(["/runners contains duplicate id"]);
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
  }
  for (const [name, integration] of Object.entries(config.integrations)) {
    if (integration.enabled && !integration.credentialRef) {
      throw new ConfigValidationError([`/integrations/${name}/credentialRef is required when enabled`]);
    }
    if (integration.credentialRef && !integration.credentialRef.startsWith(`secret://${name}/`)) {
      throw new ConfigValidationError([`/integrations/${name}/credentialRef must use the ${name} secret namespace`]);
    }
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
