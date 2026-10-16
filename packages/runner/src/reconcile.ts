export interface ControllerRunSnapshot {
  runId: string;
  generation: number;
  leaseId: string;
  runnerId: string;
  workspace?: string;
  sessionId?: string;
  startCommandHash?: string;
  requiresNativeOwnership?: boolean;
}

export interface RunnerRunSnapshot {
  runId: string;
  generation: number;
  leaseId: string;
  processId?: number;
  workspace?: string;
  sessionId?: string;
  startCommandHash?: string;
  attached?: boolean;
  nativeState?: string;
  resultAvailable?: boolean;
}

export interface ReconcileDecision {
  runId: string;
  action: "KEEP" | "STOP_STALE" | "RECOVER" | "ATTENTION";
  reason: string;
}

export function reconcileRunnerState(
  runnerId: string,
  controllerRuns: readonly ControllerRunSnapshot[],
  runnerRuns: readonly RunnerRunSnapshot[],
): ReconcileDecision[] {
  const controllerById = new Map(controllerRuns.filter((run) => run.runnerId === runnerId).map((run) => [run.runId, run]));
  const runnerById = new Map(runnerRuns.map((run) => [run.runId, run]));
  const ids = new Set([...controllerById.keys(), ...runnerById.keys()]);
  return [...ids].sort().map((runId) => {
    const expected = controllerById.get(runId);
    const actual = runnerById.get(runId);
    if (!expected && actual) return { runId, action: "STOP_STALE", reason: "runner reports an unowned run" };
    if (expected && !actual) return { runId, action: "RECOVER", reason: "controller run is missing from runner" };
    if (!expected || !actual) return { runId, action: "ATTENTION", reason: "run ownership is unknown" };
    if (actual.generation > expected.generation) return { runId, action: "ATTENTION", reason: "runner generation is ahead of canonical state" };
    if (actual.generation < expected.generation || actual.leaseId !== expected.leaseId) {
      return { runId, action: "STOP_STALE", reason: "runner holds a stale generation or lease" };
    }
    if (expected.workspace && actual.workspace && expected.workspace !== actual.workspace) {
      return { runId, action: "ATTENTION", reason: "workspace identity differs" };
    }
    if(expected.startCommandHash&&actual.startCommandHash!==expected.startCommandHash)return {runId,action:"ATTENTION",reason:"native start descriptor differs or is missing"};
    if(expected.sessionId&&actual.sessionId!==expected.sessionId)return {runId,action:"ATTENTION",reason:"native session identity differs or is missing"};
    if(expected.requiresNativeOwnership&&actual.attached!==true&&!(actual.nativeState==="COMPLETE"&&actual.resultAvailable===true))return {runId,action:"ATTENTION",reason:"native process ownership is unconfirmed"};
    return { runId, action: "KEEP", reason: "runner and controller state agree" };
  });
}
