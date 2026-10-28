# Durable Project Know-how

## RHIZA integration ownership

- Scheme B gives external-Agent physical execution to Dispatcher and business
  Workflow/Evaluate/acceptance to RHIZA. Reuse the one ingress and existing native
  Adapter/Runner boundaries; ordinary RHIZA Provider calls cannot conceal shell
  execution. Pin the generated wire artifact, never import the other product's
  TypeScript, database or credentials.
- RHIZA's exact frozen target must bypass local automatic Policy selection without
  weakening canonical admission. Preserve local manual/policy and none/commit/PR
  behavior. An external protocol limited to code+PR does not imply other local
  delivery modes or research/document Agent tasks are externally supported.
- Compatibility and convergence branches can have different schema/writer catalogs.
  Compare fixed source, SQL/afterApply, writer gates and original rollback fixtures
  before adoption; a larger migration number is not evidence of compatibility.
  Never renumber a live database, downgrade its writer gate or infer a live database
  version from a checkout. Keep observation admission distinct from one-shot start
  permission when reusing committed compatibility work.
- Retrying an external business request means querying the original semantic key
  and immutable receipt. New business rework needs an explicit new attempt; native
  physical retry remains Dispatcher-owned. Accepted/ACK/terminal/idle and an empty
  queue cannot substitute for execution, physical-stop or quiescence evidence.

## M0–M10 invariants

- Native capabilities can change between reads. For legacy metadata projection,
  use readInteractionCapabilities to validate and return one captured declaration
  against its actual port. Calling capabilities() again after getInteractionPort
  validates a different value and can report support without a callable. Keep the
  original receiver/port and separate metadata from native mutation admission.

- Do not pass `process.env` directly to task/provider/probe/verification/Git
  children. The CLI may hold DISPATCHER_OWNER_TOKEN and
  DISPATCHER_SECRET_STORE_KEY. Use childExecutionEnvironment after overlays;
  keep actual provider context and normalize PWD separately. Redacting output
  cannot revoke an authority credential already inherited by a process.

- A native stdio root can exit while its background child keeps stdout/stderr
  open. Reject pending RPC waits on the root's exit event, then drain only local
  handles; waiting for `close` conflates root lifetime with inherited pipe life.
  Root-only cleanup cannot establish background-tool or native-writer release.

- Codex thread identity is allocated by the provider, unlike Pi's reserved UUID.
  Adopt it only for the original unbound STARTING invocation, persisting provider
  identity and binding together before the durable event. A final admission
  callback can itself change identity or state: validate both before and after
  it, and never accept a Promise as synchronous permission. Historical partial
  identity needs reconciliation rather than completion from current config.

- A durable native-event sink may return a Promise. Keep the raw admitted work
  owned through local disconnect, await startup persistence before prompting and
  terminal persistence before settling the result. Cancelling a local wait does
  not cancel a database write; a bounded shutdown must retain callbacks unknown
  while that write is still pending, even if the owned native root has exited.

- Fastify hijacked dashboard SSE responses must be ended before awaiting
  `app.close()`. Waiting for server close first leaves an open browser holding
  graceful shutdown. Own each response cleanup once, including its timer and
  subscription, and reject new streams once Controller stopping begins.

- Verification candidate materialization must clear inherited GIT_DIR/GIT_WORK_TREE
  overrides and disable checkout hooks/fsmonitor. A detached worktree add can
  invoke post-checkout; index isolation alone does not make it side-effect free.
  Unknown Git filters/partial clones/submodules require a separate qualified
  materialization contract. Retain uncertain snapshots rather than force-clean.

- Native directory cancellation completes only after owned process-group absence
  and callback close; uncertainty blocks another dialog. Use StringDecoder for
  native UTF-8 pipe chunks. A locked-host API cancellation is cleanup evidence,
  never a successful native dialog or Chinese/space-path GUI acceptance.

- Cost estimates retain decimal strings and reduced BigInt fractions through all
  segments, with one final scale-18 half-up rounding. Observed/collected times
  cannot allocate billing intervals; missing cache inclusion is not exclusion.
  Pure calculation with supplied evidence is separate from price admission.

- A release hash alone does not prove its CLI implements startup admission.
  Measure the packaged runtime-contract and record it in manifest v2 before
  service binding; never infer that fact for older v1 artifacts. Keep stop and
  read-only diagnostics available even when inventory verification fails.

- A pnpm deploy directory can still depend on a worktree: verify actual symlink
  targets, hardlinks and relocation. On pnpm 11.19, deploy flags also rewrote the
  source dependency-state cache and made later checks attempt a production-only
  install. Build deployment from an isolated workspace snapshot; restore source
  development state with the ordinary frozen offline install, not a permanent
  check bypass. Hash a detached artifact after native smoke can fix helper modes.

- A new restore directory must win the same ownership primitive as Controller
  before copying records or writing its barrier. If another owner wins the
  mkdir-to-lock interval, leave its files intact. On macOS, canonicalize /var and
  /private/var when injecting a directory-boundary race; assert that the competing
  owner was actually installed before interpreting the test result.

- Log retention owns an explicit stream family, not every *.log in a directory.
  Keep foreign diagnostics intact and bound even one retained file when the total
  budget is smaller than the per-file budget. Structured consumers must write
  whole records individually and replace oversized entries with metadata; raw
  byte truncation can hide following records. Never infer that rotating an app's
  structured logs also bounds launchd's already-open stdout/stderr descriptors.

- SQLite readOnly can still create WAL/SHM sidecars beside a source database.
  CLI doctor inspects a bounded private main/WAL copy after checking source
  stability; do not delete source sidecars to make a read appear unchanged.
  Compare the entire source file set by hashes in regression tests. Raw source
  descriptors must remain outside a process that holds business SQLite locks.

- `launchctl kickstart -k` kills an existing Controller; it is not a graceful
  restart. Disable before bootout for persistent explicit stop, wait for the
  reported PID and verify data-directory ownership before restart. A missing
  service label alone does not prove a manually started Controller stopped.
  Keep failed or differing definitions for inspection instead of blind bootout.

- Keep the Controller instance-lock SQLite file separate from the business WAL
  database and never delete/recreate it to clear ownership. On POSIX, opening and
  closing an extra descriptor to an existing lock inode can release locks held
  by this process. Test contention using separate real processes, including after
  a rejected same-process attempt; a same-process-only test misses that defect.

- A cancellation request is not terminal execution evidence. Keep its input
  latch separate and report completion only after owned-group drain. Generic's
  default SpawnProcessExecutor and Controller's ProcessManager executor are
  different implementations; inspect the actual consumer before claiming impact.

- Capture a reroute fence before its queue/preflight awaits. The original Run
  becomes terminal before replacement reservation, so post-stop reuse needs a
  narrow stage guard, not a fresh general mutation fence. Require the original
  revoked lease, unchanged Task/control and scoped stop proof; preserve dirty
  worktree files on rejection. Settled idempotency reads still bypass writes.

- A reserved Dispatcher Session UUID exists before the native SDK runs. Startup
  recovery must read its command receipt, not infer creation from that UUID.
  ACK proves creation, not liveness after Controller restart. Keep RESERVED
  no-send evidence intact; explicit cancellation may atomically settle it without
  SDK I/O. Test rollback against the entire Run/Task records, not state alone.
- Replacement startup must use the same reservation/final admission as ordinary
  startup, with its actual attempt/generation. A stale Task may justify stopping
  the original attached CLI only under the captured control fence. Recheck after
  preparation and directly before cancel; do not turn owned wrapper termination
  into native session/capacity proof or settle its UNKNOWN start receipt.
- Startup recovery must cover canonical Runs without publication records. Match
  the qualified journal and original queued Task revision before completing a
  not-created failure projection. Do not acknowledge a later edit or infer an
  attached process from ACK. A failed Task projection can leave Run FAILED and
  Task QUEUED; project the known fact once, without another SDK operation.

- ExecutionSelection.contextFingerprint may describe a native model catalog; it
  is not always the base execution-context fingerprint. Preserve separate checks
  for catalog choice and the captured profile/workspace credential context.
  Classify local ENOENT only from a real error code, not message text.

- Interaction commands store a semantic hash, not their full reservation input.
  Recovery must reconstruct and compare that exact frozen input read-only; never
  call reserveCommand as a probe after Task revisions advance. An initial
  AUTOMATED control row alone cannot qualify a source candidate for recovery.

- Stop/pause admission must run after adapter preparation awaits. Confirm that
  the adapter actually called it before trusting success. Keep Generic CLI's
  cancellation latch before a detached-start check, after admission, so a late
  owned process cannot escape cleanup. Unknown stop acknowledgement retains the
  existing Session stop fence and does not authorize another blind SDK call.
- Failure cleanup must abort its owned verification before waiting for the lane
  held by that verification. Confirming the adapter stopped does not prove a Git
  command or descendant drained. Keep stop audit on the existing Session row
  across adapter saves; notification-only errors cannot invalidate known cleanup.

- Usage queries cannot run inside the Session mutation lane or business progress
  awaits. Keep execution facts from owned status/results separate from telemetry
  read health. A read failure is not provider-down proof; queued/late reads must
  retain their original account, invocation and control scope.

- Native input cleanup uses its captured control/invocation fence. A lost reply
  does not authorize cancellation of a new control owner or a second input.
  Persist the accepted input outcome before notification-only work; notification
  failure must not make a known native result uncertain.

- Native database migrations need both the schema and the connection-local
  `dispatcher_writer_protocol()` function. A schema-5 database is not compatible
  with a binary that only knows migrations 1–3; do not delete writer triggers.
- Convergence schema 6 requires writer protocol 2. Protocol 1 understands native
  control but not v3 immutable selections. Backups must use the protocol from
  their own schema; upgrading only a restored copy must not change the source.
  Rolling back an outer transaction must also restore connection writer state.
- Control runtime schema 7 requires protocol 3. Protocol 2 intermediate binaries
  do not guard all control paths; an already-open connection must be fenced as
  well as rejecting an old binary at startup. Keep migrations 4/5/6 unchanged.
- Guarded local startup schema 8 requires writer protocol 4. Protocol-3
  intermediate readers can recognize the initial control journal without having
  final startup admission. Reject their open connections as well as new opens.
  Preserve migrations 1–7; snapshot schema 7 still needs writer 3 for archive and
  restore bookkeeping. Rollback uses a compatible binary and matching backup.
- Automatic verification schema9 requires writer5: protocol4 cannot interpret
  per-command UNKNOWN and could replay a registered check after restart. Preserve
  migrations1–8 and reject already-open old writers too. Schema8 backup bookkeeping
  still uses writer4; rollback requires its matching backup and binary, never
  trigger removal or schema downgrade.
- Usage producer origins require schema10/writer6. An old writer can otherwise
  materialize a collector alias as a second event. Preserve migrations1–9 and
  schema9 archive writer5; upgrade only a restored copy. Never backfill origin,
  attempt or billing occurrence into immutable legacy observations. Snapshot
  ordering must use proven native occurrence, not whichever collector arrived first.
- A caught failure inside an outer SQLite transaction needs a savepoint to
  undo partial native binding/projection writes. Merely detecting an existing
  transaction and running the inner callback is not atomic.
- Backup archives and restored databases intentionally refuse live startup.
  Archive and restore-pending markers must not be removed to force recovery;
  reconcile provider/Run receipts before authorizing any replay.

- The frozen architecture/roadmap dated 2026-09-15 is authoritative over the
  tracker. Tracker differences are reconciled to the document, not vice versa.
- `domain` and `protocol` are pure contracts. Run `pnpm boundaries` after any
  dependency or import change involving either package.
- Embedded Mode changes transport, not protocol semantics. It uses the same
  envelope, message taxonomy, sequence checks, and error classification that a
  future remote Runner will use.
- `RESOURCE_BLOCKED` and `WAITING_RESOURCE` are recoverable states, not generic
  failures. Do not collapse them into `FAILED`.
- SQLite migration functions must remain replay-safe. Validate both a new
  database and an older fixture; a failed migration must leave the prior schema
  usable.
- Configuration revisions are optimistic concurrency tokens. UI, setup wizard,
  imports, and assistants must create a plan from a known base revision and
  surface revision conflicts instead of silently retrying with overwrite.
- Secret values never enter the canonical configuration document. Persist only
  opaque `secret://namespace/name` references. Secure UI inputs must remain
  outside RJSF form state.
- Local Dashboard password login uses the fixed `admin` username only over the
  loopback interface. Store the salted scrypt hash in SecretStore, not canonical
  config; changing it revokes browser sessions. One-time links and the owner
  token remain recovery and API paths.
- Enabled integrations must use their own namespace (`secret://linear/...`,
  `secret://github/...`, or `secret://slack/...`) and the referenced item must
  exist before a ConfigPlan can apply. Secret resolution additionally checks
  the caller principal and integration/provider/LLM purpose.
- Refuse SecretStore deletion while the current canonical configuration uses
  the reference. The user must first apply a disabling/removal ConfigPlan; this
  prevents a valid active configuration from being made unusable out of band.
- The non-macOS encrypted store intentionally fails closed when its master key
  is absent, weak, wrong, or the file permissions are broader than 0600.
- macOS `security ... -w` prompts twice and reads from a terminal. The Keychain
  backend supplies both prompts through a pseudo-terminal pipe so the value
  never appears in process arguments; changing that subprocess path requires a
  real Keychain smoke test, not only an injected executor test.
- RJSF must use an Ajv 2020 instance. Its default Ajv validator targets an older
  schema dialect and will render the form but reject submission of the shared
  Draft 2020-12 schema.
- Performance reports separate measured values from targets. Scenarios that
  require the execution harness must use a real harmless child process and Git
  worktree; do not synthesize agent-run measurements.
- Internal LLM endpoint credentials remain `secret://llm/...` references in
  canonical config. Resolve them only at the protocol invocation boundary;
  never include values in normalized requests, response objects, health state,
  logs, errors, audit records, or Web payloads.
- A manual LLM switch is probe-then-commit. Failure preserves the previous
  active profile. Automatic fallback follows the configured pool order;
  automatic failback requires repeated healthy probes instead of a single
  transient success.
- `DEGRADED_NO_LLM` degrades semantic features only. Health may report degraded,
  but Dashboard, ConfigPlan, SecretStore and deterministic Controller paths must
  stay available.
- Adapter discovery is an ID allowlist over manifest-declared probes. Do not add
  a raw command/path field to discovery requests. Probe free text is redacted
  and summarized before it enters trusted state.
- Generic CLI command templates have a fixed executable and argv array, run
  with `shell: false`, and allow placeholders only as complete argv values.
  Keep provider discovery on an allowlisted `--version`/health probe and never
  turn a user string into a shell command.
- Cursor and Kiro CLI credentials are `secret://` references resolved only at
  process start into provider-specific environment variables. Version/auth
  probes prove installation and login, not a business invocation.
- OpenCode desktop's bundled v2 CLI and a PATH v1 CLI can coexist. Prefer the
  known macOS app-bundled v2 path, or select an explicit executable; v1 lacks
  `--standalone` and is rejected by the native adapter capability probe.
- Bind both child `cwd` and `PWD` to the worktree. OpenCode v2 consulted the
  inherited PWD and wrote in Controller's directory despite the correct child
  cwd. Real file verification detected it; normalizing PWD fixed the invocation.
- Headless CLI errors can be JSON on stdout with exit code zero. Inspect native
  error records, retain resource evidence across later output, and distinguish
  unavailable model configuration from provider outages. OpenRouter HTTP 402
  and pi's missing API-key diagnostic are resource/auth failures.
- Native JSON exit zero needs execution evidence, not merely initialization or
  parseable informational records. Empty or invalid-only output must fail closed.
- Unix child `close` does not prove its process group exited. A tool descendant
  can ignore SIGTERM with detached stdio; retain SIGKILL escalation until the
  group has stopped. Awaited cancellation also fences profile replacement.
  Apply the same rule to ProcessManager process/PTY handles, including normal
  parent exit. Keep them active and delay result acknowledgement until owned
  group absence is observed. A permission-uncertain presence check is still
  potentially alive: retain the bounded deadline and fail unconfirmed unless a
  later check proves absence; never translate EPERM directly into success.
- ConfigPlan apply must preserve unchanged adapter instances for every provider: replacing
  them drops live process handles. Reject replacement/removal while startup,
  follow-up or cancellation is pending, and keep the typed runtime rejection
  after transaction rollback so operators know to finish or cancel first.
  Legacy SDK/HTTP starts need a Controller reservation before their first await,
  since no session row exists until the provider responds. Bind retention to the
  owning Runner mode/credential reference too; display labels and capacity are
  independent. A completed native turn does not release a verifying canonical Run.
- Grok's `--session-id` creates a new conversation; `--resume` continues one.
  A prompt starting with `-` requires the `--single=<prompt>` argv form. On
  Grok 1.0.46, `acceptEdits` and scoped Write/Edit allow rules did not approve
  the observed native `write` tool in headless mode. Explicit `approveTools`
  opts into `--always-approve`; default profiles preserve native policy.
- CLI print/JSON mode accepts follow-up turns after completion, not live
  permission responses. Never start two turns against one provider session.
  Native credential discovery must not call export/print-credential commands.
- Devin v3 has verified create/get/message session operations, waiting/resource
  normalization, and PR evidence. Do not claim remote cancel support until an
  official endpoint is verified; the adapter intentionally declares no cancel
  capability.
- An HTTP cancel response with no state or an unknown/running state is not a
  stop acknowledgement. Drain earlier input requests before issuing stop, fence
  later inputs immediately, and retain uncertainty when provider or disk writes
  fail. Local canonical cancellation must also abort and await verification,
  then drain the existing advancement before reporting CANCELLED.
- WorkBuddy/CodeBuddy local-service paths are configuration, not guessed vendor
  defaults. Every session endpoint must place `{sessionId}` in its own path
  segment so percent-encoding cannot escape the configured endpoint shape.
- Routing capabilities come from the selected AdapterManifest backend plus the
  Runner, never from provider-brand conditionals. Persist required capabilities
  on the Run so manual reroute is checked by the same hard gate.
- Keep standalone trial reservations separate from startup profile-change guards:
  a provider can await creation before any session row exists. Count reservations,
  unresolved independent sessions and nonterminal canonical Runs together; exclude
  canonical sessions by both explicit session ID and matching Run/profile identity
  so a STARTING session does not consume a second slot before its acknowledgement.
  Refresh only attached local handles before admission/config replacement, never
  issue HTTP/remote provider queries as part of capacity accounting. Replay a
  committed dispatch before any refresh, and keep unresolved detached occupancy.
- One Run owns one writable worktree. Canonicalize every candidate path against
  the real worktree root, then enforce declared scope paths; lexical prefix
  checks alone do not stop symlink escape.
- Worktree cleanup is planned before execution and fails closed on dirty,
  unknown, or out-of-root paths. Never force-remove uncommitted user work.
- Raw Agent output belongs in redacted, bounded rotating files. SQLite stores
  normalized metadata and summaries only. Slow observers must not create an
  unbounded in-memory queue.
- Verification commands are repository/project registrations, not request
  strings. Required failures block delivery; optional failures remain visible
  without being promoted to success.
- Connector definition IDs are namespaced by kind (`task.*`, `messaging.*`,
  `scm.*`). Capability versions describe behavior; configured instances carry
  credentials, health, and revisions. Do not merge the two concepts.
- External IDs and provider revisions live in `ExternalBinding`. Canonical
  entities keep stable local IDs; provider-only fields stay under
  `platformExtensions` and must not leak into scheduler/domain decisions.
- Canonical task mutation and projection enqueue are one transaction. A remote
  outage is represented by pending/retried/dead-letter outbox state, never by
  rolling back a committed canonical revision.
- Webhook signatures are computed over exact request bytes before JSON
  normalization. Apply size and time-window limits first, deduplicate on the
  provider event ID, and never persist the raw provider payload.
- Projection events include connector identity, canonical revision, and a
  stable idempotency key. Treat a matching origin/revision as echo, not as a new
  canonical edit.
- A TaskDraft with missing repository, scope, acceptance criteria, or
  verification becomes `NEEDS_SPEC`. Scheduling a partial contract is a policy
  bypass, not a fallback.
- Deterministic routing filters capability, capacity, runner tags, provider,
  and resource state before stable identity ordering. LLM output must never
  override these hard gates.
- Every task dispatch resolves a registered repository and creates a managed
  worktree. Manual Codex APIs reject paths that are not registered by the
  current WorkspaceManager.
- Delivery is fenced by the current run generation and lease and requires
  passed verification. Commit, PR, and CI records are durable evidence with
  idempotent external identities; retries must not create duplicate PRs.
- Remote Runner transport uses the mature `ws` package (MIT, pinned at 8.21.3)
  rather than a custom WebSocket implementation. Bearer credentials travel in
  the Authorization header, never in protocol payloads; a non-loopback listener
  must be attached to a TLS server. Runner journal entries are checksummed and
  replayed by sequence, while delivery authority is re-fenced before branch,
  push, pull-request, and completion mutations.
- A transport response cache is not native execution authority. The owning
  Runner persists Run reservations and operation receipts separately, before
  side effects. Lost process handles after restart remain OUTCOME_UNKNOWN;
  a stored PID must never be treated as an attached or resumable process.
  Native adapters must save STARTING after asynchronous credential preparation
  and before spawn, so the SessionStore can recheck the current lease at that
  final boundary. Verification children also need abort signals on revocation.
- Runner registration CLI and service share one ConfigPlan database. Acquire
  its atomic single-writer claim before reading execution recovery records;
  a second live process must fail without rewriting RUNNING as unknown.
  Local configuration commands run while the service is stopped. Controller
  authorization loss (WebSocket1008) ends reconnect attempts and cancels owned
  execution; ordinary connection loss stays bounded by the existing lease.
- A repository and selected account must resolve to the same owning Runner.
  Remote root syntax is validated without interpreting it on Controller;
  actual Git/root/scope checks run on that device. Comparing only a repository
  ID is insufficient: publication inspection must also match the owning root
  registration and frozen verification commands. Global Policy qualification
  excludes repositories on other Runners.
- `COMMAND_OUTCOME_UNKNOWN` is a startup authority outcome, not a known failed
  process. Scheduler preserves RUNNER_UNAVAILABLE and the publication keeps an
  OUTCOME_UNKNOWN receipt; neither may trigger another native start. Keep the
  Runner slot until canonical verification/result delivery is finalized, even
  when the native turn already reports COMPLETED. Use configured capacity as
  an admission ceiling over a device's reported capacity.
- Reconnect must flush old outgoing frames before answering new RPCs, and late
  replies from the former socket must still enter the current ordered stream.
  Merely replaying at the end of an asynchronous start leaves a sequence race.
  Native ownership reconciliation additionally binds the original start hash
  and session identity; stored PIDs alone are insufficient. Durable completed
  result evidence may survive Runner restart without claiming a live handle.
- Native PTY uses Microsoft `node-pty` (MIT, pinned at 1.1.0) for Unix PTY and
  Windows ConPTY. pnpm must explicitly allow its native build; some pnpm
  installations lose the executable bit on the packaged Unix `spawn-helper`,
  so Runner repairs that one known helper path before spawning. Platform code
  stays in `runner`; scheduler/domain see only capability strings.
- A stored `VERIFYING` phase is not an invocation receipt. Registered checks can
  have side effects: journal each send before spawning, retain UNKNOWN after a
  crash or post-await authority loss, and never retry it from phase alone. Local
  VERIFYING recovery without a receipt is also unknown. SETTLED results require
  the original command semantics and Task/control/lease fence before reuse.
  Persist `DELIVERING` before an SCM call and obey its separate durable receipts.
- Codex profiles isolate `CODEX_HOME`; Web/API surfaces expose alias and
  normalized status only. A CLI probe and a real business invocation are
  separate pieces of evidence.
- Codex quota and rate-limit signals become durable profile ResourceSnapshots.
  Block the Run/task and future routing on that profile; do not collapse a
  provider resource condition into task failure.
- Codex approval or input-required signals are `WAITING_USER`, not failures.
  Resume through the existing provider session ID, then restore Run/task active
  state before advancing the pipeline.
- A task-platform switch changes the primary connector binding, not execution
  identity. Dry-run unsupported fields first; preserve task ID, TaskContract,
  Run history, and delivery evidence throughout the switch.
- Fleet is a disposable projection over canonical records. Never repair an
  inconsistency by editing Fleet state; fix the canonical record and rebuild.
- Meaningful activity is deterministic. Heartbeat/observer noise must not clear
  a stall, while real activity clears suspect/stalled state on the next rebuild.
- Dashboard event history is bounded and coalesced by type/entity key. An
  expired reconnect cursor requires a reset snapshot. EventSource is the
  refresh path; do not add a hidden polling loop.
- Typed Intent v2 is the only semantic execution input. Resolve external IDs
  and aliases to canonical IDs first; ambiguous or missing resolution enters
  clarification and never silently chooses the first match.
- Semantic tools are allowlisted with bounded schemas and risk levels. Recheck
  role and confirmation at execution. Assistants may call ConfigPlan APIs, but
  may not write tables or execute arbitrary shell commands.
- Reject literal credentials before an LLM request. Assistant and Slack flows
  request secure input and pass only `secret://` references.
- Approval and clarification use durable optimistic-concurrency records. A
  stale workflow revision must not execute after restart or a newer decision.
- A Qoder first invocation owns an explicit provider session ID; every later
  send/resume uses that same ID. Controller and provider session IDs are
  distinct and must not be substituted.
- Qoder usage/credit parsing uses shared ResourceSnapshot states. A Qoder quota
  event blocks Qoder capacity only and must not make Codex globally unavailable.
- Scheduler candidates derive `providerId` from the configured profile. A
  hard-coded provider in Controller reintroduces single-provider coupling.
- Slack HMAC is computed over exact raw bytes and guarded by timestamp and
  replay checks before parsing. Never reserialize JSON for signature checking.
- Slack display names are presentation only. Authorization requires a durable,
  admin-approved PrincipalBinding; unknown and revoked principals fail closed.
- A Slack intervention thread binds to one task/run/session generation. Replies
  and buttons recheck binding revision and generation before resuming the
  original provider session; stale controls are conflicts.
- SQLite JSON extraction and JavaScript decoding disagree on duplicate keys.
  Exact conversation selection must recognize either tuple-key order before
  rejecting an ambiguous selected row; a corrupt latest binding cannot become
  absence and open an older/default route. Keep validation in the shared
  Controller selector rather than individual notification consumers.
- A successful threaded control notice is an external delivery fact. Recheck
  current Run/control authority and the latest exact binding after await before
  pinning its epoch; retain a concurrent WAITING_USER state. A lost authority
  cannot undo the reply or authorize another native command.
- Remote notifications are attention-only and idempotent. Deduplicate per
  task/state/generation with cooldown and do not stream routine activity.
- Persist only normalized Slack Inbox records. Redact credential-shaped text
  before persistence, and route the user to a short-lived signed Dashboard
  link; never echo or audit the submitted literal.
- Slack approval buttons identify a semantic workflow plus its expected
  revision. Recheck the durable principal, roles, and revision before execute;
  stale or cross-principal buttons fail closed.
- A tool's post-await history guard does not cover later registry/workflow
  promise continuations. Reauthorize messaging history success in the same
  synchronous transaction as its durable save, and again before disclosure or
  replay. Keep FAILED persistence available when that success guard rejects.
- Ordinary automated intervention bindings may omit their optional control
  epoch. Preserve that legacy continuation contract while native workflow
  capture requires the exact current epoch. Workflow approval revision is
  distinct from conversation revision; neither substitutes for the other.

## Tooling details

- Delivery evidence insertion is intentionally idempotent (`INSERT OR IGNORE`).
  Use `updateDeliveryEvidence` with its current revision for CI/PR changes;
  calling the insert method again silently retains the old evidence. No schema
  migration is needed: the existing evidence JSON carries its revision.
- Workspace package imports resolve built `dist` files. Rebuild changed
  packages before Controller integration tests, or a passing source-unit test
  can coexist with an integration test exercising old code.
- A Linear binding's external ID is the issue UUID. Its human identifier
  (`INH-xxx`) is stored in the normalized task platform extension and must be
  included separately in semantic aliases.
- `doneOnCiPassed` defaults to false. Configuring it true makes CI success a
  terminal acceptance decision; later CI regression produces comments and
  Slack feedback. The canonical domain does not automatically reopen DONE;
  an operator must decide how to track any follow-up work.
- Run advancement may await verification or GitHub while heartbeats renew its
  lease. Recheck the stored state/generation before saving and preserve the
  latest expiry; saving the original snapshot shortens the durable lease.
- Waiting episodes need distinct canonical command IDs. A Run-only command
  key deduplicates the second WAITING_USER transition after resume. Consumed
  Slack answers need durable receipts independently of notification delivery;
  retrying the old inbox message must not answer a later question.
- Reserve Run/task dispatch before adapter startup, then use the latest task
  revision when finalizing. A harmless concurrent comment otherwise leaves a
  live Run outside its canonical task lifecycle.
- Remote runner shutdown waits for in-flight command results to reach the
  journal. A reply belongs to its originating socket and must not be sent
  through a replacement connection.

- Required runtime: Node.js 24.22.1+ and pnpm 11.19.
- `pnpm typecheck` builds project references first. Calling an individual
  package typecheck from a clean tree may otherwise lack referenced declarations.
- Controller tests should pass a fake `SecretStore`; production construction on
  macOS intentionally selects Keychain.
- Build order is represented by workspace dependencies. Controller consumes the
  built Web directory at runtime but does not use a TypeScript project reference
  to Web because Web is a no-emit application project.

- This Mac's Qoder installation is Qoder CN. Use the actual `qoderclicn`
  bootstrap binary, not an IDE launcher, and isolate accounts with its native
  `--config-dir`. Desktop login did not authenticate the newly installed CLI.
- The Cursor installer also overwrites `~/.local/bin/agent`. Preserve an
  existing Grok `agent` alias by installing only the `cursor-agent` entry.
- WorkBuddy bundles a Node CLI at `app.asar.unpacked/cli/bin/codebuddy`.
  Its auth failure was a structured `result.is_error` with process exit zero;
  desktop installation/login does not prove bundled CLI readiness.
  The desktop package lacks `dist/codebuddy.js` and the native Web UI, so its
  interactive `/login` entry is unavailable. A complete same-version official
  CodeBuddy CLI can provide the native login UI, but WorkBuddy and CodeBuddy
  declare different authentication IDs even under `~/.codebuddy`. Verify both
  initial and resumed runs before assuming credentials work across entries; keep its installation separate and preserve the bundled headless
  entry rather than editing app files or copying account credentials.
  CLI 2.147.0's macOS auth storage is separate from settings: it uses
  `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth`, so
  `CODEBUDDY_CONFIG_DIR` does not isolate accounts. A native
  `AtRestEncryption category=missing-key` read warning followed by refresh
  HTTP 401 is a credential-read/refresh gate, not evidence that a Dispatcher
  resume parser failed. Do not recover by copying credentials or extracting
  desktop encryption keys.
- pi can reuse the active OpenCode OpenRouter credential without storing a
  second raw key: its native `models.json` accepts an `apiKey: "!command"`
  resolver. Use OpenCode's official `auth export openrouter`, select only the
  active key credential in a private helper, and pipe its output directly to
  pi. Never print the export or resolver output. Model defaults remain native
  pi settings; Dispatcher selects the explicit `provider/model` per profile.
- ZCode's bundled CLI needs both `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` and
  `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` to reuse its native runtime config.
  Setting only the bundled-provider fallback variable did not fix packaging
  lookup. Use a wrapper and existing native paths; do not modify app binaries
  or copy credentials. Explicit `--mode edit` avoids its headless `yolo`
  default. Model selection stays in the native client, not an unsupported CLI
  `--model` flag. Runtime provider paths can change after a desktop upgrade.
  Provider credentials do not imply a headless model selection: a missing
  personal `defaultModelSelection` caused `Model creation failed`, whose nested
  CLI log error was `CONFIGURATION_ERROR: Select a model before continuing`.
  Persist selection inside `provider_config.json.config`, not its root.
  Selection also requires a usable native account/model registry; the same
  error can remain after saving a valid catalog model. The standalone CLI's
  credential resolver requires its native coding-plan account identity entry
  as well as an account key. Desktop OAuth presence alone is insufficient;
  use native CLI authorization to establish those entries, not credential copy.
  The desktop-bundled 0.16.9 CLI also lacked `@zcode/tui`; do not recommend its
  interactive `/model` menu without verifying that package is present.
- Shared session persistence must validate profile ownership before status,
  input, usage or cancellation. Codex and structured native adapters enforce
  this in their session lookup; Controller session routes reject mismatches
  before calling any provider. A disabled account must not be continued through
  another enabled account with a different native credential directory.
- Antigravity CLI 1.2.14 can return `status: SUCCESS` with non-empty
  `denied_actions` after declining native file creation in `accept-edits` mode.
  Reject that envelope as a failed turn; model text or exit zero does not prove
  the requested tool action ran. Do not enable dispatch from a text-only probe.
  Its `approveTools` profile setting is an explicit opt-in for
  `--dangerously-skip-permissions` on both initial and resumed calls. Keep it
  false by default; native tool approval does not impose a worktree sandbox.
- `pnpm dispatcher` runs in `apps/controller`, so its default relative data
  directory differs from invoking the built CLI directly at repository root.
  Pass an explicit `--data-dir` when restarting an existing instance; otherwise
  it opens a separate empty configuration, rather than losing saved profiles.

- Console grouping must use a coherent full Fleet snapshot, never a first-page
  task/run sample. Keep `currentRunId` even if the Run is missing so a historical
  attempt cannot silently become current. Completing or failing a task does not
  archive it; archive is explicit local metadata with a reversible restore.
- Capture selected model at dispatch and reset model/token evidence on reroute.
  A configured model is not runtime confirmation. Codex `turn.completed.usage`
  reports the latest turn; cached input is a subset of input, not an extra token
  charge. Account quota, token count, and currency are separate measurements.
- Sectioned settings must merge into the complete draft, keep hidden sections,
  avoid injecting RJSF defaults into untouched data, and invalidate a ConfigPlan
  after any edit. Keep dirty drafts across query refreshes; apply the reviewed
  plan ID and preserve the server's revision/confirmation checks.

- A Web decision answer belongs to the displayed waiting episode. Do not fetch
  newer revisions and silently attach an old answer to them. Reset the input on
  episode changes and fence current task/run/lease before and after adapter send.

- Controlled reroute must stop/revoke the old owner before reserving and starting
  its replacement. Keep frozen contract, verification and SCM snapshots; mutable
  task/config state cannot reconstruct them. Rebind the managed workspace Run ID
  without renaming its physical path/branch, and atomically record the transfer
  with the new owner. Restart must skip transferred historical handles, or their
  restore order can silently assign owning Git delivery to the previous Run.

- Serve the HTML entry with no-cache; only hashed assets may be immutable.
  Missing asset paths must return 404 rather than the SPA HTML fallback.
  After rebuilding production assets, restart the static-file registration.

- The v3 HTML is a visual reference, not runtime capability evidence. Keep its
  sample tasks, model catalogs, authentication claims, prices, and quota values
  out of production. A local draft review is not a server publication preview
  or receipt. Missing publication/catalog APIs must leave submission unavailable.
- Before building a configuration plan from an edited form, re-read the applied
  revision and reject a changed base while preserving the draft. This client
  check alone is not atomic: console plans must also send baseRevision, which
  Controller compares immediately before building the plan. ConfigPlan's apply
  revision fence remains required, including for legacy callers without a base.
  Device/repository/policy editors share
  the complete-draft settings path and must not discard hidden fields.
- `/api/system-impact` currently returns a placeholder local-process count and
  non-windowed LLM counters. Do not display these as measured process counts or
  hourly usage. Diagnostics exports must exclude config, free text, paths and
  credentials rather than serializing raw API responses.

- Publication preview and commit hashes bind raw instructions, applied config,
  repository base commit and native selection. A successful receipt replay must
  bypass preview expiry while a changed payload on the same key conflicts.
  Reserve receipt/task/contract/intent atomically; native I/O stays outside SQLite
  transactions. Preserve taskId after startup failure or uncertainty.
- Automatic routing normalizes text only for keyword matching. Approval binds
  the untouched draft; original evidence spans must remain valid through NFKC
  expansion, emoji and collapsed whitespace. A winning invalid project rule
  blocks execution rather than allowing a lower/global/default model to win.
  Keep the decision immutable and store confirmation in the publication/Run
  snapshot. Refresh catalogs at commit/start, but never rerun classification as
  part of approval or receipt replay. Native-default reasoning means omission,
  even when the catalog advertises a default such as medium.
- Semantic analysis caching and native catalog freshness have different lifetimes:
  cache validated analysis by actor/draft/raw text/type/prompt/role configuration,
  while refreshing native execution evidence at every approval/start boundary.
  A role's successful-call preference is mutable and cannot identify the model
  used by another concurrent call; use the response's per-attempt provenance.
  A new analysis for unchanged input must supersede its prior publication review
  so two outstanding reviews cannot independently create two tasks.
- Reusing a publication review for an existing Task must bind both canonical
  revision and contract content, including the gap before adapter startup. Keep
  browser receipt identities separate per Task. Reconstruct task text on the
  server and use the contract's frozen commit when inspecting its workspace;
  the current source branch may have advanced since create-only publication.
- Native rule qualification belongs before ConfigPlan creation/apply, outside its
  synchronous SQLite transaction. Bind fresh evidence and revision, and keep
  successful plan replay independent of later native availability. Read ConfigPlan
  lifecycle state from the canonical stored row, not its original embedded plan
  document, which captured PLANNED at creation.
- Remote RPC identity binds raw payload plus lease ID/generation, independently
  of property order and renewable expiry. Never overwrite a successful command
  receipt with a changed-payload conflict. Responses carry the command hash in
  envelope idempotencyKey so an unacknowledged conflict replay cannot settle a
  later valid retry. After full journal compaction, the next outgoing sequence
  must remain above the acknowledged sequence.
- A source-checkout scope check is insufficient when executing another commit.
  Recheck physical scope roots in the created worktree before native queries or
  execution. Workspace-bound contracts cannot accept another repository through
  a dispatch override; current configured scope may only narrow execution.
- Freeze verification descriptions and repository identity per Run. Removing a
  repository registration must not replace or erase the commands and physical
  origin used by an already approved execution. Restore only worktrees whose
  managed path, Git common directory, branch and base ancestry still agree.
- Preserve create-only execution intent for fresh validation at later dispatch.
  A per-run model/effort override belongs to its adapter session and must survive
  continuation independently of current profile defaults. Revalidate native
  account/project context before continuing a managed session.
- A process reporting completion does not prove its result Promise is ready.
  Usage reads must not await that Promise. Use stream snapshots or an immediate
  settled-result cache; keep legacy explicit resource-probe refresh semantics,
  preserve observation time and keep read failure separate from resource state.
- Legacy usage collector event IDs do not prove cross-source native event identity.
  Retain private raw evidence, attempt and optional occurrence time; never add
  both collectors automatically or substitute collection time for billing time.
  Expanding a stored finite number to decimal text preserves its stored value,
  not lost upstream precision. Reject unsafe integers and unsupported scale.
- Catalog parent-process close alone cannot confirm owned-group absence. Reuse
  OwnedProcessGroup, require drained callbacks and prioritize a cleanup-unknown
  error over usable response data; never signal a group again after absence.
- A non-detached version probe must explicitly choose root ownership. Capture
  the freshly returned child's PID and bound kill before awaits; observed exit
  stays final even if mutable fields change. A resolved stop or successful KILL
  is not a natural-close receipt. Keep its500ms confirmation distinct from the
  existing group2000ms gate; inherited pipes can outlive the root. Never infer
  descendant cleanup or native writer release from either event.
- Workspace package exports may load compiled dist while focused tests import
  source directly. After changing an exported implementation, build before
  cross-package acceptance. Preserve a mixed source/dist failure and actual input
  hashes; a subsequent build changes runtime inputs, it does not explain an
  earlier OS failure on a fully built candidate.
- ACP requests and notifications share the SDK writer queue. Keep a stale unsent
  cancellation's permit until that notification's own write settles; deleting it
  early can consume the next prompt's permit. Request terminal settlement and
  notification submission are separate facts. Preserve original callback/option
  capture, final scope/authority/deadline checks and cached unknown cleanup.
- Isolated pnpm deploy layouts may place dependencies in sibling packages under
  .pnpm. Resolve from the actual owning package with Node module resolution when
  checking attribution; do not assume an Adapter-local node_modules directory.
  Inspect the same artifact after an inspection error rather than redeploy it.
- Releasing a catalog HTTP request is not evidence that its native reader closed.
  Track the underlying read separately through bounded shutdown, keep late writes
  fenced and retain UNKNOWN cleanup evidence across subsequent clean stops.
- Capture an adapter's legacy default before asynchronous preparation, including
  an explicit empty snapshot for known omission. Absence on a historical record
  is unknown, not permission to use today's configured model. Require review
  before continuing unknown/legacy-shaped selections; keep their raw data intact.
- A native default-model review has a source-specific catalog hash. Do not
  reinterpret an old default-plan proof as a current v3 catalog revision.
  Bind new proof to actor/config/native scope and recheck after awaited work;
  save it in the same transaction as its ConfigPlan. A read-only cached catalog
  cannot qualify a default change or explicit Run.
- Codex model/list is a native candidate catalog, not an entitlement or price
  source. Keep access unconfirmed and require acknowledgment for explicit
  selection. Known missing authentication blocks native defaults too. A
  completed native turn supplies recent availability evidence, without implying
  a remaining quota value. Exit zero alone is insufficient: require native
  thread identity and a completed JSON turn.
- A catalog's backend is part of its identity and revision, even when exec and
  App Server read identical native models. Capture account/context/backend before
  awaiting pages. A configured native host must fail closed when absent or
  mismatched; reject a known foreign backend before evaluating its factory.
- A persisted RUNNING adapter session with no attached process cannot establish
  liveness after Controller restart. Mark affected publication execution unknown
  and retain the worktree for inspection; do not automatically resume or reroute.

- Native `models` exit zero does not prove fresh or authenticated results. Grok
  returned expired OAuth diagnostics and its old model list with exit zero;
  inspect both streams and block native-default as well as explicit selection.
- Cursor status can render different progress/spinner lines for the same login.
  Fence the qualified `Logged in as` identity marker, together with native
  account/configuration hashes; do not compare whole terminal progress output.
  Unknown or contradictory login markers remain unqualified.
- Plain CLI model IDs may already encode effort, fast mode, tiers or routing.
  Preserve the native selector exactly; never derive supported parameter ranges
  from its suffix or from a CLI-wide effort flag. OpenCode variant overlays and
  inventory costs likewise do not establish per-model effort or account prices.
- OpenCode 2.0.26 `models --standalone` can exit zero with empty output while an
  owned private service exposes enabled text candidates through `/api/model`.
  Qualify the native response/account metadata schema, bind the physical project,
  query twice for a stable snapshot, and close the owned process before returning.
  Capture workspace/account/environment before executable resolution, execute the
  fingerprinted physical file and recheck all captured fences after cleanup. Native
  project IDs and optional directory/canonical strings identify native scope; freeze
  supplied fields without equating them to canonical repository IDs or worktree paths.
  A supplied native default must select an eligible entry; absence does not invent
  a default, effort, entitlement or price. Relative effective account metadata paths
  are unqualified: parent and native child have different cwd. Reject before account
  I/O until the native environment supplies an absolute location; do not rewrite it.
- A successful native turn with no quota number is recent availability evidence,
  not a numeric balance. Preserve explicit resource/auth failures over completion.
  Verification commands execute independently through Controller's registry;
  an agent refusing its own Bash tool does not invalidate a passed Controller check.
- Controller tests import compiled workspace adapter exports. After adapter edits,
  rebuild before running targeted Controller tests; a direct targeted rerun can
  otherwise exercise stale `dist` code. The full `pnpm check` builds first.

- React Query structural sharing can preserve data identity after an explicit
  refetch. Discard/reload must copy the returned applied data and revision into
  the draft directly; toggling a dirty ref does not rerun a data-keyed effect.
- Internal model role reset must fence pending invoke, switch and failback
  selection writes. A completed pre-reset call remains valid output, but cannot
  repin the old profile after the user restored pool order.
- Publication receipt recovery must retain the original reviewed draft identity.
  Do not label an old dispatch commit from the currently edited create-only draft;
  late preview reads must not interrupt newer editing. Legacy receipts without
  a bound review snapshot remain readable but require a fresh review to commit.
- Scroll wrappers containing absolutely positioned screen-reader text need a
  positioning context: clipped hidden table headings can otherwise expand the
  document on narrow viewports even while the table itself scrolls correctly.

- Remote reconnect must match the native start hash and current lease/session/
  workspace before adopting ownership. Do not update lastActivityAt just for
  reattachment: it participates in native-input retry identity. Bound inventory
  application to identities present before the query, and coalesce a later
  heartbeat so a slow empty snapshot cannot hide a newly started Run.
- Revoke Runner authorization before the first secret-store await. A failed
  metadata/delete operation must not leave the socket or an in-flight auth
  result authorized. Use an opaque identity epoch rather than timestamps: test
  clocks and fast re-enrollment can have identical enrolledAt values. Recheck
  the epoch after secret resolution and remote RPC awaits. Keep an in-memory
  revocation fence if persistence fails; a failed response is not durable proof.
  Re-enrollment repeats revocation/lease fencing before activating a new key.
  A shared reference cannot be deleted by a single identity's revoke; require a
  dedicated reference for enrollment/rotation instead. Generic secret APIs must
  retain applied Runner references without making them a bootstrap prerequisite.
- Remote cancellation cannot depend on a received native session ID: a dropped
  start acknowledgement leaves only the reserved lease. Persist revocation,
  require owning-Runner stop acknowledgement, and keep uncertainty visible.
  Shutdown revokes all leases synchronously before awaiting the first adapter.

- A SIGKILL request is not a stop acknowledgement. Shared owned-group cleanup
  waits for absence after escalation; native status/result stays running until
  cleanup completes, even on a nominally successful parent exit. Verification
  revocation awaits its serialized command cleanup before returning a stop ACK.
  An in-memory cancelled-session fence survives cancellation-record write failure.

- Never submit a redacted console config as a full replacement. Omitted private
  values are preserved by applying revision-bound leaf edits to the real server
  document. Bind array edits to entity IDs as well as their same-revision index;
  normalization sorts configured entity arrays after validation.

- Native profile enabled omission means true. RJSF's generic checkbox displays
  undefined as false; wrap its existing checkbox for that field's presentation,
  without adding a default to form data. Otherwise a harmless edit can appear to
  disable an account or manufacture an untouched configuration change.

- Preserve only reviewed configuration plan IDs in browser recovery state;
  re-read canonical plan lifecycle and the applied revision before restoring
  actions. An applied plan with later configuration changes is historical,
  not an available rollback target. Ordinary account edits preserve stable IDs;
  removal/creation stays explicit so historical ownership is not silently renamed.

- Account installation, native flag compatibility and login are independent
  evidence. Cursor's login-success/unable-to-fetch-details output is not a
  qualified identity. Qoder CN version/help/status probes must all use the
  applied configDir and both cwd/PWD of the registered repository. Persist only
  normalized evidence with its original check time; refreshes must not promote
  old or unknown authentication to success.

- A persisted active session without an owned child is not a stopped process.
  Native cancellation must refuse to report CANCELLED from stored PID/state
  alone. Revoke canonical authority, retain unknown outcome, and never kill a
  recorded PID. Fence STARTING writes after async preparation, then retain
  post-spawn cleanup for changes that happen after that final check.

- Resource reads must not await an unfinished native turn. Preserve a stable
  per-turn observation ID across status updates; a changed updatedAt timestamp
  is not a new usage event. Keep old snapshots for historical queries, but use
  only the latest snapshot plus later deltas when calculating the same scope.
- Generic credential redaction matches the tokens and tokenScope field names.
  Remote usage needs an allowlisted numeric token projection and validated
  scope enum; never relax generic secret redaction or return arbitrary vendor
  usage objects to preserve those metrics.

- A resource collection time is not automatically a new native observation.
  Preserve cached event/session timestamps through local and remote reads;
  explicit probe results may establish a new time. Retain the recovery path
  where a newer verified probe supersedes an earlier quota/error signal.
- Diagnostic GET/export paths only project facts. Registered checks declare
  provider-query cost and cannot accept executable strings or a client-supplied
  cost. Connector health binds applied configuration, expires after five minutes,
  and rejects results whose configuration changed while awaiting the provider.
  Legacy unbound health records require another check rather than a green state.
- Input uncertainty belongs to a waiting episode, not just a client nonce.
  A new nonce, actor or task-description revision must not authorize resending
  an unconfirmed native reply. Store its original authority/message hashes and
  replay confirmed receipts before checking the now-advanced task revision.

- An unchanged secret reference is not an unchanged credential. Fence a
  Controller-observed write before awaiting the store; a failed write may have
  an uncertain outcome and must invalidate previous checks. Persist opaque
  epochs, never hashes of secret values. Keep remote catalog scope owned by the
  Runner; a Controller-only fingerprint must not replace its selection identity.
- Preserve established error contracts while adding credential-specific
  conflicts. Shared ConfigPlan ACTIVE_AGENT_PROFILE remains its existing400;
  credential replacement conflicts use their own409 code.

- A terminal adapter snapshot does not clear a later uncertain stop. Preserve
  stop authority in the original session row across adapter saves and restart;
  block further input, profile replacement and admission until qualified native
  terminal evidence. For local tools, detached saved state is not that evidence.
  Existing local diagnostics attached=true can qualify the live handle without
  adding another process registry or trusting persisted PIDs.
- Persist SDK/HTTP STARTING before an external create request. Bind the original
  account context once, and never bind an old unqualified session merely because
  its record is being updated under today's configuration.

- Workspace package exports resolve its built output in cross-package tests.
  After changing that package, build before Controller/Runner targets; a source-
  local unit alone does not prove callers see the new method.
- Repository IDs, durable local Project IDs and remote delivery owner/name are
  separate identities. Ref browsing reads current local/Runner refs without
  fetching; only publication review freezes the selected base commit. Preserve
  historical Project rows when a repository registration is removed.

- A browser's selected directory belongs to the browser device. The native
  directory bridge must be loopback-only and owned by the embedded Controller
  desktop, never interpreted as a remote Runner directory. Use only a fixed OS
  dialog command; selected paths remain candidates until ConfigPlan registration.
- Cancelling a directory dialog must retain its ownership slot until the OS
  operation settles and discard a late path. Native window visibility and
  chooser-process launch/cancellation are separate acceptance evidence.

- Keep test repositories, Dispatcher data and native account homes as siblings.
  A fixture that treats the temporary parent as its data/account directory now
  correctly violates private-path protection. Preserve the original assertions
  and move those fixture locations rather than bypassing the production guard.
- Scope comparisons must resolve symlink aliases and existing ancestors of
  missing paths. Apply the same private-path rule to actual result files under
  a whole-repository scope; hide native private path details in resolution errors.

- Local commit must not reuse GitHub push's implicit add/commit path. Reuse
  owned ProcessManager groups, validate the frozen managed workspace and preserve
  native Git hooks. Keep unresolved mutation receipts unknown across restart;
  never infer that a missing response permits another commit.
- Hash explicit immutable workspace fields for delivery identity, not arbitrary
  object property order or incidental plan timestamps. The post-commit scoped
  file manifest, not a pre-hook snapshot, belongs with the saved commit SHA.

- Freeze remote delivery intent during workspace preparation. Preserve the old
  plan hash when intent is omitted, and never grant commit permission to an old
  none execution. Verification permission belongs to the completed native turn;
  clear it before another input and block input once delivery starts.
- Remote cancellation must await both native handles and the owning Git command
  group. A revoked lease or a transport timeout does not prove hooks terminated.

- Freeze both the repository identity and the actual origin configuration before
  explicit push. Use a literal commit SHA/refspec and disable automatic tags and
  submodule pushes; never rely on mutable HEAD or the current default push refspec.
- Real Git transfer can be tested without a network write by a fixture-only SSH
  command connected to an isolated bare receive-pack. This validates Git transfer
  and process ownership, not a real SSH server, account authorization or GitHub PR.

- Additive delivery commands need an explicit peer capability even while keeping
  transport1.2 and legacy omitted-intent hashes. Gate preparation as well as the
  final command; otherwise an older Runner fails after a task has been created.

- Keep a task's declarative SCM choice separate from observed credential/target
  review snapshots. Otherwise credential rotation permanently invalidates a saved
  task instead of requiring a fresh review. Bind observed snapshots into reviewHash.
- Repository metadata permission is not proof of native SSH/Git authentication or
  a token's PR write scope. Treat absent permission fields as unconfirmed and keep
  the actual execution checks explicit. none/commit must not call SCM preflight.

- A read failure before POST and a lost POST response have different retry rights.
  Persist provider create intent at the actual send boundary after secret awaits;
  otherwise either a harmless read failure poisons retries or a lost write can
  be repeated. Missing lookup evidence after a possible POST is still unknown.
- Scope create identity to Run/generation, with nonce/connector/target bound as
  content. A fresh nonce must not authorize a second external write. Recheck
  authority after provider response awaits and before saving qualified evidence.

- Save confirmed push facts in run-result before awaiting PR creation. A lost
  provider response must not hide a completed Git transfer or imply PR success.
- Start the HTTP cancellation slot only after the Git ownership promise has
  drained. Aborted HTTP can settle with an unknown provider effect; that must
  never normalize a failed OS process-group cleanup into a confirmed stop.
- Composite remote push validation must pass only Run/generation/branch to the
  commit validator; its separately frozen target belongs to the push receipt.

- A push receipt alone cannot establish PR or CI state. Use the selected Run's
  actual delivery evidence for the PR label/link, including while CI is pending.
- Result reads must include delivery/recovery phases, not just terminal Runs.
- Legacy external PR contracts can keep their configured default SCM without
  rewriting TaskContract. Freeze its qualified target before a new Run starts
  and reuse owning Git delivery. Never adopt an unbound historical Run into a
  newer mutation protocol: absent receipts cannot prove an old write did not
  happen. Keep explicit custom GitTransport boundaries separate from default
  process ownership evidence.
  Bind query caches to the chosen Run/phase so previous attempts cannot supply
  a different attempt's result; preserve known facts during background refresh.
- Keep create-only availability separate from scope safety. Offline evidence can
  remain warning/unknown while canonical creation succeeds; known physical scope
  denials still fail. Do not invent a baseline when Git is unavailable. At later
  dispatch, pass the newly reviewed SHA into workspace creation even if the
  original TaskContract intentionally has no baseCommit.
- An AdapterSession.runId can identify a standalone native operation rather than
  a canonical Run. Validate that incoming usage belongs to it, but omit canonical
  runId/generation from stored standalone observations. A terminal session needs
  a separate successful-collection cursor: native completion is not proof its
  metrics were saved. Empty cached results cannot resolve an earlier usage error.
- Do not serialize raw validator errors into draft field diagnostics. Whitelist
  canonical input paths and static codes; never echo validator data/unknown keys.
  Focus the existing affected control and open its collapsed details section so
  a field error is actionable without changing or discarding the user's draft.

- NEEDS_SPEC publication tasks may have no TaskContract at all. Restore editable
  inputs from their owned publication draft, not current configuration defaults.
  Bind the completion review to the pre-save task revision/contract hash; update
  specification and receipt atomically and check the post-save revision at dispatch.
  Keep composer drafts per Task and revision. Newer canonical data must not silently
  replace unsaved browser edits; explicit reload/discard restores the saved version.

- Concurrent Git worktree add/remove can scan another partially written
  .git/worktrees entry even for distinct branches. Order owned administration by
  the physical Git common directory across aliases/managers, and recheck write
  authority after waiting. Keep native execution in separate worktrees concurrent;
  this in-process ordering does not lock external Git applications.

- Pi RPC agent_end can precede follow-up work; only the pinned protocol's settled
  fact ends the turn wait. A timed-out/uncertain prompt cannot be retried under a
  new nonce. Closing its owned RPC root does not prove background tools stopped
  or native writer ownership was released. Version-probe group ownership is a
  separate, freshly created process boundary.

- Seed benchmark fixtures through the selected runtime's persistence package,
  before spawning that Controller and only into a new owned directory. Using the
  current checkout's migration catalog can silently prepare data an older pinned
  artifact cannot read. Capture workload helper hashes before execution; native
  API query timing does not prove browser or provider acceptance.

- Filtering history pages is insufficient if each background worker still
  materializes every Run. Filter worker eligibility in SQLite before decoding
  JSON, preserving terminal usage collection and completed PR reconciliation.
  Test irrelevant-history decode counts; measure RSS separately with the same
  real HTTP workload and worker settings. A no-worker diagnostic is not the
  default Controller performance result.
- Pi local shutdown must attempt all owned runtimes even when a disconnect or
  receipt write fails. Preserve errors after closing HTTP and retain the DB for
  reconciliation. A drained local root is not proof of native background-tool
  quiescence, and `agent_settled` cannot supply missing approval/tool facts.
- Account quota refresh must preserve native decimal credit balances as strings.
  Keep collection time, last success and account fingerprint separate: a failed
  read must not make the old value fresh or expose another account's balance.
  Expire observed windows at their native reset without assuming a renewed limit.
  HTTP timeout/cancellation is not native reader termination; retain the pending
  handle and configuration barrier until owned cleanup actually settles.
- A catalog revision alone does not prove stable account/model prices. Compare
  reviewed price terms again before startup, while treating an unchanged quote's
  later collection timestamp as freshness evidence rather than a new price.
  Freeze the original reviewed snapshot; historical cost reads use it without a
  current catalog lookup. Writer6 preserves that JSON but cannot enforce the new
  startup rule, so schema11 requires writer7 and preserves migrations1–10.

- A complete saved usage snapshot cannot prove current collection completeness.
  Project pending/unknown reader state and unresolved collection errors into cost
  availability. Preserve an event/identity conflict through generic partial reads
  and later read exceptions until admitted recovery; a transport error does not
  reconcile conflicting native facts. Keep accepted observations immutable.

- Preserve owning-cache quota state across remote transport: source freshness,
  last success and account context are evidence, not a new Controller read time.
  A successful response hiding a changed owner's balance must replace the old
  projection; only a wire failure can retain that matching historical snapshot
  as error. A timed-out wire request does not release the physical reader's
  registration or database guard. Quiesce RPC admission even when storage close
  fails; holding the database open alone does not stop new commands.

- CodexStartInput.commandId carries the Adapter invocation id, not the Core
  native-start journal id. Derive the owning Run from the managed workspace and
  compare its reserved Adapter session, immutable selection/reference and lease;
  never use that invocation id to find or manufacture another Run.
- A closed native runtime must remain registered until normalized local cleanup
  and its invalidating read barrier commit together. On persistence failure,
  retry the cached receipt without another physical disconnect. Local drain does
  not end an active canonical Run or qualify native writer release.
- Consistent stored Codex binding metadata can support read-only restart
  reconciliation while old observations and source ownership become unknown.
  Partial/conflicting bindings retain the preflight barrier; neither case permits
  cold continuation or replay of a possibly delivered native start.

- A queued native history read must recheck source and authorization inside its
  scheduled I/O callback. Initial authorization plus an after-await check can
  still call the provider after permission has been revoked in between.
- Date.parse accepts some parenthesized text containing credential assignments.
  Finite date parsing alone does not sanitize history metadata. Apply the same
  safe-metadata check as identities/cursors and reject an unsafe page rather than
  inventing a cleaned timestamp; keep transcript out of Core persistence.

- A child fixture's JSON pathname can become visible before writeFileSync finishes
  writing it. If existence signals a completed receipt, write a sibling temporary
  file and rename after close. Keep exact content/callback assertions and the
  existing deadline instead of sleeps, longer timeouts or suppressed parse errors.

- OpenCode server attachment must use the managed execution context captured when
  registering the binding, including its original repository/base. An incoming attach
  request is not authority for that context. Re-registration may repeat the same
  context, but cannot fill in or replace an earlier missing/different context.
- For OpenCode server creation, durable binding/waiting is not a prompt receipt.
  Await waiting before input and received only after accepted native input; failed
  persistence fences the port. Local callback draining must retain admitted async
  sinks and does not establish native tool completion or writer release.

- Capture the owned OpenCode probe/service environment before startup awaits. Preserve
  native PATH/account context while filtering Controller authority; fresh service
  password/handoff variables must not be inherited. A service child absent after an
  exit-unconfirmed probe does not prove that probe or its callbacks stopped.
- OpenCode root exit closes admission independently of inherited pipes. Destroying a
  local stream cannot establish callback drain; retain admitted callbacks/acquisition
  through public lifetime races and preserve a cached unknown cleanup receipt after
  late settlement. Allocated identity and initial facts must persist before readiness,
  and bounded terminal sink failure must prevent completed results.

- Keep the OpenCode runtime's configured executable alias as Controller authority,
  while handing the captured physical path to both producer scope and input. The
  producer requires those two values to agree. Recheck the original alias/metadata
  through the same runtime guard before each owned probe/service spawn; passing a
  realpath alone does not close replacement during an awaited probe.
- The OpenCode producer adopts its binding only after the runtime's onBinding
  bridge resolves. That bridge must validate captured and durably persisted scope
  without requiring producer.source prematurely; public source lookup checks the
  producer afterward and withdraws authority on rejected persistence.
- A forbidden thenable returned by a synchronous guard may already own async work.
  Normalize it once into a tracked Promise and pass that same Promise to the shared
  admission helper before rejecting synchronously. Resolving the original thenable
  twice can execute its then method twice; public rejection/shutdown is not proof
  that its entered work settled.

- A runtime's source lookup can synchronously enter its producer/port readHandle.
  Capture a defined Controller runtime/Adapter owner and its lookup key before that
  call, then recheck registry, current Adapter and saved association afterward.
  The runtime's own binding/physical-entry checks cannot prove that the outer
  Controller still owns the same handle after a callback reenters configuration.

- A public Adapter start can reject while native executable admission or a forbidden
  async guard still owns work. Profile replacement and SQLite close must consult
  the exact runtime's raw status as well as canonical Runs and durable host
  receipts. Consume the real provider interface and actual entered work; never add
  a noop double or infer drain from method absence. Pi now has real runtime/producer
  status rather than an invented inactive implementation.
- Preserve multiple shutdown failures in the existing terminal error collection.
  A local-review failure or successful empty host receipt cannot mask a different
  native failure or unsettled raw callback; close HTTP/events and retain storage.
- Keep live test-source byte snapshots outside the checkout. Git-ignored TypeScript
  under `.superpowers` is still input to the current `eslint .` configuration.
  Preserve historical failing bytes/logs with relative-path SHA inventories when
  relocating evidence; do not weaken lint rules to exclude a mistaken layout.

- Read-only restart qualification checks persisted agreement, not a live executable
  or native account. Keep provider-specific physical checks at the existing enabled
  runtime construction/admission boundary; do not infer identical filesystem checks
  across providers from a shared stored-data certificate.
  Explicit provider wrappers may share checked records, but must preserve their
  own product/backend/region/session/thread/parent restrictions. Wholly consistent
  opaque session/store rewrites cannot prove external provenance.
- Corruption tests must consistently rewrite all native-binding copies and alias
  fields when testing a provider-specific grammar; mismatched copies otherwise
  mask that rule. OpenCode's actual `^ses[A-Za-z0-9_-]+$` grammar accepts
  `session_other`; use a spelling outside that grammar for rejection. Isolated
  damaged-DB fixture construction can bypass its foreign keys, without changing
  production enforcement or confusing a fixture constraint failure with behavior.
- Existing unknown/manual recovery maps QUEUED Tasks to WAITING_RESOURCE and RUNNING
  Tasks to WAITING_USER. A provider-specific readable certificate must preserve
  those shared transitions and cannot silently turn storage readability into
  continuation, live-source or writer authority.

- Preserve existing ConfigPlan barrier order when adding raw activity. A closed
  runtime with missing durable or unknown host cleanup fails the earlier drain
  guard, even while raw work is pending. An open runtime, or a closed runtime with
  durably drained hosts, reaches the active-work guard. Assert raw status and
  immutable cleanup independently; one rejection code does not describe all phases.


- A synchronous transport update contract can feed asynchronous durable observation
  through an owned serial producer queue. Bound both each acknowledgement and the
  aggregate terminal checkpoint; individually short callbacks can otherwise leave
  the overall result unbounded. Retain underlying work after the public wait ends.
- Enforce a callback capacity limit before invoking the owning callback. Checking
  only while storing its returned Promise can start one untracked operation at
  the limit. Cached unknown cleanup does not become confirmed after late settlement.


- Validate every subprocess phase before admitting a bounded catalog. Discarded
  version diagnostics cannot satisfy byte/encoding requirements of the whole query;
  the shared helper has a strict output option for callers with that contract.
  Complete owned drain before output validation and keep cleanup uncertainty first.
- Opaque Unicode selectors need a deterministic total order for content hashes.
  Locale collation can equate distinct composed/decomposed strings; binary string
  ordering preserves exact identities and revision stability without normalization.


- Missing native binding is not creation-absence proof. A public cancellation can
  beat a pending create response after the mutation was written; retain unknown
  once producer work entered unless the actual outcome was proven. Keep ordinary
  producer proof separate from conservative forced-waiter cancellation.
- Capture getter-backed/shared result objects before awaiting authority or identity
  validation. Validate and return that same plain snapshot; cloning afterward can
  publish different data from the identity that passed the checks.
- Preserve original endpoint receipt facts when a higher layer still owns work.
  Append its separately scoped uncertainty rather than rewriting the endpoint's
  observed callback state, and cache the combined result without later promotion.
- External command inputs need unique full-path retention keys. Basename-only copies
  can overwrite each other; matching retained snapshots to declared hashes proves
  byte equivalence and must not be called an original per-command unique capture.

- A native factory callback can mutate its arguments. Capture minimal owning profile
  and physical catalog scope first, pass a detached callback value, and construct
  from the captured values. Disabled reservations skip runtime construction while
  their explicit native homes still require repository-path protection.

- Raw native catalog reads outlive public cancellation. Keep their owning profile
  fenced until settlement, and retain cleanup uncertainty afterward; an error
  recorded in SQLite must also prevent shutdown from closing that SQLite handle.
- Tests that deliberately retain a failed-stop database must assert the actual
  service/error before enrolling its cleanup exception. Exact identity prevents a
  later failure or another service from borrowing it; even enrolled cleanup must
  wait for original raw callbacks before closing storage.

- Local ACP opaque Session ID limits count UTF-16 units, matching the producer's
  JavaScript string length. A256-symbol astral ID is512units; decomposed Unicode
  remains distinct and valid. Cold validation must preserve this grammar rather
  than import another provider's UUID/ses rule or normalize stored identity.


- Apply exact-owner native permission facts before allowing an awaited model-read
  response to authorize input. Keep unresolved pre-input facts separately from the
  active written turn's denial/ACK state; a later idle or hook event in the same
  buffer cannot erase an already observed unresolved condition. Check the retained
  fact again at the final stdin sink, while preserving resolved-hook and sibling/
  subagent qualification rules.


- Reserve creation admission before reading getter-backed start input or invoking
  its validation Guard. Setting only the final admitted flag after validation lets
  a synchronous reentrant start enter twice. Keep that temporary reservation
  separate from the one-creation latch and raw callback slots.
- An observation failure may close the local connection itself. Preserve that
  cause so the final result remains failed instead of reporting user cancellation;
  a closed transport does not identify who requested cancellation.

- Two independently mutating callbacks cannot validate each other's final state
  through finite alternating checks. Put canonical permission and the expected
  persisted tuple in one synchronous owning assertion, then perform only pure
  local physical/registry fences. The owner must actually read both current
  facts; a signature or a no-op double does not establish that contract.
- Pure local failures after producer entry still need the entry-aware unknown
  outcome mapper. A before-result path check must not report not-created merely
  because it runs outside the awaited result/callback error wrapper.
- Start observer-lifetime test waits after actual native open succeeds or rejects.
  A short entry poll otherwise measures earlier valid version/initialize work.
  When testing late acquisition, observe the real inner open before holding its
  delivery; awaiting held delivery or readiness defeats the lifetime assertion.

- Native-directory privacy belongs to the existing config projection/edit boundary.
  Exact known dataHome/configHome/agentDirectory/sessionDirectory/copilotHome keys
  need the same omission/protected-parent handling as executable/codexHome; export
  dropping settings alone does not protect console or plan before/after values.
  Keep precise leaf edits and private siblings, and reject parent replacement
  atomically without adding a wildcard for future unrelated settings.

- A SessionControl document and its owning SQL row must agree at final native
  admission. Reading only the document can miss row-state revocation. Run external
  clock/lease/admission callbacks before the final direct snapshot; compare the
  frozen selection's config revision and original Adapter workspace there too.
- Generated managed-worktree fixtures depend on Git object/admin files as well as
  README/index/refs. Capture the complete controlled tree after workspace creation
  before relevant native admission, then after actual drain before teardown. Pin
  retained buffer hash/length separately from original live-file stat size; these
  copies are not an atomic database backup. Inspect actual wire/event identity
  before interpreting a failed array-count assertion as a native send.

- A pure restart certificate and whole Controller recovery have different effects.
  Qualification reads stored agreement without writes; existing startup may project
  SENDING commands to UNKNOWN because delivery is unproven. Preserve complete
  command identity/semantics/fence while checking only the sanctioned state/code/
  revision/time delta; do not fabricate ACK to prepare a readonly fixture.
- Freeze capture scripts and declared-input lists before starting each check.
  Tooling metadata added during an intermediate run does not describe the already
  loaded wrapper. Retain both versions and label that run accurately; final checks
  must use the completed immutable tooling. Default client UUIDs also do not narrow
  a supported wider opaque storage-ID contract or prove external provenance.

- A native allocation function can throw synchronously before a root owner exists.
  An async error handler alone cannot normalize that diagnostic. Catch at the
  owning API boundary, preserve existing typed scope/abort/cleanup uncertainty,
  and avoid retry or an invented cleanup receipt. Observe actual child lifecycle
  separately from API return. A test's signal0 helper must classify only ESRCH as
  absent; EPERM and other errors remain unknown even when older helpers returned
  a boolean. Later direct events never reconstruct missing earlier telemetry.

- Bound credential preparation by the request signal without losing delivery-stage
  information. Cancellation checks on both sides of the credential await belong
  to the pre-fetch preparation scope. Only creation there proves not-created;
  leave the final admission callback outside network normalization, and never
  infer non-delivery after invoking fetch. Test both stages with explicit counters.
- TextDecoder's default BOM handling removes a leading U+FEFF. When retaining a
  literal UTF-8 prefix of native text, preserve the BOM explicitly and avoid an
  incomplete final code point; continue budgeting escaped whole-page JSON bytes.


- A control dialog opening needs its own query identity. Refetch-on-mount alone can
  share a still-pending prior opening; close/reopen must not present its old HUMAN
  snapshot. Keep full Run/session/generation/lease/fence validation, and unmount
  control/history synchronously when the canonical header or identity is revoked.
  Saved timestamp/model updates alone must not create a new history scope.
- Native freshness presentation and history qualification are separate. A display
  copy may mark old/future observations unknown without changing the saved scope
  or making CONFLICT alone unreadable. Readonly control projection never provides
  handoff authority; live UI must omit mutation callbacks, not trust a display flag.
- React can propagate a dialog cancel synthetically to an enclosing dialog even
  when the native cancel event does not bubble. The owning Drawer must prevent
  default, stop propagation and invoke its own close callback; native focus cleanup
  stays there. Verify real Escape/top-layer/focus in a browser, since jsdom cancel
  dispatch and explicit HTMLElement.focus do not implement native modal behavior.


- Required acceptance evidence belongs in a durable task-owned directory outside
  the OS temporary root. Disposable fixture workdirs may use /tmp, but copy actual
  inputs, programs, outputs, state and identities before cleanup. An immutable Git
  source extraction or a new successful run cannot recreate missing historical
  command/fixture evidence; preserve that limitation and date new proof accurately.

- An effective Git remote URL does not freeze the endpoint of a later literal-URL
  push: insteadOf/pushInsteadOf can redirect it again. Reject rewrite key names at
  the existing reviewed/precommit/postcommit target boundary, using the same
  inherited Git configuration environment as the actual delivery. Snapshot-only
  GIT_* isolation would hide transport authority. Share only the pure name matcher;
  preserve the consumers' error/no-origin policies and one shared timeout budget.
  These asynchronous checks do not atomically freeze external host config changes
  between final resolution and spawn. An endpoint regression needs distinct owned
  A/B bare repositories and a routing SSH fixture; a one-endpoint stub cannot prove
  absence of a write to a second endpoint. Preserve completed commits on postcommit
  refusal rather than pretending the earlier physical effect disappeared.

- Conversation control epochs are optional for legacy bindings. An omitted epoch
  must preserve an existing known value; adopting or advancing an epoch changes
  revision once, replaying the same epoch does not. Reject noninteger/unsafe/
  negative/regressing input before the store write, and retain the exact session
  when an epoch advance invalidates an older WAITING_USER revision.
- Composite TypeScript projects write tsconfig.tsbuildinfo beside tsconfig.json,
  outside dist and node_modules caches. Include those actual incremental inputs in
  pre/post raw capture. A later qualified typecheck can prove current state but
  cannot recover compiler preimages omitted from earlier checks.

- Isolate registered verification at its existing Registry boundary: set the
  actual child cwd/PWD and remove inherited case-insensitive GIT_ selectors from
  a fresh environment. Keep native Git delivery's actual configuration context;
  applying verification isolation there would hide transport authority. A retained
  snapshot alone does not prove checks executed inside it. Private execution
  provenance must qualify a completed proof; old unknown sends remain barriers
  and old accepted facts remain historical facts without silently upgrading them.
