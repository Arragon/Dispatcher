import type { ConnectorDefinition, ExternalBinding, Task } from "@dispatcher/domain";
import type { CommonTaskField, TaskFieldMapping } from "./task-platform.js";

const PROJECTABLE_FIELDS: readonly CommonTaskField[] = ["title", "description", "status", "priority", "assignee", "labels"];

export interface TaskPlatformSwitchPlan {
  taskId: string;
  sourceConnectorInstanceId?: string;
  targetConnectorInstanceId: string;
  targetExternalId: string;
  canSwitch: boolean;
  mappableFields: CommonTaskField[];
  unmappableFields: Array<{ field: string; reason: string }>;
  targetBinding: ExternalBinding;
  preservedReferences: readonly ["task.id", "task.currentRunId", "taskContract", "runHistory", "deliveryEvidence"];
}

export function planTaskPlatformSwitch(input: {
  task: Task;
  targetDefinition: ConnectorDefinition;
  targetConnectorInstanceId: string;
  targetExternalId: string;
  mapping: TaskFieldMapping;
  supportedFields?: CommonTaskField[];
  now?: string;
}): TaskPlatformSwitchPlan {
  if (input.targetDefinition.kind !== "task") throw new Error("Target connector is not a task platform");
  const canProject = input.targetDefinition.capabilities.some((entry) => entry.namespace === "task.project" && entry.support === "supported");
  if (!canProject) throw new Error("Target connector does not support task projection");
  const supported = new Set(input.supportedFields ?? PROJECTABLE_FIELDS);
  const present = new Set<CommonTaskField>(["title", "status"]);
  if (input.task.description !== undefined) present.add("description");
  if (input.task.priority !== undefined) present.add("priority");
  if (input.task.assignee !== undefined) present.add("assignee");
  if (input.task.labels?.length) present.add("labels");
  const mappableFields = [...present].filter((field) => supported.has(field));
  const unmappableFields: Array<{ field: string; reason: string }> = [...present]
    .filter((field) => !supported.has(field))
    .map((field) => ({ field, reason: "target connector does not declare field support" }));
  if (input.task.dueAt) unmappableFields.push({ field: "dueAt", reason: "field is outside TaskProjection v1" });
  for (const key of Object.keys(input.task.platformExtensions ?? {}).sort()) {
    unmappableFields.push({ field: `platformExtensions.${key}`, reason: "provider extension remains on the canonical task" });
  }
  for (const [field, owner] of Object.entries(input.mapping.ownership)) {
    if (owner === "external" && !supported.has(field as CommonTaskField) && !unmappableFields.some((entry) => entry.field === field)) {
      unmappableFields.push({ field, reason: "external-owned field is unsupported by the target connector" });
    }
  }
  const now = input.now ?? new Date().toISOString();
  return {
    taskId: input.task.id,
    ...(input.task.origin?.connectorInstanceId ? { sourceConnectorInstanceId: input.task.origin.connectorInstanceId } : {}),
    targetConnectorInstanceId: input.targetConnectorInstanceId,
    targetExternalId: input.targetExternalId,
    canSwitch: mappableFields.includes("title") && mappableFields.includes("status"),
    mappableFields,
    unmappableFields,
    targetBinding: {
      id: `${input.targetConnectorInstanceId}:${input.targetExternalId}`,
      canonicalEntityId: input.task.id,
      connectorInstanceId: input.targetConnectorInstanceId,
      entityType: "task",
      externalId: input.targetExternalId,
      projectionState: "PENDING",
      updatedAt: now,
    },
    preservedReferences: ["task.id", "task.currentRunId", "taskContract", "runHistory", "deliveryEvidence"],
  };
}
