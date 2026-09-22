import type { AdapterBackendSpec, AdapterManifest } from "./contracts.js";

export interface AdapterCompatibilityRow {
  adapterId: string;
  displayName: string;
  backendId: string;
  backendKind: AdapterBackendSpec["kind"];
  capabilities: string[];
  session: { resume: boolean; pause: boolean };
  input: { initial: boolean; interactive: boolean };
  artifacts: boolean;
  resource: boolean;
  unsupportedReasons: Record<string, string>;
}

export interface CapabilityAssessment {
  supported: boolean;
  missing: string[];
  explanation: string;
}

export function buildAdapterCompatibilityMatrix(manifests: readonly AdapterManifest[]): AdapterCompatibilityRow[] {
  return manifests.flatMap((manifest) => manifest.backends.map((backend) => {
    const capabilities = [...new Set(backend.capabilities)].sort();
    const supports = (capability: string): boolean => capabilities.includes(capability);
    const unsupportedReasons: Record<string, string> = {};
    if (!manifest.capabilities.resume && !supports("resume")) unsupportedReasons.resume = `${backend.id} does not expose a verified same-session resume contract`;
    if (!manifest.capabilities.pause) unsupportedReasons.pause = `${backend.id} does not expose pause semantics`;
    if (!supports("send") && !supports("interactive-input")) unsupportedReasons.interactiveInput = `${backend.id} accepts initial input only`;
    if (!supports("artifacts")) unsupportedReasons.artifacts = `${backend.id} does not publish structured artifact evidence`;
    if (!manifest.capabilities.usage && !supports("usage") && !supports("resource-probe")) unsupportedReasons.resource = `${backend.id} does not expose a resource probe`;
    return {
      adapterId: manifest.id,
      displayName: manifest.displayName,
      backendId: backend.id,
      backendKind: backend.kind,
      capabilities,
      session: { resume: manifest.capabilities.resume || supports("resume"), pause: manifest.capabilities.pause },
      input: { initial: supports("start"), interactive: supports("send") || supports("interactive-input") },
      artifacts: supports("artifacts"),
      resource: manifest.capabilities.usage || supports("usage") || supports("resource-probe"),
      unsupportedReasons,
    };
  })).sort((left, right) => left.adapterId.localeCompare(right.adapterId) || left.backendId.localeCompare(right.backendId));
}

export function manifestCapabilities(manifest: AdapterManifest): string[] {
  const capabilities = new Set(manifest.backends.flatMap((backend) => backend.capabilities));
  if (capabilities.has("send")) capabilities.add("interactive-input");
  if (manifest.capabilities.resume) capabilities.add("session-resume");
  if (manifest.capabilities.pause) capabilities.add("session-pause");
  if (manifest.capabilities.usage) capabilities.add("resource-probe");
  if (manifest.capabilities.diagnostics) capabilities.add("diagnostics");
  return [...capabilities].sort();
}

export function assessManifestCapabilities(manifest: AdapterManifest, requirements: readonly string[]): CapabilityAssessment {
  const available = manifestCapabilities(manifest);
  const missing = requirements.filter((requirement) => !available.includes(requirement));
  return {
    supported: missing.length === 0,
    missing,
    explanation: missing.length === 0
      ? `${manifest.id} satisfies ${requirements.length ? requirements.join(", ") : "the baseline contract"}`
      : `${manifest.id} is unsupported because it is missing ${missing.join(", ")}`,
  };
}
