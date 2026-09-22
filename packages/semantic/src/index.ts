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
