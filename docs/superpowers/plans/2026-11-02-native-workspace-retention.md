# Restore native workspace retention through the owning Controller

Continue inline from125eb4fe; reuse its265/5887 accepted baseline. The missing
source is a499d84 NativeSessionRetention plus the WorkspaceManager retention
contract and original16 test declarations/18 cases. Controller previously supplied
that owner; the current candidate instead deletes clean-looking worktrees.

Outcome: native references, HUMAN/conflict/unknown command/cancel/tombstone facts
keep their execution workspace pinned. An independent unpinned worktree is retired
through the existing Git administration queue into .retained, preserving ignored
or late-arriving files and its Git branch. No production deletion, new maintenance
API, scheduler, persistence format, dependency, provider or credential work.

Scope: packages/workspace/src/workspace.ts and its workspace/worktree-concurrency
tests; original packages/workspace/test/native-session-retention.test.ts;
apps/controller/src/native-session-retention.ts, service.ts and one Controller
wiring test; necessary architecture/know-how/convergence metadata only.

- [x] Reproduce missing owner with the original retention test, then demonstrate
  data preservation through existing actual Git fixtures. Preserve original
  assertions and deadlines. Constructor adaptation keeps the current third
  private-path callback and adds the actual legacy retention source separately.
- [x] Port original durable pin inventory and source cleanup behavior. Capture
  managed physical identity on create/restore; recheck a cloned preview and pins
  inside the existing shared Git mutation queue. Keep current private-path/context
  safeguards and environment handling. No elapsed-time release or unpin action.
- [x] Connect Controller to the owner and verify a real fixture wiring path.
  Adapt existing remove-concurrency assertions to intentional move behavior:
  retain common-dir serialization, original-path departure, branch and contents.
  Run directly affected source/owner/controller regressions, no new broad matrix.
- [x] One unified milestone review, affected-only fixes, one final changed-code
  pnpm check on frozen code. Unrelated real-provider/control/stop Gates stay open.
- [x] Exact scoped commit, quota read, Linear milestone/scope readback and
  agent-gc dry run. Retained workspaces are source/user data, not cache candidates.

Primary19db456/three dirty files, other trees, schema18/writer14, immutable earlier
runtime/data, original assertions/unknown-effect barriers and all503 source owners
remain protected. No user worktree is moved or removed during this unit; only
owned test fixtures exercise retirement. Latest quota72%, noreset, safely stop
at<=7% after the unit. Ordinary local failures are reassessed after two rounds.

Milestone review found one actual queue-environment mismatch: inherited Git
selectors could key repositoryB while sanitized retirement moved repositoryA.
The two-repository regression first failed with B instead of A. Cleanup now passes
one captured inspection environment to the existing queue lookup and its move;
other callers retain their environment contract. Affected3files/26tests pass,
with four original functional hashes unchanged. Only affected-fix review follows.

I1 re-review exposed the directly adjacent sanitized snapshot-add consumer of the
same queue. Add packages/workspace/src/verification-snapshot.ts to this unit only
to align its queue lookup with its existing sanitized Git execution. Keep actual
snapshot/ordinary create semantics and data/permission contracts unchanged. The
existing two-repository regression now covers both retirement and verification.
This is the minimal shared-owner fix after reassessment, not a broader matrix.

I1 addressed after affected re-review: no remainingCritical/Important/Minor, all
seven functional hashes match. The snapshot path uses its existing sanitized
execution; only the queue lookup now follows that same physical-context rule.

Final default `mise exec -- pnpm check` terminalexit0:267files/5908tests and all
non-test gates,485.44s test phase. Seven final hashes match affected re-review;
original owner and source18case assertions remain exact with constructor adaptation.
Official remaining69%, usageallowed/noreset. agent-gc dry225.9GB/no candidates/
0removed. Primary19db456+three dirty file hashes and503source rows/seven immutable
columns remain protected. Real provider/control/stop/recovery/release and overall
goal remain open. Linear ownscope/important updates were saved/read back; final
commit receipt follows immediately after this scoped commit.
