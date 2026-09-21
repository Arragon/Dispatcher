import type {
  ConnectorCapability,
  ConnectorDefinition,
  ConnectorHealth,
  ConnectorInstance,
  ConnectorKind,
} from "@dispatcher/domain";

export type ConnectorOperation = "auth" | "ingress" | "read" | "write" | "reconcile" | "delivery";

export class ConnectorError extends Error {
  constructor(
    readonly code: "AUTH" | "CAPABILITY" | "RATE_LIMITED" | "TEMPORARY" | "CONFLICT" | "PERMANENT" | "INVALID_EVENT",
    message: string,
    readonly options: { retryable: boolean; retryAfterMs?: number; operation?: ConnectorOperation } = { retryable: false },
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export interface ConnectorProbeResult {
  health: ConnectorHealth;
  checkedAt: string;
  message?: string;
}

export interface ConnectorAdapter {
  readonly definition: ConnectorDefinition;
  readonly instance: ConnectorInstance;
  probe(): Promise<ConnectorProbeResult>;
}

export interface ExternalEvent {
  version: 1;
  id: string;
  connectorInstanceId: string;
  externalEventId: string;
  idempotencyKey: string;
  entityType: "project" | "task" | "comment" | "status" | "delivery";
  action: "created" | "updated" | "deleted" | "commented" | "transitioned";
  externalEntityId: string;
  externalRevision?: string;
  occurredAt: string;
  traceId: string;
  data: Record<string, unknown>;
}

export function createConnectorDefinition(input: {
  id: string;
  kind: ConnectorKind;
  displayName: string;
  capabilities: ConnectorCapability[];
}): ConnectorDefinition {
  if (!input.id.startsWith(`${input.kind}.`)) throw new ConnectorError("CAPABILITY", "Connector id must be namespaced by kind");
  const seen = new Set<string>();
  for (const capability of input.capabilities) {
    if (!capability.namespace.includes(".")) throw new ConnectorError("CAPABILITY", "Capability names must be namespaced");
    if (seen.has(capability.namespace)) throw new ConnectorError("CAPABILITY", `Duplicate capability ${capability.namespace}`);
    seen.add(capability.namespace);
    if (!Number.isSafeInteger(capability.version) || capability.version < 1) throw new ConnectorError("CAPABILITY", "Capability versions are positive integers");
  }
  return { apiVersion: 1, ...structuredClone(input) };
}

export function assertCapability(
  definition: ConnectorDefinition,
  namespace: string,
  minimumVersion = 1,
): ConnectorCapability {
  const capability = definition.capabilities.find((entry) => entry.namespace === namespace);
  if (!capability || capability.support !== "supported" || capability.version < minimumVersion) {
    throw new ConnectorError("CAPABILITY", `${definition.id} does not support ${namespace}@${minimumVersion}`);
  }
  return structuredClone(capability);
}

