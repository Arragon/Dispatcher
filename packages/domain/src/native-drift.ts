import type { ExecutionSelection } from "./publication.js";

/** Frozen authorization context from trusted composition, never from a reclaim caller. */
export interface NativeDriftPolicy {
  version: 1;
  mode: "compatible" | "exact";
  permissionFingerprint?: string;
  /** An opaque hash of a provider-confirmed identity, not a profile/store alias. */
  accountFingerprint?: string;
}
export interface NativeDriftObserved {
  model?: { nativeSelectionId: string; reasoning?: string };
  permissionFingerprint?: string;
  accountFingerprint?: string;
}
type Comparison = "matched" | "changed" | "unknown";
export interface DriftReport {
  version: 1;
  allowed: boolean;
  code?: string;
  model: Comparison;
  permission: Comparison;
  account: Comparison;
  reported: { state: "reported"; nativeSelectionId: string; reasoning?: string } | { state: "unknown" };
  coverage: "complete" | "partial";
  requiresConfirmation: boolean;
  nextActions: Array<"restore-bound-context" | "create-new-run">;
}
const safeId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && Array.from(value).every(c => c.charCodeAt(0) >= 32) && !/(?:\b(?:[a-z][a-z0-9]*[-_])*(?:token|secret|password|credential|authorization|api[-_]?key|private[-_]?key)["']?\s*[:=]|\bBearer\s|\b(?:sk|ghp|github_pat|xox[baprs])[-_][\w-]{8,})/i.test(value);
export const isNativeAccountFingerprint = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
export function normalizeNativeDriftPolicy(value: NativeDriftPolicy): NativeDriftPolicy | undefined {
  if (!value || value.version !== 1 || !["compatible", "exact"].includes(value.mode) || value.permissionFingerprint !== undefined && !safeId(value.permissionFingerprint) || value.accountFingerprint !== undefined && !isNativeAccountFingerprint(value.accountFingerprint)) return undefined;
  return { version: 1, mode: value.mode, ...(value.permissionFingerprint ? { permissionFingerprint: value.permissionFingerprint } : {}), ...(value.accountFingerprint ? { accountFingerprint: value.accountFingerprint } : {}) };
}
/** Compare facts without changing the immutable selection or estimating usage/pricing. */
export function assessNativeDrift(boundSelection: ExecutionSelection, observed: NativeDriftObserved, policy: NativeDriftPolicy): DriftReport {
  const qualifiedPolicy = normalizeNativeDriftPolicy(policy);
  const rawModel = observed?.model;
  const reported: DriftReport["reported"] = rawModel && safeId(rawModel.nativeSelectionId) && (rawModel.reasoning === undefined || safeId(rawModel.reasoning)) ? { state: "reported", nativeSelectionId: rawModel.nativeSelectionId, ...(rawModel.reasoning ? { reasoning: rawModel.reasoning } : {}) } : { state: "unknown" };
  const validSelection = boundSelection?.version === 1 && ["explicit-model", "native-default"].includes(boundSelection.selectionType) && boundSelection.nativeParameters !== null && typeof boundSelection.nativeParameters === "object" && !Array.isArray(boundSelection.nativeParameters) && (boundSelection.selectionType === "explicit-model" ? safeId(boundSelection.requestedModel) : boundSelection.requestedModel === undefined && Object.keys(boundSelection.nativeParameters).length === 0);
  const explicit = validSelection && boundSelection.selectionType === "explicit-model";
  const effort = boundSelection?.nativeParameters?.reasoningEffort;
  const model: Comparison = !validSelection || !explicit || reported.state === "unknown" || effort !== undefined && (!safeId(effort) || reported.nativeSelectionId === boundSelection.requestedModel && reported.reasoning === undefined) ? "unknown" : reported.nativeSelectionId !== boundSelection.requestedModel || effort !== undefined && reported.reasoning !== effort ? "changed" : "matched";
  const permission: Comparison = !qualifiedPolicy?.permissionFingerprint || !safeId(observed?.permissionFingerprint) ? "unknown" : observed.permissionFingerprint === qualifiedPolicy.permissionFingerprint ? "matched" : "changed";
  const account: Comparison = !qualifiedPolicy?.accountFingerprint || !isNativeAccountFingerprint(observed?.accountFingerprint) ? "unknown" : observed.accountFingerprint === qualifiedPolicy.accountFingerprint ? "matched" : "changed";
  const code = !qualifiedPolicy ? "NATIVE_DRIFT_POLICY_INVALID" : !validSelection ? "MODEL_BINDING_DRIFT" : model === "unknown" ? "NATIVE_MODEL_UNVERIFIED" : model === "changed" ? "MODEL_BINDING_DRIFT" : permission === "unknown" ? "NATIVE_POLICY_UNVERIFIED" : permission === "changed" ? "NATIVE_POLICY_DRIFT" : account === "changed" ? "NATIVE_ACCOUNT_DRIFT" : qualifiedPolicy.mode === "exact" && account === "unknown" ? "NATIVE_ACCOUNT_UNVERIFIED" : undefined;
  return { version: 1, allowed: code === undefined, ...(code ? { code } : {}), model, permission, account, reported, coverage: [model, permission, account].includes("unknown") ? "partial" : "complete", requiresConfirmation: [model, permission, account].includes("changed"), nextActions: code ? ["restore-bound-context", "create-new-run"] : [] };
}
