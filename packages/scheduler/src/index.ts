import { randomUUID } from "node:crypto";
import type { ResourceState, Run, Task, TaskContract } from "@dispatcher/domain";
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
  }): Promise<{ run: Run; decision: RoutingDecision }> {
    if (input.task.state !== "READY" && input.task.state !== "QUEUED") throw new Error(`Task ${input.task.id} is not dispatchable from ${input.task.state}`);
    const decision = routeDeterministically(input.requirements, this.candidates());
    if (!decision.selected) throw new Error(decision.explanation);
    const runId = input.runId ?? randomUUID();
    const session = await decision.selected.adapter.start({
      runId,
      workspacePath: input.workspacePath,
      prompt: renderTaskContract(input.contract),
    });
    const now = new Date().toISOString();
    const run: Run = {
      id: runId,
      taskId: input.task.id,
      runnerId: decision.selected.runnerId,
      providerId: decision.selected.providerId,
      profileId: decision.selected.profileId,
      sessionId: session.id,
      ...(session.providerSessionId ? { providerSessionId: session.providerSessionId } : {}),
      resumePolicy: session.providerSessionId || decision.selected.adapter.manifest.capabilities.resume ? "same-session" : "controlled-reroute",
      state: "ACTIVE",
      attempt: 1,
      generation: input.generation ?? 1,
      leaseId: randomUUID(),
      taskRevision: input.taskRevision,
      contractRevision: input.contract.revision,
      worktree: input.workspacePath,
      startedAt: now,
      lastActivityAt: now,
      verification: { state: "PENDING", commands: [...input.contract.verification] },
    };
    return { run, decision };
  }
}

export function renderTaskContract(contract: TaskContract): string {
  return [
    `Goal: ${contract.goal}`,
    `Scope:\n${contract.scope.map((item) => `- ${item}`).join("\n")}`,
    `Acceptance criteria:\n${contract.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    `Verification:\n${contract.verification.map((item) => `- ${item}`).join("\n")}`,
    `Constraints:\n${contract.constraints.map((item) => `- ${item}`).join("\n")}`,
  ].join("\n\n");
}
