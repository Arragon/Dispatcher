import type { TaskContract, TaskState } from "@dispatcher/domain";
import type { TaskDraft } from "@dispatcher/integrations";

export interface CompileResult {
  state: Extract<TaskState, "READY" | "NEEDS_SPEC">;
  contract?: TaskContract;
  missing: Array<"repository" | "scope" | "acceptanceCriteria" | "verification">;
}

export class TaskContractCompiler {
  compile(draft: TaskDraft, revision = 1): CompileResult {
    const missing: CompileResult["missing"] = [];
    if (!draft.repository?.trim()) missing.push("repository");
    if (draft.scope.length === 0) missing.push("scope");
    if (draft.acceptanceCriteria.length === 0) missing.push("acceptanceCriteria");
    if (draft.verification.length === 0) missing.push("verification");
    if (missing.length) return { state: "NEEDS_SPEC", missing };
    const delivery = draft.delivery ?? { type: "pull-request" as const, baseBranch: "main" };
    return {
      state: "READY",
      missing,
      contract: {
        version: 1,
        revision,
        goal: draft.title.trim(),
        scope: [...draft.scope],
        acceptanceCriteria: [...draft.acceptanceCriteria],
        verification: [...draft.verification],
        constraints: [...draft.constraints],
        delivery: {
          ...delivery,
          repository: draft.repository!,
        },
      },
    };
  }
}

export type SemanticRisk = "read" | "write" | "privileged";
export type SemanticWorkflowState = "NEEDS_CLARIFICATION" | "NEEDS_APPROVAL" | "READY" | "EXECUTED" | "REJECTED" | "FAILED";

export interface EntityReference {
  kind: "task" | "project" | "profile" | "connector" | "run";
  value: string;
  id?: string;
}

export interface TypedIntentV2 {
  version: 2;
  action: string;
  entities: EntityReference[];
  arguments: Record<string, unknown>;
  confidence: number;
  source: "assistant" | "fixed-command" | "ui" | "messaging";
  expectedRevision?: number;
}

export interface SemanticPrincipal {
  id: string;
  roles: string[];
  channel: "web" | "api" | "messaging";
}

export interface SemanticToolContext {
  principal: SemanticPrincipal;
  workflowId: string;
  confirmed: boolean;
}

export interface SemanticTool {
  name: string;
  description: string;
  risk: SemanticRisk;
  requiredRoles?: string[];
  input: { required?: string[]; properties?: Record<string, "string" | "number" | "boolean" | "object" | "array">; additionalProperties?: boolean };
  execute(arguments_: Record<string, unknown>, context: SemanticToolContext): Promise<unknown>;
}

export interface SemanticAuditEvent {
  id: string;
  workflowId: string;
  action: string;
  actor: string;
  outcome: "accepted" | "rejected" | "executed" | "failed";
  reason?: string;
  occurredAt: string;
}

export interface SemanticPolicy {
  highRiskRequiresConfirmation: boolean;
  secretPattern?: RegExp;
}

export class SemanticPolicyError extends Error {
  constructor(readonly code: "TOOL_NOT_ALLOWED" | "INVALID_INPUT" | "SECRET_BLOCKED" | "FORBIDDEN" | "CONFIRMATION_REQUIRED" | "STALE_WORKFLOW", message: string) {
    super(message);
    this.name = "SemanticPolicyError";
  }
}

function containsSecret(value: unknown, pattern: RegExp): boolean {
  if (typeof value === "string") return pattern.test(value) && !value.startsWith("secret://");
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, pattern));
  return Boolean(value && typeof value === "object" && Object.entries(value).some(([key, entry]) => /secret|token|password|api.?key/i.test(key) && typeof entry === "string" && !entry.startsWith("secret://") || containsSecret(entry, pattern)));
}

export class SemanticToolRegistry {
  private readonly tools = new Map<string, SemanticTool>();
  private readonly audit: SemanticAuditEvent[] = [];
  constructor(private readonly policy: SemanticPolicy = { highRiskRequiresConfirmation: true, secretPattern: /(?:sk-|xox[baprs]-|gh[op]_)[a-z0-9_-]{8,}/i }) {}

  register(tool: SemanticTool): void {
    if (!/^[a-z][a-z0-9_.-]+$/.test(tool.name)) throw new Error(`Invalid semantic tool name ${tool.name}`);
    if (this.tools.has(tool.name)) throw new Error(`Duplicate semantic tool ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  list(): Array<Omit<SemanticTool, "execute">> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      ...(tool.requiredRoles ? { requiredRoles: [...tool.requiredRoles] } : {}),
      input: structuredClone(tool.input),
    })).sort((left, right) => left.name.localeCompare(right.name));
  }

  events(): SemanticAuditEvent[] { return structuredClone(this.audit); }

  async execute(name: string, arguments_: Record<string, unknown>, context: SemanticToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) return this.reject(context, name, "TOOL_NOT_ALLOWED", `Tool ${name} is not allowlisted`);
    try {
      this.validateInput(tool, arguments_);
      if (containsSecret(arguments_, this.policy.secretPattern ?? /$^/)) throw new SemanticPolicyError("SECRET_BLOCKED", "Literal credentials must use secure input and opaque secret references");
      if (tool.requiredRoles?.some((role) => !context.principal.roles.includes(role))) throw new SemanticPolicyError("FORBIDDEN", "Principal does not have the required role");
      if (this.policy.highRiskRequiresConfirmation && tool.risk === "privileged" && !context.confirmed) throw new SemanticPolicyError("CONFIRMATION_REQUIRED", "Privileged tool requires explicit confirmation");
      const result = await tool.execute(structuredClone(arguments_), context);
      this.record(context, name, "executed");
      return result;
    } catch (error) {
      this.record(context, name, "rejected", error instanceof Error ? error.message : "tool execution failed");
      throw error;
    }
  }

  private validateInput(tool: SemanticTool, arguments_: Record<string, unknown>): void {
    for (const required of tool.input.required ?? []) if (!(required in arguments_)) throw new SemanticPolicyError("INVALID_INPUT", `Missing ${required}`);
    const properties = tool.input.properties ?? {};
    for (const [key, value] of Object.entries(arguments_)) {
      const type = properties[key];
      if (!type && tool.input.additionalProperties === false) throw new SemanticPolicyError("INVALID_INPUT", `Unexpected ${key}`);
      if (type && (type === "array" ? !Array.isArray(value) : type === "object" ? !value || typeof value !== "object" || Array.isArray(value) : typeof value !== type)) {
        throw new SemanticPolicyError("INVALID_INPUT", `${key} must be ${type}`);
      }
    }
  }

  private reject(context: SemanticToolContext, action: string, code: SemanticPolicyError["code"], message: string): never {
    this.record(context, action, "rejected", message);
    throw new SemanticPolicyError(code, message);
  }

  private record(context: SemanticToolContext, action: string, outcome: SemanticAuditEvent["outcome"], reason?: string): void {
    this.audit.push({ id: `${context.workflowId}:${this.audit.length + 1}`, workflowId: context.workflowId, action, actor: context.principal.id, outcome, ...(reason ? { reason } : {}), occurredAt: new Date().toISOString() });
  }
}

export interface ResolvableEntity { id: string; kind: EntityReference["kind"]; label: string; aliases?: string[]; }
export interface EntityResolution { status: "RESOLVED" | "AMBIGUOUS" | "NOT_FOUND"; reference: EntityReference; matches: ResolvableEntity[]; }

export class EntityResolver {
  resolve(reference: EntityReference, candidates: readonly ResolvableEntity[]): EntityResolution {
    const needle = reference.value.trim().toLocaleLowerCase();
    const scoped = candidates.filter((candidate) => candidate.kind === reference.kind);
    const exact = scoped.filter((candidate) => candidate.id.toLocaleLowerCase() === needle || candidate.label.toLocaleLowerCase() === needle || candidate.aliases?.some((alias) => alias.toLocaleLowerCase() === needle));
    const matches = exact.length ? exact : scoped.filter((candidate) => candidate.label.toLocaleLowerCase().includes(needle) || candidate.aliases?.some((alias) => alias.toLocaleLowerCase().includes(needle)));
    return { status: matches.length === 1 ? "RESOLVED" : matches.length > 1 ? "AMBIGUOUS" : "NOT_FOUND", reference: structuredClone(reference), matches: structuredClone(matches).sort((left, right) => left.id.localeCompare(right.id)) };
  }
}

export interface SemanticWorkflowRecord {
  id: string;
  revision: number;
  intent: TypedIntentV2;
  state: SemanticWorkflowState;
  principal: SemanticPrincipal;
  toolName: string;
  resolvedEntities: EntityReference[];
  questions: string[];
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticWorkflowStore {
  get(id: string): SemanticWorkflowRecord | undefined;
  save(record: SemanticWorkflowRecord): void;
}

export class MemorySemanticWorkflowStore implements SemanticWorkflowStore {
  private readonly records = new Map<string, SemanticWorkflowRecord>();
  get(id: string): SemanticWorkflowRecord | undefined { const record = this.records.get(id); return record ? structuredClone(record) : undefined; }
  save(record: SemanticWorkflowRecord): void { this.records.set(record.id, structuredClone(record)); }
}

export class SemanticWorkflowEngine {
  constructor(private readonly tools: SemanticToolRegistry, private readonly store: SemanticWorkflowStore, private readonly resolver = new EntityResolver()) {}

  get(id: string): SemanticWorkflowRecord | undefined { return this.store.get(id); }

  plan(input: { id: string; intent: TypedIntentV2; principal: SemanticPrincipal; candidates?: readonly ResolvableEntity[] }): SemanticWorkflowRecord {
    if (input.intent.version !== 2 || input.intent.confidence < 0 || input.intent.confidence > 1) throw new SemanticPolicyError("INVALID_INPUT", "Typed intent v2 is required");
    const resolutions = input.intent.entities.map((entity) => this.resolver.resolve(entity, input.candidates ?? []));
    const ambiguous = resolutions.filter((resolution) => resolution.status !== "RESOLVED");
    const tool = this.tools.list().find((candidate) => candidate.name === input.intent.action);
    if (!tool) throw new SemanticPolicyError("TOOL_NOT_ALLOWED", `Tool ${input.intent.action} is not allowlisted`);
    if (tool.requiredRoles?.some((role) => !input.principal.roles.includes(role))) throw new SemanticPolicyError("FORBIDDEN", "Principal does not have the required role");
    const resolvedTarget = resolutions.find((resolution) => resolution.status === "RESOLVED")?.matches[0]?.id;
    const normalizedIntent: TypedIntentV2 = resolvedTarget && "target" in input.intent.arguments
      ? { ...structuredClone(input.intent), arguments: { ...structuredClone(input.intent.arguments), target: resolvedTarget } }
      : structuredClone(input.intent);
    const state: SemanticWorkflowState = input.intent.confidence < 0.7 || ambiguous.length
      ? "NEEDS_CLARIFICATION"
      : tool.risk === "privileged"
        ? "NEEDS_APPROVAL"
        : "READY";
    const now = new Date().toISOString();
    const record: SemanticWorkflowRecord = {
      id: input.id,
      revision: 1,
      intent: normalizedIntent,
      state,
      principal: structuredClone(input.principal),
      toolName: input.intent.action,
      resolvedEntities: resolutions.flatMap((resolution) => resolution.status === "RESOLVED" ? [{ ...resolution.reference, id: resolution.matches[0]!.id }] : []),
      questions: [
        ...(input.intent.confidence < 0.7 ? ["Please confirm the intended action."] : []),
        ...ambiguous.map((resolution) => resolution.status === "AMBIGUOUS" ? `Which ${resolution.reference.kind} did you mean: ${resolution.matches.map((match) => match.label).join(", ")}?` : `Which ${resolution.reference.kind} did you mean?`),
      ],
      createdAt: now,
      updatedAt: now,
    };
    this.store.save(record);
    return structuredClone(record);
  }

  clarify(id: string, revision: number, intent: TypedIntentV2, candidates: readonly ResolvableEntity[] = []): SemanticWorkflowRecord {
    const current = this.requireCurrent(id, revision);
    if (current.state !== "NEEDS_CLARIFICATION") throw new SemanticPolicyError("STALE_WORKFLOW", "Workflow is not waiting for clarification");
    const clarified = this.plan({ id, intent, principal: current.principal, candidates });
    const updated = { ...clarified, revision: current.revision + 1, createdAt: current.createdAt };
    this.store.save(updated);
    return structuredClone(updated);
  }

  approve(id: string, revision: number): SemanticWorkflowRecord {
    const current = this.requireCurrent(id, revision);
    if (current.state !== "NEEDS_APPROVAL") throw new SemanticPolicyError("STALE_WORKFLOW", "Workflow is not waiting for approval");
    const updated = { ...current, revision: current.revision + 1, state: "READY" as const, updatedAt: new Date().toISOString() };
    this.store.save(updated);
    return structuredClone(updated);
  }

  async execute(id: string, revision: number): Promise<SemanticWorkflowRecord> {
    const current = this.requireCurrent(id, revision);
    if (current.state !== "READY") throw new SemanticPolicyError("STALE_WORKFLOW", "Workflow is not ready");
    try {
      const result = await this.tools.execute(current.toolName, current.intent.arguments, { principal: current.principal, workflowId: current.id, confirmed: current.revision > 1 });
      const updated = { ...current, revision: current.revision + 1, state: "EXECUTED" as const, result: structuredClone(result), updatedAt: new Date().toISOString() };
      this.store.save(updated);
      return structuredClone(updated);
    } catch (error) {
      const updated = { ...current, revision: current.revision + 1, state: "FAILED" as const, result: { error: error instanceof Error ? error.message : "execution failed" }, updatedAt: new Date().toISOString() };
      this.store.save(updated);
      throw error;
    }
  }

  private requireCurrent(id: string, revision: number): SemanticWorkflowRecord {
    const current = this.store.get(id);
    if (!current || current.revision !== revision) throw new SemanticPolicyError("STALE_WORKFLOW", "Workflow revision is stale");
    return current;
  }
}

export function parseFixedCommand(text: string): TypedIntentV2 | undefined {
  const normalized = text.trim();
  const match = /^(?:\/)?(task|run|fleet|profile)\s+(status|list|cancel|pause|resume|reroute)(?:\s+(.+))?$/i.exec(normalized);
  if (!match) return undefined;
  const [, kind, operation, value] = match;
  const entityKind = kind!.toLocaleLowerCase() as EntityReference["kind"];
  const values = value?.trim().split(/\s+/) ?? [];
  return {
    version: 2,
    action: `${entityKind}.${operation!.toLocaleLowerCase()}`,
    entities: values[0] ? [{ kind: entityKind, value: values[0] }] : [],
    arguments: values[0] ? { target: values[0], ...(operation?.toLocaleLowerCase() === "reroute" && values[1] ? { profileId: values[1] } : {}) } : {},
    confidence: 1,
    source: "fixed-command",
  };
}
