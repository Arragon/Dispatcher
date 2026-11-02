# Qualify the installed Codex App Server protocol

Continue inline from36a4afca; reuse its265/5883 accepted baseline. One delivery
unit, one milestone review, affected-only fixes and one final changed-code gate.

Outcome: the installed0.166.0-alpha.5.1 can execute through the existing owned
App Server backend, preserving exact root identity, model and permission policy.
Generated stable/experimental schemas and their hashes are retained in the ignored
unit workspace. The official App Server contract defines sessionId as the session
tree root, while cliVersion identifies the version that created a thread.

Scope: packages/adapters/src/codex-app-server.ts and its existing backend/transport
tests; necessary architecture/know-how/current-progress documentation. Reuse the
current stdio transport, runtime and canonical publication; no SDK, new dependency,
codec abstraction, schema/writer change or credential migration. Old-created
threads remain fail-closed, with stored identity and old evidence preserved;
there is no automatic adoption, version wildcard or cold continuation.

- [x] Demonstrate root-session mismatch admission and current-version refusal with
  focused existing fixtures. Assert exact no-fallback startup selection.
- [x] Upgrade the exact qualified version and fixtures, validate root sessionId
  against thread.id before binding/read, and request provider fallback=false.
  Preserve original assertions, admission, model/permission and unknown-effect guards.
- [x] Run changed backend/transport and existing spawn/runtime regressions. Freeze
  an owned real acceptance scope before any account/model/thread/turn work; reuse
  existing acceptance setup without touching old live data or user installation.
  Observe actual response/stream/history and local cleanup, reporting exact limits.
- [x] One fresh milestone review, directly affected fixes only, final pnpm check.
- [x] Commit exact reviewed code, official quota read, milestone/blocker Linear
  sync with readback and agent-gc dry run. Keep original native control/GUI/stop,
  provider/release and all unrelated Gates open unless separately demonstrated.

Primary19db456 and its three dirty files, other worktrees, immutable earlier
runtime/data, ConfigPlan and credential ownership remain protected. No repository
push/PR/merge or real SCM delivery. P01/M17 priority and B-C serialization/conditional
consent remain unchanged. Latest official remaining73%; after unit re-read and
safely stop at<=7%, without reset. Ordinary unresolved local issues get reassessed
after two rounds; actual safety/identity/unknown-effect barriers cannot be bypassed.

Actual default-backend acceptance passed in7.965s: exact root binding, three native
facts, fixed marker completion, native observation gpt-6.1-sol/low and complete
two-entry history. Owned root24170 exited/ESRCH; local callbacks drained, background
tools unknown. Shared native home was explicit; this is not a canonical Task or
native exclusion/stop qualification. No provider retry or manual approval occurred.

Final review0Critical/Important/Minor; default `mise exec -- pnpm check` exit0,
265files/5887tests and all non-test gates,456.37s test phase. Reviewed three-file
functional tuple unchanged. Official remaining72%, ordinary usage allowed/noreset.
agent-gc dry run225.9GB free/no candidates/0removed. Primary and other trees remain
protected. Existing canonical startup regression retains NATIVE_STATE_UNKNOWN
until native evidence qualifies; do not repeat a real task to rediscover it.
