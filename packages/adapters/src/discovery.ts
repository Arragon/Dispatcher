import { validateManifest, type AdapterManifest, type ProbeSpec } from "./contracts.js";

export interface DiscoveryCandidate {
  id: string;
  installationPath: string;
  version?: string;
  backendIds: string[];
  authenticated: boolean;
  capabilities: string[];
  evidence: Array<{ probeId: string; summary: string }>;
}

export interface ProbeOutcome {
  candidates: DiscoveryCandidate[];
  diagnostic?: string;
}

export type ProbeExecutor = (input: { runnerId: string; probe: ProbeSpec; signal: AbortSignal }) => Promise<ProbeOutcome>;

export interface DiscoveryResult {
  status: "NONE" | "ONE" | "MULTIPLE" | "NEED_USER_INPUT" | "BLOCKED";
  candidates: DiscoveryCandidate[];
  reason?: string;
}

function sanitize(value: string): string {
  return value.replace(/\b(?:sk|ghp|xoxb)[-_][A-Za-z0-9_-]{6,}\b/gi, "[REDACTED]").slice(0, 240);
}

export class DiscoveryEngine {
  private readonly manifests = new Map<string, AdapterManifest>();
  private readonly executors = new Map<string, ProbeExecutor>();

  register(manifest: AdapterManifest, executors: Record<string, ProbeExecutor>): void {
    const valid = validateManifest(manifest);
    for (const probeId of Object.keys(executors)) {
      if (!valid.probes.some((probe) => probe.id === probeId)) throw new Error(`Probe ${probeId} is not declared by manifest ${valid.id}`);
    }
    this.manifests.set(valid.id, valid);
    for (const probe of valid.probes) {
      const executor = executors[probe.id];
      if (!executor) throw new Error(`Missing executor for declared probe ${probe.id}`);
      this.executors.set(`${valid.id}:${probe.id}`, executor);
    }
  }

  async discover(input: { adapterId: string; runnerId: string; probeIds?: string[]; signal?: AbortSignal }): Promise<DiscoveryResult> {
    const manifest = this.manifests.get(input.adapterId);
    if (!manifest) return { status: "BLOCKED", candidates: [], reason: "UNKNOWN_ADAPTER" };
    const selected = input.probeIds ?? manifest.probes.map((probe) => probe.id);
    if (selected.some((id) => !manifest.probes.some((probe) => probe.id === id))) return { status: "BLOCKED", candidates: [], reason: "PROBE_NOT_ALLOWLISTED" };
    const candidates = new Map<string, DiscoveryCandidate>();
    for (const probeId of selected) {
      const probe = manifest.probes.find((entry) => entry.id === probeId)!;
      const executor = this.executors.get(`${manifest.id}:${probeId}`);
      if (!executor) return { status: "BLOCKED", candidates: [], reason: "PROBE_EXECUTOR_MISSING" };
      const timeout = AbortSignal.timeout(probe.timeoutMs);
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
      let outcome: ProbeOutcome;
      try { outcome = await executor({ runnerId: input.runnerId, probe, signal }); }
      catch (error) { return { status: "BLOCKED", candidates: [], reason: error instanceof DOMException && error.name === "TimeoutError" ? "PROBE_TIMEOUT" : "PROBE_FAILED" }; }
      for (const candidate of outcome.candidates) {
        const clean = structuredClone(candidate);
        clean.evidence = clean.evidence.map((entry) => ({ probeId: entry.probeId, summary: sanitize(entry.summary) }));
        candidates.set(clean.id, clean);
      }
    }
    const values = [...candidates.values()].sort((left, right) => left.id.localeCompare(right.id));
    if (values.length === 0) return { status: "NONE", candidates: [] };
    if (values.some((candidate) => !candidate.authenticated)) return { status: "NEED_USER_INPUT", candidates: values, reason: "AUTH_MISSING" };
    if (values.length > 1) return { status: "MULTIPLE", candidates: values, reason: "AMBIGUOUS_INSTALLATION" };
    return { status: "ONE", candidates: values };
  }
}

