import { expect, it, vi } from "vitest";
import { codexManifest, AdapterContractError } from "@dispatcher/adapters";
import type { Run, ExecutionSelection } from "@dispatcher/domain";
import { RemoteNativeAdapter } from "../src/remote-adapter.js";
function fixture() {
  const selection: ExecutionSelection = { version: 1, mode: "manual", source: "explicit", profileId: "p", runnerId: "remote", providerId: "codex", backendId: "codex-exec-json", selectionType: "explicit-model", requestedModel: "model", nativeParameters: {}, contextFingerprint: "context", catalogRevision: "catalog", configRevision: 1, selectedAt: new Date().toISOString() };
  const run = { id: "run", profileId: "p", runnerId: "remote", providerId: "codex", sessionId: "unstarted:run", generation: 1, leaseId: "lease", leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), state: "STARTING", worktree: "C:\\work\\run", executionSelection: selection, lastActivityAt: "first" } as Run;
  const session = { id: "session", profileId: "p", runId: "run", backendId: "codex-exec-json", workspacePath: run.worktree, state: "RUNNING", processId: 42, executionSelection: selection, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const request = vi.fn(async () => session as unknown), save = vi.fn(), reserve = vi.fn();
  const adapter = new RemoteNativeAdapter({ profileId: "p", runnerId: "remote", manifest: codexManifest, run: id => id === run.id ? run : undefined, sessionRun: id => id === run.sessionId ? run : undefined, request, saveSession: save, reserveStart: reserve, active: () => true });
  return { adapter, request, run, session, save, reserve, selection };
}
it("starts only a reserved canonical Run with its frozen model and owning workspace", async () => {
  const f = fixture();
  await expect(f.adapter.start({ runId: "missing", workspacePath: f.run.worktree!, executionSelection: f.selection })).rejects.toMatchObject({ code: "RUN_AUTHORITY_MISMATCH" });
  await expect(f.adapter.start({ runId: "run", workspacePath: "/controller/path", executionSelection: f.selection })).rejects.toMatchObject({ code: "RUN_AUTHORITY_MISMATCH" });
  expect(f.request).not.toHaveBeenCalled();
  expect(await f.adapter.start({ runId: "run", workspacePath: f.run.worktree!, prompt: "raw instructions", executionSelection: f.selection })).toMatchObject({ processId: 42 });
  expect(f.request.mock.calls[0]?.[0]).toMatchObject({ type: "run.start", execution: { profileId: "p", workspaceId: "run", prompt: "raw instructions", selection: f.selection } });
  expect(f.reserve).toHaveBeenCalledOnce(); expect(f.save).toHaveBeenCalledOnce();
});
it("keeps dropped or mismatched start responses unknown and never reports a different native session as started", async () => {
  const f = fixture(); f.request.mockRejectedValueOnce(new Error("connection lost"));
  await expect(f.adapter.start({ runId: "run", workspacePath: f.run.worktree!, executionSelection: f.selection })).rejects.toMatchObject({ code: "COMMAND_OUTCOME_UNKNOWN" });
  f.request.mockResolvedValueOnce({ ...f.session, runId: "other" });
  await expect(f.adapter.start({ runId: "run", workspacePath: f.run.worktree!, executionSelection: f.selection })).rejects.toMatchObject({ code: "COMMAND_OUTCOME_UNKNOWN" });
  expect(f.save).not.toHaveBeenCalled();
  f.run.providerSessionId="original";f.request.mockResolvedValueOnce({...f.session,providerSessionId:"different-native-session"});
  await expect(f.adapter.start({runId:"run",workspacePath:f.run.worktree!,executionSelection:f.selection})).rejects.toMatchObject({code:"COMMAND_OUTCOME_UNKNOWN"});
});
it("binds input retries to the same raw message and intervention without reusing them for a later intervention", async () => {
  const f = fixture(); f.run.sessionId = "session"; f.run.state = "WAITING_USER";
  f.request.mockResolvedValue({ type: "session.message", sessionId: "session", occurredAt: new Date().toISOString(), data: { acceptedCharacters: 3 } });
  await f.adapter.send("session", "Ａraw"); await f.adapter.send("session", "Ａraw");
  expect(f.request.mock.calls[0]?.[2]).toBe(f.request.mock.calls[1]?.[2]);
  await f.adapter.send("session", "Araw"); expect(f.request.mock.calls[2]?.[2]).not.toBe(f.request.mock.calls[0]?.[2]);
  f.run.lastActivityAt = "next-intervention"; await f.adapter.send("session", "Ａraw"); expect(f.request.mock.calls[3]?.[2]).not.toBe(f.request.mock.calls[0]?.[2]);
  f.request.mockRejectedValueOnce(new AdapterContractError("LEASE_REVOKED", "revoked")); await expect(f.adapter.send("session", "late")).rejects.toMatchObject({ code: "LEASE_REVOKED" });
});
