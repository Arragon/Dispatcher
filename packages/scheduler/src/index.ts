import { randomUUID } from "node:crypto";
import type { ResourceState, Run, Task, TaskContract, ExecutionSelection } from "@dispatcher/domain";
import type { AgentAdapter } from "@dispatcher/adapters";

export interface DispatchRequirements {
  capabilities: string[];
  runnerTags?: string[];
  providerIds?: string[];
}

export interface DispatchCandidate {
  runnerId: string;
  runnerTags: string[];
  capacity: number;
  activeRuns: number;
  providerId: string;
  profileId: string;
  resourceState: ResourceState;
  capabilities: string[];
  adapter: AgentAdapter;
}

export interface RoutingDecision {
  selected?: DispatchCandidate;
  eligible: Array<{ runnerId: string; profileId: string; reasons: string[] }>;
  rejected: Array<{ runnerId: string; profileId: string; reasons: string[] }>;
  explanation: string;
}

export function routeDeterministically(requirements: DispatchRequirements, candidates: DispatchCandidate[]): RoutingDecision {
  const eligible: RoutingDecision["eligible"] = [];
  const rejected: RoutingDecision["rejected"] = [];
  const ordered = [...candidates].sort((left, right) =>
    left.runnerId.localeCompare(right.runnerId) || left.providerId.localeCompare(right.providerId) || left.profileId.localeCompare(right.profileId));
  for (const candidate of ordered) {
    const reasons: string[] = [];
    if (candidate.activeRuns >= candidate.capacity) reasons.push("runner capacity exhausted");
    if (["RATE_LIMITED", "QUOTA_EXHAUSTED", "WAITING_RESET", "AUTH_ERROR", "PROVIDER_DOWN", "UNKNOWN"].includes(candidate.resourceState)) {
      reasons.push(`resource state ${candidate.resourceState}`);
    }
    for (const capability of requirements.capabilities) if (!candidate.capabilities.includes(capability)) reasons.push(`missing capability ${capability}`);
    for (const tag of requirements.runnerTags ?? []) if (!candidate.runnerTags.includes(tag)) reasons.push(`missing runner tag ${tag}`);
    if (requirements.providerIds?.length && !requirements.providerIds.includes(candidate.providerId)) reasons.push(`provider ${candidate.providerId} is not allowed`);
    const item = { runnerId: candidate.runnerId, profileId: candidate.profileId, reasons: reasons.length ? reasons : ["all deterministic filters passed"] };
    if (reasons.length) rejected.push(item);
    else eligible.push(item);
  }
  const selectedIdentity = eligible[0];
  const selected = selectedIdentity
    ? ordered.find((candidate) => candidate.runnerId === selectedIdentity.runnerId && candidate.profileId === selectedIdentity.profileId)
    : undefined;
  return {
    ...(selected ? { selected } : {}),
    eligible,
    rejected,
    explanation: selected
      ? `Selected ${selected.runnerId}/${selected.profileId}; ${selectedIdentity?.reasons.join(", ")}`
      : "No candidate passed deterministic capability, capacity, provider, runner, and resource filters",
  };
}

export class CanonicalScheduler {
  constructor(private readonly candidates: () => DispatchCandidate[]) {}

  async dispatch(input: {
    task: Task;
    taskRevision: number;
    contract: TaskContract;
    requirements: DispatchRequirements;
    workspacePath: string;
    generation?: number;
    runId?: string;
    replacement?: Run;
    executionSelection?: ExecutionSelection;
    beforeStart?: () => Promise<void>;
    onRunStarting?: (run: Run, decision: RoutingDecision) => void;
  }): Promise<{ run: Run; decision: RoutingDecision }> {
    if (input.replacement) {
      const previous = input.replacement;
      if (previous.state !== "SUPERSEDED" || previous.taskId !== input.task.id || input.task.currentRunId !== previous.id || !["RUNNING", "WAITING_USER", "WAITING_RESOURCE"].includes(input.task.state)) throw new Error("Replacement requires the current stopped Run and its canonical task");
    } else if (input.task.state !== "READY" && input.task.state !== "QUEUED") throw new Error(`Task ${input.task.id} is not dispatchable from ${input.task.state}`);
    const decision = routeDeterministically(input.requirements, this.candidates());
    if (!decision.selected) throw new Error(decision.explanation);
    const runId = input.runId ?? randomUUID();
    const now = new Date().toISOString();
    const run: Run = {
      ...(input.executionSelection ? {executionSelection:input.executionSelection} : {}),
      id: runId,
      taskId: input.task.id,
      runnerId: decision.selected.runnerId,
      providerId: decision.selected.providerId,
      profileId: decision.selected.profileId,
      sessionId: `unstarted:${runId}`,
      resumePolicy: decision.selected.adapter.manifest.capabilities.resume ? "same-session" : "controlled-reroute",
      state: "STARTING",
      attempt: input.replacement ? input.replacement.attempt + 1 : 1,
      generation: input.replacement ? input.replacement.generation + 1 : input.generation ?? 1,
      leaseId: randomUUID(),
      taskRevision: input.taskRevision,
      contractRevision: input.contract.revision,
      worktree: input.workspacePath,
      requiredCapabilities: [...input.requirements.capabilities],
      startedAt: now,
      lastActivityAt: now,
      verification: { state: "PENDING", commands: [...input.contract.verification] },
    };
    input.onRunStarting?.(run, decision);
    try {
      await input.beforeStart?.();
      const session = await decision.selected.adapter.start({ runId, workspacePath: input.workspacePath, prompt: renderTaskContract(input.contract), ...(input.executionSelection ? {executionSelection:input.executionSelection} : {}) });
      run.sessionId = session.id;
      if (session.providerSessionId) run.providerSessionId = session.providerSessionId;
      run.resumePolicy = session.providerSessionId || decision.selected.adapter.manifest.capabilities.resume ? "same-session" : "controlled-reroute";
      run.state = "ACTIVE";
    } catch (error) {
      const unknown = error && typeof error === "object" && "code" in error && error.code === "COMMAND_OUTCOME_UNKNOWN";
      run.state = unknown ? "RUNNER_UNAVAILABLE" : "FAILED";
      run.failureReason = `${unknown ? "Native start outcome unknown" : "Agent start failed"}: ${error instanceof Error ? error.message : "unknown process error"}`;
      if (unknown) { run.resumePolicy = "manual"; run.recoveryReason = "NATIVE_OUTCOME_UNKNOWN"; }
      else run.endedAt = new Date().toISOString();
    }
    return { run, decision };
  }
}

export function renderTaskContract(contract: TaskContract): string {
  return [
    `Goal: ${contract.goal}`,
    ...(contract.instructions !== undefined ? [`Instructions:\n${contract.instructions}`] : []),
    `Scope:\n${contract.scope.map((item) => `- ${item}`).join("\n")}`,
    `Acceptance criteria:\n${contract.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    `Verification:\n${contract.verification.map((item) => `- ${item}`).join("\n")}`,
    `Constraints:\n${contract.constraints.map((item) => `- ${item}`).join("\n")}`,
    ...(contract.referenceLinks?.length ? [`References:\n${contract.referenceLinks.join("\n")}`] : []),
  ].join("\n\n");
}

export * from "./model-routing.js";
export * from "./task-classification.js";
