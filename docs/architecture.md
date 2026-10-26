# Agent Dispatcher Architecture

This file is the concise implementation map for the frozen design in
`agent-dispatcher-architecture-roadmap-v2026-09-15.md`. If the two disagree,
the frozen design is authoritative.

## Adopted RHIZA integration boundary (2026-10-26, scheme B)

The [adopted cross-product architecture](https://linear.app/inhandy/document/013da3a666f5)
and [roadmap](https://linear.app/inhandy/document/b15aa19a4b54) specialize the
external-Agent ownership boundary. They are target constraints, not a claim that
the current convergence candidate implements or qualifies the integration.
RHIZA owns Workflow, business attempts/origin/approval, Context, Evaluate and
accepted artifacts, plus its existing ordinary Chat/Provider calls. Dispatcher
alone owns external-Agent canonical Task/Contract/Run, Native Session/Harness and
Adapters, Runner/process/worktree, credentials, physical retries, native control,
verification and delivery facts. RHIZA consumes one versioned Dispatcher ingress;
it must not create another native Executor, scheduler or shell/CLI Provider fallback.

Each product retains independent source, storage, migrations and credentials.
Dispatcher owns the wire schema/artifact generation source; the RHIZA consumer pins
its version and digest rather than importing Dispatcher TypeScript or its database.
RHIZA's frozen exact Harness/model/options selection must not be routed through
local Policy again. Existing local manual/policy and none/commit/PR paths retain
their contracts. The fixed compatibility source currently exposes protocol 1.1 /
artifact 1.1.0 for code+PR only; this is not a declaration that this candidate has
adopted it. Unsupported external research/document tasks require explicit refusal
or a separately reviewed versioned extension, never an implicit native fallback.

One original semantic request key identifies one immutable receipt. A lost response
is reconciled by that key; business rework is an explicit new attempt, while physical
retry belongs to Dispatcher. Accepted is not started, cancel ACK is not physical stop,
and terminal/idle/empty queues do not establish native quiescence. RHIZA independently
accepts candidate artifacts after its own evaluation; a Dispatcher delivery fact does
not advance a Workflow by itself.

Basic single-work-order M24 acceptance (INH-1994) precedes M25/M26. Complete X1 /
DP-009b remains after M26, and DP-010 release requirements remain intact. RHIZA M26
is not a new global prerequisite for Dispatcher local release. Fixed source cuts,
field ownership, test preservation and distinct migration/writer catalogs are recorded
in `docs/evidence/convergence/contract-decisions.md`; moving WIP is never an
integration baseline. Original Done records and real-provider/GUI/stop/recovery Gates
retain their original scope.

Task, provider, catalog, probe, verification and Git subprocesses use the shared
child execution environment boundary. It removes Controller owner-token and
SecretStore encryption-key variables after provider overrides (case-insensitive
key match), while retaining native provider credentials, PATH, account directories
and PWD required by their existing contracts. This prevents child execution from
inheriting Controller authority; it is not a general environment sandbox.

## Delivered boundary (M0–M14 implementation)

The current system is a single Node.js Controller with an optional in-process
Embedded Runner. In addition to the M0–M4 foundation, it owns canonical tasks,
connector bindings, inbox/outbox projection, deterministic routing, TaskContract
compilation, isolated Codex profiles, Linear task ingress/projection, and GitHub
delivery evidence. The M6 vertical path is Linear issue → canonical task →
managed Git worktree → Codex run → verified commit/PR/CI evidence → Linear
projection. M7–M10 add a rebuildable Fleet read model and cursor SSE, Typed
Intent v2 with allowlisted semantic workflows, Qoder as a second provider, and
the Slack remote-control path. M11–M13 add resource continuity, authenticated
Remote Runners with durable replay and lease fencing, plus platform adapters
for launchd, Windows Service, systemd, Unix PTY, and ConPTY. M14 adds the
Cursor, Devin, Kiro, WorkBuddy/CodeBuddy, and hardened Generic CLI adapter
boundaries plus a capability matrix used by scheduling and operator reroute.
The local harness expansion adds OpenCode v2, Grok Build and pi through that
same adapter contract and native JSON CLI streams.
The committed Pi RPC transport, readonly identity/history and guarded execution
producer now exist as internal modules. New producer invocations bind one frozen
ExecutionSelection to the managed execution reference, persist native binding
before prompt and recheck synchronous authority after version acquisition before
creating RPC. Readiness/callback settlement and local-root cleanup remain distinct
from native tool/writer release. The default Pi print profile is unchanged; these
modules grant no registered Controller source, surface or takeover capability.

The bounded OpenCode v2 server transport and interaction port are internal modules.
Each connection pins one allowlisted protocol version (2.0.22 or 2.0.26), physical
workspace/server identity and authorized project. A binding can retain an independently
captured managed execution context; canonical attachment validates against that saved
context and remains read-only/unqualified. Creation persists binding and awaits the
optional waiting event before prompting, then awaits received only after an accepted
native receipt. Persistence failure fences writes; local callback drain retains pending
sinks without proving native writer release. The internal owned host captures one sanitized native environment, probes through the
shared owned version reader, and owns only its newly detached stdio server group.
Root/group absence and inherited stream/callback drain remain separate cleanup facts.
The canonical producer accepts one frozen explicit ExecutionSelection and managed
reference, persists allocated OpenCode session identity before prompt, awaits initial
fact durability before readiness, and bounds terminal persistence before completion.
Shutdown releases public waiters while retaining raw acquisition, poll and callback
work, with cached unknown cleanup preserved. Only an explicitly injected server backend
selects this start/read/result manifest; generic native stop, continuation and resume
remain unqualified. The standalone CLI manifest and optional read injection remain.
The internal Controller OpenCodeExecutionRuntime composes one producer per exact
managed execution. It captures the configured executable alias and physical regular
file identity, full canonical selection/reference and original callback receivers
before admission awaits. Controller assertions retain the alias; private producer
scope and input use the same physical path. The default owned host invokes the same
synchronous runtime guard before version-probe acquisition and service spawn;
existing direct one-argument host consumers retain their contract. A custom injected
producer factory is a trusted boundary, not proof of this default spawn composition.
Exact persisted binding and current physical/entry authority select each source;
no aggregate source or cold reattachment is provided. Public shutdown/cancellation
does not erase raw admission or callback settlement, and cached unknown cleanup
cannot become confirmed through a late result. Explicit ConfigPlan/native-profile
registration admits only compatible opencode-server-v2 on an embedded managed
worktree profile. Schema validation checks executable shape and the narrow
executable/model/approveTools:false settings without physical/native I/O; omitted
model and approval stay omitted. The adapter factory requires the matching owning
backend and explicit opt-in, rejects foreign or implicit server injection, and
returns disabled profiles before factory work. Standalone and other providers
retain their settings. Controller composes that runtime only for the applied local
registration, through a shared required-field Codex/OpenCode start predicate. It
derives Run authority from the registered workspace; the Adapter invocation is
distinct from Run and start-journal identity. OpenCode uses the existing observer
bridge without Codex native-request capabilities. Exact source lookup captures a
defined runtime/Adapter owner and rechecks the registry, current Adapter and saved
association after source callbacks return. A missing server registry cannot borrow
an aggregate port. Pi's separate start predicate remains unchanged. Exact Pi,
Codex and OpenCode raw runtime activity participates in profile replacement and the
final SQLite-close barrier, independently of public Adapter state and local host
receipts. Read-only restart uses explicit Codex/OpenCode/Pi storage qualifiers; actual
native qualification remains separate.

Controller retains unchanged profile adapters of every provider across ConfigPlan applies,
bound to the profile and owning Runner execution identity. Replacement/removal
rejects pending starts/inputs, active native operations, nonterminal canonical
Runs and unresolved legacy sessions; device labels/capacity do not rebuild handles.
Scale/HA remains
outside this boundary.

The production CLI acquires a separate SQLite exclusive transaction before
constructing Controller or opening the business database for offline config
commands. Its canonical data-directory lock remains held through verified
shutdown; process exit releases kernel ownership, without PID expiry or deleting
lock files. This protects CLI processes, not independently embedded library
instances or an older binary that does not implement the protocol. This shared
directory ownership primitive now lives in persistence; restore preparation also
must win it on its new target before writing staging files or restore barriers.

The per-user launchd definition binds absolute Node/CLI/data/log paths and a
working directory. Abnormal exits are throttled; explicit stop disables the
label persistently, boots it out and checks Controller exit/data ownership.
Start uses kickstart without killing an existing process; restart waits for stop.
Installed plist paths own CLI status/log selection. Definition changes require a
separate reviewed upgrade; failed bootstrap never triggers blind bootout.
Installed definitions are bounded, user-owned regular single-link snapshots;
native plutil decodes captured bytes through stdin. Start captures/checks their
SHA before and after async supervisor reads and enable, immediately before
activation. Observed drift blocks launch rather than using stale parsed paths.
New definitions also bind --log-dir to a private runtime subdirectory. Controller
structured logs reuse Runner's bounded writer through the existing redacting
logger; service failures record metadata, oversized entries retain an explicit
marker and following records remain readable. Log-tail reads have byte/line
limits, reject unsafe files and withhold unknown raw records. New launchd definitions send raw pre-import/native stdout/stderr to /dev/null,
retaining only the bounded redacted structured stream. Legacy raw file definitions
remain readable for diagnosis/stop; early failures use status/doctor/release checks.

Doctor runs separately from the Controller and copies bounded main/WAL files to
a private temporary directory under source identity/size/timestamp checks. Only
that copy enters SQLite inspection/recovery inventory; no source initialization,
migration, journal recovery, lease restoration or provider work occurs. A busy,
changed, future-schema or restore/archive source stays unresolved. Reports use
aggregate metadata and never establish execution readiness.
The offline database backup CLI shares that stable-copy reader while holding
directory ownership. It reuses the existing archive/checksum/restore functions:
preview creates no target, execution prepares only a new directory behind both
restore barriers. Credentials and native provider storage stay outside this
database-only artifact; no reconciliation or runtime activation is implied.
Offline service-upgrade preparation requires unloaded supervision, exclusive data
ownership, normalized pinned definitions, equal schema/writer contracts and no
active/uncertain work or native bindings. Its reviewed plan binds definition,
release and database fingerprints. Preparation retains a database-only archive,
validates restore into a new barrier-protected copy, and records previous/candidate
definitions in that archive. Installed definition switching and restored-data
activation remain separate operations; this phase grants no writer.
Offline definition switching serializes CLI service mutations, holds data ownership
and uses the existing operational file barrier before displacing any installed
definition. It journals exact source/target bytes and retains the displaced file.
Unconfirmed local writes keep the barrier; explicit reconciliation accepts only
known definition hashes, unchanged quiescent data, sealed backup/release facts and
unloaded supervision. It may finish a known install or restore its captured old
definition, and removes only its own nonce-bound deployment marker. Unrelated
restore barriers, changed data and foreign definitions remain blocked. No schema,
trigger, native effect, data restore or automatic service activation is performed.
The explicit reverse operation reuses that journal/barrier protocol only after a
confirmed switch with unchanged prepared database bytes. It retains prior
transaction locations and records direction so missing-definition recovery restores
the correct pre-operation bytes. Historical forward records remain readable.
Once data changes, definition-only rollback is unqualified and remains blocked.

Controller locates its default static root through the owning Web package's
exported index.html, so deployed packages retain the same UI. Release preflight
records a complete relative file/link inventory, hashes/modes, Source SHA,
Node/platform/schema/writer metadata and an explicitly isolated smoke scope.
Escaping/absolute links, shared hardlinks, persisted state and changed content
cannot qualify; hardlinks may be detached only within a newly owned inactive
staging tree. The stage:controller build tool requires committed clean source,
copies only tracked package source and compiled output into a private workspace,
and deploys offline there. It verifies that the source dependency-state cache
did not change, detaches artifact hardlinks, moves the complete runtime for an
isolated HTTP/asset/API/PTY smoke, then records and re-verifies its manifest.
Existing or failed targets cannot be silently overwritten or activated.
Manifest v2 records measured service admission v1. Installation binds its exact
source/release/Node/CLI, and start/restart recheck the inventory before mutation.
Serve validates the environment binding before data-directory ownership or
database construction. Legacy v1 manifests remain inspection-only; failed
integrity must not block stop/status/log diagnostics.

The personal MVP adds one Controller-owned `dispatchTask` path shared by HTTP
and the confirmed operator-only `task.dispatch` semantic tool. Slack task and
profile aliases resolve before approval. A durable workflow origin and dispatch
result bind subsequent attention and user-input messages to the original
thread. `currentRunId` identifies the canonical task's current execution.
The scheduler calls back before starting the adapter so Controller can reserve
STARTING Run, QUEUED task, currentRunId and dispatch receipt in one transaction.
The completion transaction rechecks current authority and task revision.
Non-terminal Runs occupy runner capacity, including waiting and verification.
The compatibility standalone-session start route is limited to the owning
Embedded Runner and an independent managed worktree. It reserves capacity before
provider awaits, shares occupancy with canonical scheduling, and rejects all
canonical worktrees. Applied capacity/display changes update the Controller-owned
Embedded Runner report; remote capacity remains its owning Runner report. Its explicit cancellation route cannot cancel canonical
sessions; those require Run lease revocation and verification cleanup.
Slack input rechecks lease/session/binding authority after the adapter await;
the consumed intervention and acknowledgement receipt commit with Run/task
resume, so a reply retry cannot answer a subsequent question.

Legacy same-Runner reroute shares canonical dispatch serialization and scheduler
admission. It only replaces a running/waiting Run with frozen contract,
verification and owning workspace evidence; publication/model changes still need
a fresh review, and verification/delivery or uncertain phases cannot reroute.
The common stop path revokes the old lease and drains native/owned command work
before SUPERSEDED. Operator cancellation wins while that stop is pending. The
scheduler then reserves a new STARTING Run and task binding before native start,
retaining the complete frozen prompt, verification configuration and SCM target.
An atomic workspace-transfer record moves the existing physical worktree/branch
to the next Run/attempt; startup restores only its latest owner. A durable
actor/workflow receipt replays the replacement identity after a lost start
response. Replacement and ordinary local starts share the reserved Session,
start receipt, execution-context checks and final SDK admission. Stale-start
cleanup can stop only the original attached CLI under its captured AUTOMATED
control fence; it leaves the native start UNKNOWN and never stops a new human
owner or shared native host. SCM preflight requalifies the original target/context, while
unrelated changes since the old Run do not replace its frozen verification.

Embedded Runner heartbeats renew non-terminal leases while verification or SCM
calls are awaiting I/O. Renewal expiry is persisted and cannot revive expired,
revoked, or older-generation authority. Startup failures retain a failed Run
and readable diagnostics instead of disappearing before Run persistence.
Lease failure fences the Run before cancelling its current agent session;
cleanup errors remain visible in the failure reason.
Operator cancellation also aborts local verification process groups and waits for
the current advancement to settle before acknowledging CANCELLED. A pending
cancellation fences further verification/delivery even if persistence fails.
Qoder, Generic CLI and Runner ProcessManager process/PTY handles share owned
process-group cleanup; detached active sessions and HTTP responses without a terminal state cannot confirm a stop.

GitHub delivery persists PR/commit evidence before CI reads. A bounded background
reconcile reads PR state/current head, commit statuses and paginated check runs,
then updates evidence through revision CAS in persistence. Zero checks and
incomplete reads remain pending.
PR observations remain durable during a CI outage, and a changed head loses
the preceding commit's passing CI and check URL until reread.
Durable feedback records drive canonical
comments/outbox projection and retried Slack thread notifications. Task REVIEW
maps through the Linear connector's `settings.statusIds.REVIEW`; CI success
keeps REVIEW unless GitHub connector `settings.doneOnCiPassed` is explicitly
true. Run COMPLETE means execution/delivery finished, not CI passed. Default
REVIEW preserves the operator's final acceptance decision. Auto-Done is a
terminal canonical decision; later CI reruns are still reported but do not
automatically reopen terminal tasks.

Background advancement scans ACTIVE, VERIFYING and DELIVERING. RESOURCE_BLOCKED
is resumed through resource recovery or explicit resume, and WAITING_USER
through user input. Automatic local verification journals each registered command
as SENDING before process creation and SETTLED only after the captured Task,
control and lease fences still hold. An uncertain result remains UNKNOWN; a
Controller restart holds local VERIFYING Runs for explicit reconciliation,
including legacy records without invocation receipts. It never repeats a command
from the stored phase alone. Verification snapshot creation shares the physical
Git common-directory mutation queue with managed worktree creation/removal and
rechecks authority after queue admission.
Run advancement/dispatch exclusivity and messaging inbox
claiming are within one Controller process; they are not multi-process locks
or database CAS. Delivery evidence revision CAS does not change that deployment
boundary.

```text
React Dashboard
      │ HTTP + SSE
      ▼
Fastify Controller ─── ConfigPlan Engine ─── SecretStore
      │                       │
      │ typed events          └── opaque secret:// references only
      ├── Internal LLM Runtime ─── protocol adapters + safe fallback
      ├── Connector Registry ─── Linear / GitHub / Slack / contract fakes
      ├── Canonical Task Service ─── inbox + outbox + bindings
      ├── Fleet Read Model ─── bounded cursor events + attention policy
      ├── Semantic Workflow ─── typed intent + allowlisted tools + approvals
      └── Deterministic Scheduler ─── Codex/Qoder profiles + managed worktree
      │
      ▼
Embedded Runner ─── Adapter Contract ─── Execution Backend
      │                                      │
      ├── versioned Controller–Runner protocol
      └── Workspace Manager + bounded raw logs + Verification Registry

Remote Runner ─── WSS + auth + seq/ack ─── Controller
      ├── SQLite journal + replay/reconcile
      ├── generation/lease delivery fence
      └── PlatformAdapter ─── launchd / Windows Service / systemd
                              Unix PTY / ConPTY / native credential store

Controller + ConfigPlan + Canonical Tasks ─── SQLite repositories (WAL)
```

## Package ownership

| Package | Responsibility | Must not own |
| --- | --- | --- |
| `domain` | Six primary entities, four state machines, invariants | I/O, HTTP, SQLite, UI |
| `protocol` | Versioned envelopes, commands, events, responses | Transport or persistence |
| `persistence` | SQLite lifecycle, migrations, repositories, CAS revisions | Business orchestration |
| `runner` | Event bus, Embedded/Remote transport, journal, lease/reconcile, native process and platform service adapters | Controller policy |
| `llm-runtime` | Protocol normalization, probes, role pools, safe switch, circuit/fallback/failback | Semantic intent or secret persistence |
| `adapters` | Manifest, discovery, normalized session contract, Generic Mock/CLI, Codex and Qoder | Scheduler or database internals |
| `semantic` | TaskContract compilation, Typed Intent v2, entity resolution, allowlisted tool policy and durable workflow states | Provider payloads, arbitrary shell or secret values |
| `scheduler` | Deterministic eligibility/ranking and Run creation bound to task/contract revisions | Provider implementation or task persistence |
| `fleet` | Rebuildable Fleet snapshot, activity, stall detection, bounded cursor stream and pagination | Provider SDKs, HTTP or persistence |
| `integrations` | Connector contracts, Linear, GitHub, Slack messaging, canonical task commands, projections, delivery evidence | Controller HTTP or secret persistence |
| `workspace` | Repository registry, isolated Git worktrees, path and cleanup policy | Agent behavior or delivery policy |
| `config` | Canonical schema, precedence, plan/apply/verify/rollback, secrets | Web rendering |
| `observability` | Structured logging and recursive redaction | Domain decisions |
| `controller` | Lifecycle composition, HTTP/SSE API, CLI, static assets | Provider-specific logic |
| `web` | Dashboard, settings, setup wizard | Secrets or direct database access |

The `domain` and `protocol` purity rule is executable through
`pnpm boundaries`.

## Runtime lifecycle

Controller startup is ordered and reversible: database and migrations,
configuration, event bus, Embedded Runner when requested, HTTP routes, then
listener. A failed module start rolls back already-started modules in reverse
order. Shutdown is idempotent and also runs in reverse order.

`GET /health` reports process health. `GET /ready` additionally requires the
lifecycle to be ready and, in Embedded mode, the local Runner to be online.

## Persistence and consistency

SQLite is opened with WAL, foreign keys, and a busy timeout. Migrations are
versioned and transactional. Core entity snapshots and protocol events use
stable identifiers; duplicate event message IDs are ignored. Configuration is
stored as a canonical JSON document with an integer revision. Every apply and
rollback uses compare-and-swap semantics so a stale plan cannot overwrite a
newer revision.

M5 adds durable connector instances, external bindings, idempotent inbox and
outbox records, sync cursors, dead letters, canonical tasks/contracts, and
delivery evidence. A canonical task command commits the revision and every
projection record in one SQLite transaction. Connector outages therefore do
not roll back canonical state; bounded workers retry with backoff and move
permanent or exhausted failures to the dead-letter store.

## Configuration and secrets

Native session persistence now uses migrations 4 (`native_session_interaction`)
and 5 (`minimum_writer_protocol`): canonical Session-keyed bindings, revision/
epoch CAS, command receipts, observation checkpoints and identity diagnostics.
Migration 6 (`v3_native_convergence_writer_protocol`) atomically raises the
writer protocol to 2 so an already-open personal-local protocol-1 binary cannot
erase v3 execution choices. Schema 4/5 retain their original SQL and semantics.
Migration 7 (`guarded_control_runtime_writer_protocol`) raises the protocol to 3
before Controller control integration: an already-open protocol-2 intermediate
binary must not write through newly activated control records. Migration 6 is
unchanged. Backups use the protocol of their own snapshot, and only the restored
copy upgrades; rollback restores both SQLite and connection writer state.
Migration 8 (`guarded_controller_start_writer_protocol`) raises the protocol to 4
for ordinary guarded local startup, rejecting already-open protocol-3
intermediate writers. Migration entries 1–7 remain unchanged. Schema-7 backups
use writer 3; only a restored copy upgrades behind the restore barrier.
Migration 9 (`automatic_verification_receipt_writer_protocol`) raises the protocol
to 5 for non-replayable automatic verification. Entries 1–8 remain unchanged;
already-open protocol-4 connections fail writes, and old catalogs reject schema9.
Schema-8 archives retain writer4; only restored copies upgrade separately.
Migration 10 (`canonical_usage_origin_writer_protocol`) raises the protocol to 6
for immutable producer-origin observations and collector aliases. Entries 1–9
remain unchanged; protocol-5 writers are rejected before they can turn a saved
collector alias into a second quantity. Schema-9 archives retain writer5.
Migration 11 (`frozen_native_pricing_writer_protocol`) raises writer7 for reviewed
price snapshots and startup revalidation. Writer6 can preserve immutable JSON but
does not know that changed native price terms require fresh review. Entries1–10
remain unchanged, schema10 archives retain writer6 and restored copies alone
upgrade behind their existing reconciliation barrier.
Connections register `dispatcher_writer_protocol()` before writes; upgraded
triggers reject older writers. Nested repository operations use savepoints so
a caught inner failure cannot partially commit native identity changes.
New Run execution choices remain v3 `ExecutionSelection`, independently frozen
from historical `modelSelection` records. Native binding validates a new Run
against its frozen contract's repository/base commit; current config cannot
repair missing historical identity.

The Controller refuses live persisted native execution/control outside its exact
unbound local start certificate, and unadapted legacy model selections, before
restoring leases or starting workers.
Schema compatibility alone is not permission to take over another native writer.
Missing/conflicting old binding facts remain diagnostic and do not acquire
AUTOMATED control. This staged integration does not enable native takeover UI.

The adapter's optional `NativeInteractionPort` qualifies each capability against
its exact native scope; existing adapters without the port stay compatible.
Runner's `native-observation` is a bounded read-only observer with independent
connection generations and ordered snapshots. It is distinct from the existing
remote execution `NativeRunnerRuntime`. Command dispatch, quiescence, release,
stop and reclaim helpers require current-authority callbacks and qualified native
evidence. An uncertain receipt never authorizes a retry. Native event checkpoints
hold bounded metadata and provider cursors separately from transport replay,
command identity and ACKs in the Runner journal. These helpers are foundations;
Controller admission remains closed until all write paths use the shared Guard.
The startup barrier may recognize this Controller's unbound local start journal
only when its original command semantic hash matches the frozen Run selection,
contract hash and embedded-runner marker. It also validates exact Session, lease,
generation, backend and the initial AUTOMATED/exclusion-none control. Corrupt or
foreign records, native bindings, executionRef and post-handoff control still
fail closed. Qualification performs no native call or mutation replay and does
not claim that a persisted process is attached or stopped.
Drift comparison uses the frozen v3 model/effort; an omitted native default
cannot be compared to a fabricated bound model. Missing account identity stays
unknown, and exact policy requires a provider-confirmed account fingerprint.

`NativeRuntimeHosts` owns explicit host claims independently of sessions. It
coalesces only the same native store/backend/execution scope, captures methods
and ownership before awaits, drains admitted interrupts and pins unknown results
without reacquisition. External hosts are detached, never stopped. Owned host
stop additionally needs native quiescence, an empty owned process group and
backend containment evidence. Local transport cleanup cannot prove native tools,
writer release or deletion. ProcessManager exposes optional fresh process-tree
observations through its existing OwnedProcessGroup; POSIX group absence latches
to avoid probing a reused numeric PID. PTY/Windows tree membership stays unknown.
Existing handles without tree evidence remain valid consumers but cannot prove
host cleanup. Recovery decisions may request read-only reobservation, never start
or resume execution automatically.

Controller's `NativeInteractions` coordinator owns session mutation lanes,
captured Task/control/lease fences, original native request handles and durable
command receipts. Recovery turns in-flight sends into UNKNOWN; it never infers
that a failed reply means no native effect. External observations keep only
qualified metadata and block writes on gaps or identity changes. Reclaim needs
fresh read-only Git/native/resource facts, explicit confirmation and an atomic
new epoch; it compares the v3 selection against the frozen Run contract and its
revision, never a newly edited Task contract. Start reservation/settlement also
compare the frozen choice and execution context. Existing acknowledged receipts
remain readable across authority changes, while sending needs current authority.
The coordinator now fences Web/Slack continuation and operator/resource resume
through a shared Session mutation lane. Their captured Task/control authority
is checked again by the final adapter callback. A proven pre-write rejection
is distinct from an uncertain response after sending. Slack input shares durable
Run-input receipts with Web and resume, so a lost reply cannot authorize a
cross-channel resend. Stale cleanup must retain the captured epoch and never
stop a new control owner. Worker advancement and existing verification/Git/PR/completion fences now use
the same coordinator and acknowledge only their own Task transitions.
Usage reads now run outside that lane and business advancement, with scoped
coalescing, terminal retry and shutdown fencing. Execution resource facts come
from owned status/results independently of billing reads. Query failures retain
unknown telemetry without declaring the provider down. Reroute/start/recovery
remain pending; native startup admission stays closed. Failure
cleanup retains unavailable capacity and the existing Session stop receipt until
owned execution has stopped and captured authority is rechecked. Unconfirmed
stops require reconciliation; saved terminal snapshots cannot prove local process
termination. Native-bound runtimes require qualified session-scoped stop evidence.
Operator cancellation pins its caller and fence before queuing, revokes/aborts
existing work, and rechecks authority at the adapter's final stop callback. It
retains owned command/process drain before atomically committing Run and Task
cancellation. Unknown stop receipts block another blind stop; a proven unsent
rejection clears only its own stop intent. Explicit cancellation may stop an
expired lease's original invocation but cannot authorize continuation. Pause
uses the same lane/final callback and rejects missing admission acknowledgement.
Local native-bound cancellation stays closed until a qualified stop is wired.
Ordinary embedded dispatch now reserves its Session/control/start intent in the
same transaction as the queued Run. Adapter preparation precedes final SENDING
admission; the receipt then settles against that exact identity. Final Task/Run
projection checks the queued Task revision and original control. A concurrent
revision, including a canonical comment, keeps its content and requires manual
reconciliation rather than accepting stale startup. Basic execution-context and
native model-catalog fingerprints have distinct meanings; final admission pins
the former while the existing selection preflight validates the latter. Remote
startup retains its separate owning-Runner contract pending CV-12 composition.
Guarded local startup was introduced with schema8; current automatic verification
requires at least schema9/writer5; origin-aware usage requires schema10/writer6,
and native price admission requires schema11/writer7. Native control remains
unavailable until its remaining runtime composition is qualified.
Failure revokes and aborts its original owned verification command before
waiting for the Session lane, then requires both adapter stop and owned command
drain before FAILED. Stop intent audit stays on the existing Session authority
with actor, operation and captured fence; adapter persistence preserves it. A
notification failure is retried separately from a confirmed execution outcome.
A RESERVED local start can be cancelled without native I/O: one SQLite
transaction checks the current fence, cancels the reservation, revokes the lease
and commits Run/Task cancellation with the existing NATIVE_START_NOT_SENT proof.
This pure Core decision has no Session-lane wait or SDK stop. Cache/publication
receipts update in that same transaction. A recovered RESERVED start retains
its no-send evidence and is cancellable explicitly. SENDING/UNKNOWN and detached
ACK journal recovery remain manual and never replay creation. A reserved
Dispatcher Session ID is not native creation or process-liveness evidence.
Publication recovery now reads the start journal; a lost Task projection cannot
turn a reserved ID into STARTED.
The same qualified local journal now covers direct/Slack-created Runs without
publication records. Startup marks interrupted STARTING/ACTIVE ownership manual
and unavailable without SDK calls, preserving the original invocation identity.
A sealed FAILED start receipt may finish only its original queued Task revision;
a later edit is retained. This projects a past no-creation fact even after lease
expiry, without granting execution authority. Waiting/verification/delivery
phases retain their existing paths. Existing startup caches/publication receipts
share one scoped projection helper.
Reroute captures its old Run/profile/Task/control fence before the dispatch queue.
A stored outcome is readable without reacquiring mutation authority. Otherwise
refresh and stop preflight retain the original fence. Once the old Run is
SUPERSEDED, a dedicated stage guard requires its revoked original lease, exact
current Task revision/control, confirmed scoped adapter stop and no uncertain
commands before reusing its worktree. It rejects native-bound or executionRef
sessions. Replacement startup composition remains separate work.
Generic's default SpawnProcessExecutor keeps cancellation request state separate
from observed completion. It blocks stdin immediately, but terminal status waits
for owned-group drain and outcome; a failed drain remains nonterminal. The
Controller's existing ProcessManager-backed generic executor is a separate path
and retains its own completion barrier. Known no-send cancellation uses START_FAILED
with the cancellation reason; sent/unknown cancellation stays distinct.

Codex CLI start/send/resume accept an optional synchronous `beforeSend` admission
callback. Creation captures request fields before storing intent, then checks
admission immediately before invoking the backend. Same-session input checks
after awaiting the previous result and again after storing its new turn intent.
Async/non-void guards are rejected without awaiting them. Only a local guard
rejection produces a `not-sent` admission error; a creation rejection before
backend invocation additionally proves `not-created`. Native backend failures
do not gain that proof. Existing consumers may omit the callback; full Controller
composition and qualification of other writers remain required before enabling
native control transitions.

Other built-in local writers use the same final callback. Structured CLI builds
its arguments first, checks authority after credential/executable awaits and
intent persistence, then invokes the backend. HTTP writers check after credential
resolution, immediately before fetch. An injected async Devin backend must
explicitly implement this callback contract before guarded calls are admitted;
this internal ABI is not evidence of a native interaction capability.
Adapter start snapshots supplied logical generation/attempt/lease facts without
inventing defaults. Persisted execution metadata and execution references cannot
be replaced or erased; continuation also compares them after awaited reads.

The Scheduler offers a reserved creation lifecycle for guarded consumers. It
captures a real Session ID before preparation and carries Run generation,
attempt and lease. The adapter final callback records sending; a retained
callback cannot authorize a later invocation. Created results require the same
identity and frozen choice. A lost reply or failed success receipt remains
unavailable/UNKNOWN; only explicit not-created proof permits a known failure.
A start receipt can be pinned UNKNOWN even if a faulty backend ignored the
sending callback. No UNKNOWN receipt grants retry authority. This lifecycle is
available for Controller composition; native execution locations stay closed
until their actual backend context is qualified.

Legacy canonical HTTP/Slack dispatch and owning-Runner reroute compile a new
`legacy-config` ExecutionSelection from the selected adapter's actual invocation
defaults. The projection carries backend/model request facts, with no native
catalog qualification. Generic PTY owns its backend choice; a multi-backend
adapter without a projection cannot borrow the first declared backend. Scheduler
passes the reserved Run's snapshot into start and adapter sessions retain it.
Existing configured-model consumers can preserve those legacy requests while
unsupported interactive selection stays closed. Qoder continuation uses the
stored snapshot. New Run contracts freeze workspace facts from the created
WorkspaceHandle; historical records are not filled from current configuration.
Legacy continuation rechecks scoped execution/credential context without querying
or inventing native catalog evidence. Native reported model and price can remain
unknown independently of a configured request.

The optional reserved Dispatcher Session ID in AdapterStartInput is preserved
by every built-in adapter family and remains distinct from provider-native IDs.
An existing ID is rejected before another create. Structured CLI stores its
intent before async credential preparation so the ID cannot be reused during
that await. Known local spawn/preparation failures can prove not-created; lost
HTTP responses cannot. This is an adapter contract: Controller reservation and
the creation receipt still need to be composed before lifting native admission.

SQLite online backups are consistent private archives with checksums and an
inventory. Archives refuse live startup; restore targets must be new directories
and retain a durable reconciliation barrier. Restoring bytes alone never
authorizes replay of Agent starts, inputs, outbox or delivery side effects.

Runner credential revocation first denies the in-memory identity, closes its
connection and persists a new opaque identity epoch, then revokes Run leases
before awaiting secret-store work. Authentication and remote RPC replies recheck
the same identity after awaits. Re-enrollment revokes the old identity before
replacing its secret; credential mutations serialize per Runner. Generic secret
routes cannot overwrite configured Runner references or delete applied references.
A shared reference can be revoked for one identity without deleting the other
Runner's value; enrollment/rotation requires a dedicated reference. Connected
remote identity changes require revoke/disconnect, and a composed Embedded
Runner identity requires a Controller restart.

Effective configuration follows the frozen precedence:

```text
defaults < bootstrap input < canonical database state < explicit runtime override
```

All persisted configuration, including connector instances, repositories, and
Codex profiles, must pass the versioned JSON Schema and semantic validation. A
proposed change becomes a `ConfigPlan`; sensitive and privileged
plans require explicit confirmation. Apply, runtime verification, durable
write, and audit are one logical transaction. Failure restores the previous
runtime configuration and records a classified failed plan. Explicit rollback
uses the same runtime verification and audit boundary; if rollback fails, the
active canonical revision is preserved and the failure is classified.

The authenticated `GET /api/config/export` exports an applied-revision reference
snapshot, independently of browser drafts. It reuses the console projection and
omits private paths, arbitrary provider/connector settings and executable/argument
payloads; URL credentials, queries and fragments are removed. Opaque credential
references remain references and are never resolved. Omission paths and generation
time make the reduced scope explicit; this snapshot is not a full restore document.

Configuration contains only `secret://namespace/name` references. On macOS,
secret values use Login Keychain. Other platforms require an explicit
`DISPATCHER_SECRET_STORE_KEY` and use an AES-256-GCM local envelope with 0600
file permissions. Enabling an integration requires a correctly namespaced
reference that already exists in SecretStore; apply and CLI import fail closed
when a required reference is missing. Resolve authorization binds each
reference namespace to an integration, provider, or LLM purpose. Secret values
are accepted only by write/test/delete APIs; there is no read-value API. The
API returns only reference, backend, existence, and last-test status. Logs,
errors, audit records, events, and exports pass through the redaction boundary.
Deletion is rejected while the active configuration still references the item;
the owning configuration must be disabled or rolled back first.

## Dashboard boundary

Vite produces static files served by the Controller. React Query owns API
cache state and SSE invalidates live fleet data. JSON Schema and RJSF render
ordinary settings with the same Draft 2020-12 schema used by the Controller;
secure values bypass form state and write directly to the Secret API, while the
resulting opaque reference is added to the ordinary configuration draft.
Settings exposes plan preview, apply, verification state, and immediate rollback. The
setup wizard persists its step and expected configuration revision so refresh
and restart are recoverable.

The console uses a shared navigation/topbar with route-level lazy pages. Public
page names `/harnesses`, `/models`, and `/devices` retain `/agents`, `/llm`, and
`/runners` as redirects. Task detail links carry the canonical task ID, including
archived tasks. Devices combine configured registrations with independent
Runner heartbeat evidence. Repository and policy editors embed the same
sectioned settings/ConfigPlan workflow rather than adding configuration writers.
Global search, appearance preferences, and publication drafts are browser-local.
Task drawers read canonical records, persisted attempts and archive revisions
independently of Fleet. Run details expose their frozen contracts; result reads
remain separate from Task acceptance. Known UI operations submit structured
semantic intents with explicit entity identities through the existing approval
workflow. Harness trials enter canonical publication. Account creation can
return a preview-only ConfigPlan before explicit apply; legacy API callers keep
the existing apply behavior. Console configuration plans send baseRevision for
an atomic editing-base fence, while legacy plans retain their apply-time fence.
Internal role reset restores pool order without inference and fences asynchronous
selection writes that began before the reset.
The publication composer uses durable Controller preview/commit/read APIs. A
confirmed publication atomically reserves its canonical task, contract,
execution intent and idempotency receipt. The existing dispatch path reserves
Run/task/publication STARTING before native startup; replay returns the same
identity. Local `delivery=none` retains the worktree and a bounded file manifest,
completes the Run and moves the Task to REVIEW. Frozen Run contracts,
verification command descriptions and physical repository roots survive later
configuration edits. Local workspace repository IDs are separate from remote
SCM owner/name values.

Native model catalogs stay inside each execution adapter. Codex uses isolated
read-only app-server RPCs; Cursor, Qoder CN, Grok and Antigravity use fixed,
bounded native CLI queries. OpenCode uses an owned private v2 service with
read-only model/location RPCs, native schema/version qualification and mandatory
process cleanup. OpenCode account binding reads native SQLite metadata without
credential values; changes to its native schema fail closed. Its catalog/account
schema stays pinned to 2.0.26 independently of execution protocol qualification.
The owning Adapter supplies its actual standalone/server backend; both the context
fingerprint and revision include it. OpenCode reads capture logical scope, account
environment and physical workspace before executable resolution, spawn the captured
physical executable, pin native project/PID and double model snapshots, then recheck
physical/account/executable context after confirmed owned cleanup before returning.
Catalog revisions
hash content and account, native configuration and project fingerprints,
excluding retrieval time. CLI reads fence native account/configuration state
before and after the query. Antigravity lacks a non-interactive account identity
query, so macOS keyring metadata is a conservative account-change fence; hosts
without a qualified identity fence expose native default only.
Publication validates again at commit and in the actual worktree before startup.
Per-session model/effort selection is frozen and reused on continuation without
changing account defaults. Native listing is unconfirmed access; missing prices
and numeric quota remain unknown. Definitive authentication failures block both
explicit models and native defaults. Unqualified native providers and remote
publication execution are explicitly unsupported. Per-run selection capability is declared
by the adapter; publication does not infer it from a generic CLI model flag.
Known authentication failures and account changes block both selection modes;
cache fallback cannot authorize explicit selection. Native model IDs can encode
effort or auto-routing without exposing separate parameter metadata. Missing
per-model parameters and account prices remain unknown.

Policy routing is opt-in and confined to the selected account/project. Domain
owns its strict configuration and decision types; scheduler evaluates bounded
keyword groups and project/global rule precedence without I/O. Controller stores
actor/raw-draft/config/catalog-bound immutable decisions and consumes them in the
publication receipt transaction. Preview and trial never start an agent or create
a worktree; draft trials cannot authorize execution. Commit and startup refresh
the native catalog against the reviewed decision without reclassifying or selecting
a substitute. Automatic confirmation is separate from task execution approval;
the Run records its final approval facts. Native-default reasoning omits the
parameter instead of copying a catalog default. Hybrid classification uses an
optional, explicitly bound `task_classifier` role with no tools. Controller deduplicates
raw-input/type/prompt/role-version analyses and cancels superseded work; all pool
attempts share one 20-second deadline. Exact type/evidence validation and the
configured failure policy precede pure rule selection. Call-local provenance and
observed usage survive fallback independently of mutable role preferences. Trials
default to keywords; semantic trials require an explicit action. Reanalysis creates
new evidence and supersedes the old publication review without changing a Run.
Create-only local tasks re-enter the same publication composer and receipt service
through a task-bound preview. The server reconstructs instructions and workspace
from the canonical contract, binds task revision plus contract hash, and commits
an execution intent for that existing Task. READY contracts remain frozen.
Unexecuted local NEEDS_SPEC tasks can supply a schema-validated specification to
that same preview. It binds actor ownership, task revision, contract hash and
unarchived state; preview makes no canonical edit. Confirmation atomically updates
the original Task (including its repository-backed project), compiled contract,
execution intent and receipt. Partial saves remain NEEDS_SPEC and reload from the
owned publication draft. Completed saves become READY; immediate dispatch checks
the post-save revision and reviewed contract. No second Task is created. Startup rechecks the approved contract; source branch
movement does not replace an existing task's frozen base commit.
Enabled routing changes qualify concrete native targets before ConfigPlan creation
and compare fresh catalog evidence again before apply. This I/O remains outside
the synchronous configuration transaction; configuration revision fences protect
the gap. Accounts/projects must already be applied to qualify their native context.
The schema-backed policy editor reuses native catalog selection and the existing
ConfigPlan writer. Disabled routing can retain an unqualified draft; enabling it
requires current native evidence. Catalog defaults are display metadata; omitted
execution parameters remain omitted at the adapter boundary.

Persisted ACTIVE native sessions are not physical process evidence after a
Controller restart. Interrupted publication starts and detached active executions
become OUTCOME_UNKNOWN with manual recovery; resume/reroute cannot blindly start
another process. Scope paths are rechecked against the physical execution
worktree, including a reviewed commit different from the source checkout.
Diagnostics export allowlisted measurements and counts only.

The Internal LLM page manages endpoints, profiles, ordered fallback pools and
role switches. Configuration commits through `ConfigPlan`; credential values
still bypass form state and enter SecretStore directly. Connection tests are
explicit—there is no background health polling. Adapter manifests are exposed
read-only to the Agents page, where their JSON Schema and UI Schema generate
the base configuration form.

The Agents page discovers Codex, Qoder and native CLI harness installations, creates alias-based
profiles through ConfigPlan, tests authentication explicitly, and shows only
profile aliases and normalized session state. `CODEX_HOME`, provider account IDs, and
credentials are never returned by profile/session APIs.
Quota and rate-limit events are persisted as per-profile `ResourceSnapshot`
records. They move an active Run to `RESOURCE_BLOCKED`, its task to
`WAITING_RESOURCE`, and remove the affected profile from deterministic routing
instead of classifying resource exhaustion as an implementation failure.
Normalized approval/input-required events pause the Adapter session and move
the Run/task to `WAITING_USER`. Supplying input resumes the same provider
session and returns both records to their active states.

## Internal LLM runtime

`llm-runtime` owns the normalized request/response/error/health contract and
protocol-specific HTTP payloads for OpenAI Responses, OpenAI Chat-compatible,
Anthropic Messages, and Azure OpenAI v1. Only the runtime resolves an endpoint's
opaque LLM secret reference. Semantic callers see normalized messages,
structured output, tools and usage; they never see provider payloads or
credentials.

Role routing resolves an explicit role binding or the global default pool, then
uses its ordered profiles. A manual switch probes the target before committing
and preserves the prior profile on failure. Request failures update persisted
health and circuit state and fall through to the next eligible profile. When no
profile succeeds, runtime state becomes `DEGRADED_NO_LLM`; Controller,
Dashboard, configuration and deterministic commands remain available.
Failback is conservative and requires repeated healthy probes.

## Adapter and execution foundation

Every coding-agent integration implements `AgentAdapter` and publishes an
`AdapterManifest` containing platform support, schema/UI schema, secret fields,
allowlisted probes, ordered execution backends and optional capabilities. The
shared contract kit exercises start/send/status/cancel/result behavior and
rejects malformed manifests. Discovery can run only manifest-declared probe
IDs and returns structured none/one/multiple/auth-missing/blocked results; it
does not accept arbitrary commands or paths.

Workspace Manager creates one traceable Git worktree and branch per
task/run/attempt. Canonical path checks reject traversal and symlink escape.
Cleanup first emits a plan and refuses unknown, out-of-root or dirty worktrees.
The Generic CLI backend uses a fixed executable and argv template; placeholders
occupy complete argv entries and are passed with `shell: false`.

Codex and Qoder implement the same `AgentAdapter` lifecycle and return the same
TaskContract-facing session/result types. Qoder discovery uses only manifest
probes. Its CLI backend assigns an explicit provider session ID on first
invocation and uses that exact ID for every resume. Credits, quota, rate-limit,
auth and outage signals normalize to shared ResourceSnapshot states. Scheduler
candidates carry the configured provider/profile rather than a Codex constant.

Runner processes are lazy, group-cancellable and timeout/idle-timeout aware.
Stdout/stderr become bounded activity summaries while redacted raw output goes
to rotating files with per-file and total budgets. SQLite does not store raw
output. Verification Registry executes only pre-registered file/argv commands
in the run worktree with timeout/output limits; required failures block
delivery while optional failures remain explicit evidence.
PTY execution is delegated to pinned Microsoft `node-pty`, which selects Unix
PTY or Windows ConPTY inside the Runner boundary. `PlatformAdapter` owns native
service plans, process-tree semantics, credential lookup commands, sleep
inhibition, and resource statistics. Scheduler/domain consume only advertised
capability strings such as `os:win32` and `pty:conpty`.

## Connector and MVP workflow

Connector definitions advertise versioned capabilities independently from
configured connector instances. External IDs and revisions live in
`ExternalBinding`, while provider-only fields stay in `platformExtensions`.
The version 1.2 protocol envelope adds ack sequence and lease/generation/expiry
fencing while retaining the v1.1 origin, causation, correlation, connector,
event, and idempotency metadata and continuing to accept v1.0/v1.1 fixtures.
Raw provider payloads are rejected at the protocol boundary.
The additive `native-execution-v1` capability defines bounded, versioned native
descriptors on transport1.2; health-only peers never receive those commands.
Descriptors reference registered account/repository/workspace IDs and frozen
selection, with no executable or arbitrary root override. Native mutations and
workspace-bound queries require lease identity/generation/expiry metadata.
Remote RPC coalesces matching in-flight retries, durably binds command identities,
and associates responses with the exact request hash using envelope idempotencyKey.
Changed-payload errors cannot replace successful receipts, including after reconnect.
Registration publishes connection readiness after installing the stream handler.
The client flushes retained outgoing frames before immediate reconnect RPCs and
sends late old-connection replies through the current ordered stream. Peers
without a disk journal use a bounded in-memory replay buffer for that process;
production Runner service uses its durable journal.
Workspace planning resolves the owning node's managed path without creating a
branch or worktree.
`NativeRunnerRuntime` owns a separate ConfigPlan-backed registration database,
native session store, managed workspaces, frozen verification commands and
durable execution reservations. It records PREPARING/STARTING before external
effects; uncertain outcomes never authorize another spawn. Command bindings and
input/verification receipts survive transport journal compaction. Restarted
process ownership is unknown even when a stored PID exists; an unstarted
PREPARED workspace can be restored and started with its original descriptor.
Terminal native status stores result and observed usage before persisting the
completed execution state. A restarted Runner can expose that durable completed
evidence while honestly reporting that no process handle is attached.
Native adapters persist STARTING immediately before spawn and record the actual
backend PID only when provided. Codex and structured CLI turns share owned
process-group termination with verification commands. On Unix, cancellation and
normal parent exit drain owned descendants, escalate after two seconds and only
resolve after the group is absent; an unconfirmed stop remains an error. Never
signal a recovered PID, and never reuse a group identity after it was drained.
Cancellation fences in memory before awaiting termination, so persistence failure
cannot authorize another turn. Windows uses the native taskkill tree operation;
its distinct-device process-tree acceptance remains unverified. Lease expiry/revocation stops owned native
handles and aborts active verification. Registration replacement is blocked
while an active or uncertain execution owns it. Runtime handlers are implemented;
`agent-runner serve` loads these applied registrations, advertises native
execution only when it has native profiles, registers the owning handlers and
uses a durable transport journal. `agent-runner config plan --file <config.json>`
and `config apply --plan-id <id> --confirm` use the existing DispatcherConfig and
ConfigPlan engine in that Runner's data directory. Stop the owning service before
using these configuration commands. An atomic SQLite writer claim prevents a
second live process from interpreting active sessions as restart recovery;
dead-owner takeover remains serialized and PID reuse conservatively blocks it.
An authenticated policy close stops reconnect attempts and shuts down owned
execution.
RepositoryConfig.runnerId is optional; omission keeps the configured embedded
Runner (or legacy local) ownership without rewriting persisted registrations.
Remote paths remain opaque on Controller, including foreign OS path syntax.
Controller never registers those paths locally or constructs their native
adapters. Applied-profile tests and model catalogs use the same owning Runner
RPC; publication inspection compares its registered root and verification
commands before freezing a base commit. Catalog results are bounded normalized
DTOs with matching account/Runner/provider identity. Global Policy qualification
uses only repositories on the selected account's Runner.
Controller's RemoteNativeAdapter sends normalized commands using a reserved
canonical Run's lease and frozen selection; it never constructs a native backend
or interprets remote filesystem paths. Remote workspace preparation happens
after the canonical Run/task reservation, and actual-worktree catalog evidence
is checked before native start. Verification, changed-file evidence and native
results return through that same owning authority. The Runner keeps capacity
through native turn completion until a fenced finalization command settles the
execution. Admission uses the lower of configured and reported capacity.
Lost start responses retain RUNNER_UNAVAILABLE/OUTCOME_UNKNOWN and immutable
start identity rather than releasing capacity as a known failure. Remote
delivery currently supports results on the owning device (`none`); remote
commit/PR delivery and distinct-device acceptance remain follow-up units. The
local acceptance evidence includes an actual Codex child owned by a separate
Runner process, frozen native parameters, Runner verification and finalization. Reconnection reconciles the canonical current Run against immutable start
hash, native session, workspace and lease/generation evidence. A Controller
restart can reattach an owned Runner session; a Runner restart with lost process
handles stays unknown. Temporary disconnection preserves the interrupted phase,
including verification/delivery, and never authorizes a new native start.
Inventory snapshots only apply to Run identities present when the query began.
Lease renewal is persisted by Controller only after a matching Runner response
and a fresh canonical fence. Revoked authority is durable on the Run. Operator
cancellation uses the lease even when a start response lost its session ID;
unconfirmed termination remains unavailable. Credential revocation fences local
authority, closes the authenticated connection and blocks old-token registration.
Runner shutdown revokes all admitted leases before awaiting any cancellation.

Linear webhook ingress verifies the HMAC against the exact request bytes,
enforces payload and timestamp limits, normalizes the event, and deduplicates it
before canonical mutation. Common-field ownership is explicit; reconcile never
silently overwrites concurrent canonical edits. Projection writes carry the
origin revision so echoed webhook updates can be recognized.
Task-platform portability is explicit: a dry-run reports projectable and
unmappable fields, and switching the primary binding changes only the task's
origin/binding. Canonical task identity, TaskContract, current Run/history, and
delivery evidence remain stable while both task-platform projections can
coexist.

TaskDraft compilation fails closed to `NEEDS_SPEC` unless repository, scope,
acceptance criteria, and verification are complete. Dispatch applies
deterministic capability/capacity/resource filters, creates a worktree only
from the configured repository registry, and binds the Run to task and
contract revisions. Arbitrary client-supplied workspace paths are rejected.
Run advancement persists each phase boundary: completed Codex sessions move to
verification, registered command results move to delivery, and retryable SCM
failures leave the Run in `DELIVERING`. Delivery requires passed verification
and the current generation/lease, then records commit, pull request, and CI
evidence idempotently. The compatibility decision and capability matrix are recorded in
`docs/adr-001-connector-contract.md`.

## Fleet, semantic control, and Slack

Fleet views are disposable projections, never a second source of truth. The
Controller rebuilds one snapshot from canonical task/run, connector and profile
records. Meaningful activity discards explicit noise and coalesces identical
signals. Stall detection keeps `WAITING_USER`, `WAITING_RESOURCE` and terminal
runs out of the stalled bucket. Dashboard events use a bounded coalescing
buffer, monotonic cursors and reset snapshots when a reconnect cursor expires.
Task and run tables page on the server; closing the dashboard closes EventSource
and leaves no polling loop.

## Agent ecosystem and compatibility routing

Every provider is registered through `AdapterManifest`; Controller never parses
provider output. Cursor and Kiro use verified headless CLI argv with structured
stream output, no shell interpolation, and credentials resolved from
`SecretStore` only into the child environment. Devin uses the official v3
organization session API and maps suspended/waiting state, ACU consumption,
and pull requests into canonical session/resource/artifact shapes. Explicit cloud
human attribution and positive integer ACU limits flow through existing ConfigPlan
settings; creation uses the minimum applicable configured/requested budget and
validates exact HTTP organization/session/owner identity. Custom backend snapshots
are captured once before validation and publication, retaining the supported optional
organization contract. Pre-fetch preparation cancellation proves not-created only
for creation; final admission stays separate and fetch-entered delivery remains
uncertain. Untrusted write diagnostics are static and never justify a retry.
The cloud library also exposes a bounded, scoped readonly history port with exact
binding/evidence checks and partial coverage. This does not register a Controller
cloud source or qualify mutations, native stop, writer ownership or GUI access.
The
WorkBuddy/CodeBuddy adapter uses an explicitly configured local HTTP contract;
endpoint templates require `{sessionId}` as a complete path segment. Generic
CLI keeps a fixed executable and argv template and grants only its declared
capabilities.

OpenCode v2, Grok Build and pi share bounded fixed-argv process execution with
provider-specific JSON normalization inside `adapters`. Child `cwd` and `PWD`
both point to the worktree. OpenCode uses its
private `--standalone` server so a local cancellation owns the execution rather
than leaving it in a shared background service. Grok and pi reserve a provider
session ID on the first turn; follow-ups use the exact ID, while OpenCode uses
the ID emitted by its stream. A busy session rejects a second turn. Resource
snapshots do not wait for an active process to finish, and structured errors
can fail a turn even when the CLI exits zero. Native token usage does not imply
quota remaining. Process groups are cancelled on Unix, with bounded escalation.

Antigravity, bundled ZCode, bundled WorkBuddy CLI and Qoder CN use that same
bounded native process backend. Antigravity resumes `--conversation`; ZCode
resumes `--resume` with its native settings and an explicit `edit` mode (its
prompt-mode default is otherwise `yolo`). WorkBuddy CLI is a distinct provider
from the configured HTTP WorkBuddy/CodeBuddy contract. Qoder CN has its own
native account/config directory and retains its regional executable identity.
All four require native execution evidence; a structured failure overrides
exit zero. No profile copies credentials from a desktop application.

Agent profiles may set `enabled: false` through ConfigPlan. Omitted means
enabled for existing configurations. Disabled profiles remain visible but
have no runtime adapter and cannot enter dispatch/reroute. Enabling/disabling
uses the same ConfigPlan checks as other configuration changes. Unchanged
Codex, Cursor/Kiro and native adapters retain live handles across profile
additions; replacing, disabling or removing an active profile is rejected.
Cursor workspace trust requires an explicit `trustWorkspace` choice; blanket
tool approval independently requires an explicit `approveTools` choice.
Cursor also exposes a bounded metadata-only library locator for the pinned ACP
inventory version. It uses the existing codec and root owner with explicitly scoped
HOME/workspace and filtered child environment; it restores no transcript or writer
capability. Its pure exact-ID predicate guards the existing CLI resume path before
credentials. Historical sessions without a model snapshot retain the canonical
refusal instead of borrowing today's profile default. Synchronous native allocation
errors are normalized at this owning boundary without retries or invented receipts.

Installation/capability probes remain separate from authentication. pi can
check a selected model's readiness without refreshing or exporting credentials;
OpenCode/Grok discovery reports authentication as unknown until invocation.
OpenCode and pi retain their native credential stores. Grok additionally accepts
an opaque `secret://grok/` reference resolved only into the child environment.
OpenCode/Grok unattended native tool approval requires an explicit
`settings.approveTools: true` profile choice through ConfigPlan; the default
retains native permission policy. Follow-up input starts a new turn in the
same conversation; live permission dialogs and process reattachment after a
Controller restart are not part of this headless backend contract. A stored
RUNNING session without a process handle is marked FAILED rather than reported
as still attached. See `docs/agent-harnesses.md` for installation evidence and
operator steps.

`GET /api/adapters/compatibility` derives backend, session, input, artifact,
and resource support from manifests and returns explicit unsupported reasons.
Scheduler candidates use those declared capabilities together with Runner
capabilities. A Run persists its required capability set so an operator reroute
is rejected if the replacement adapter cannot satisfy the original gate.
Discovery/health and a real business Run are separate evidence; an installed
CLI or reachable API is not presented as a completed end-to-end invocation.

The Assistant creates a durable Typed Intent v2 workflow before execution.
Aliases resolve to canonical IDs; zero or multiple matches require
clarification. Only registered semantic tools can execute, with input schema,
principal roles and risk policy checked again at execution. Privileged tools
require a persisted approval revision. Literal credentials are rejected before
an LLM call and redirected to secure input. Fixed commands remain available in
`DEGRADED_NO_LLM`, while manual GUI flows keep using Controller and ConfigPlan.

`messaging.slack` implements MessagingAdapter v1. Ingress captures exact raw
bytes, enforces the body limit and timestamp window, verifies Slack HMAC with a
constant-time comparison, and rejects replay before normalization. External
users have no authority until an administrator creates a `PrincipalBinding`;
display names are never identities. Each intervention thread has one durable
`ConversationBinding` with run, session, generation and revision fencing. A
WAITING_USER notification creates that thread, and a reply continues the same
provider session only after both fences match. Fixed and natural-language
commands reuse the M8 semantic workflow. Outbound replies are idempotent and
rate-limit aware; approval buttons carry workflow revision fences and declared
files are uploaded into the same thread. Normalized inbound messages and
attention notifications are durably deduplicated across Controller restart.
Literal credentials are redacted before Inbox persistence and receive a
short-lived signed link to the Dashboard secure-input flow. Notifications are
attention-only and cooldown-deduplicated.

## Change rules

- Add a state only by changing its domain contract and transition tests.
- Add a protocol message only through the versioned protocol package.
- Add a database shape only through an idempotent migration and upgrade test.
- Add a task platform or SCM provider only through the connector contract kit;
  keep raw payloads at the adapter edge.
- Add an Assistant capability only as an allowlisted semantic tool with a
  bounded input schema and explicit risk classification.
- Add a messaging platform only through MessagingAdapter v1; preserve raw-byte
  verification, principal binding, conversation fencing and idempotency.
- Never start an Agent in a client-selected directory. Resolve a configured
  repository and create a Dispatcher-managed worktree first.
- Never move secret values into configuration, logs, URLs, audit payloads, or
  process arguments.
- Do not implement a later provider integration inside Controller or Runner to save a
  package boundary.

## Console task views and execution evidence

The authenticated Fleet snapshot includes project presentation metadata derived
from canonical projects, task platform extensions and repositories explicitly
referenced by task contracts. Project identifiers never imply repository
identifiers. The Web project and account views group the same complete snapshot;
currentRunId remains authoritative, including when its execution is missing.
Run model selection is captured at dispatch/reroute rather than read from mutable
profile settings. Configuration selection and runtime evidence stay distinct.
Codex turn token evidence uses documented structured output, persists against
its Run, and is labelled latest-turn rather than cumulative or account quota.

Local task archive metadata is an additive `task-archive` entity keyed by task ID.
It retains the canonical task and all execution/delivery evidence and does not
change or project the task's status to an external platform. Archive/restore
checks task and archive revisions in a transaction; archive is rejected while
any attempt is unfinished, and dispatch is rejected until restore. This does
not extend Controller Run/inbox exclusion to distributed CAS or multi-controller
scheduling. Light/dark theme is a browser preference, not a ConfigPlan change.

Web replies to canonical runs require the displayed task revision and waiting
activity timestamp together with run/generation/lease identity. Controller
checks this authority before and after adapter input and cancels stale input;
trial sessions retain their separate input contract. Dispatch rechecks archive
metadata inside the reservation transaction after workspace creation.

## Console configuration edits

The authenticated legacy configuration read remains compatible. The console
view omits native private paths and secret-like values, with exact protected
JSON Pointer paths rather than writable placeholder strings. Revision-bound
add/replace/remove edits are applied to a clone of the real configuration and
validated through the same ConfigPlan engine. Indexed entity edits require its
current ID; unsafe pointers, root names and protected parent replacements are
rejected before plan creation. Explicit leaf changes and identified entity
removal remain available under existing confirmation/runtime lifecycle rules.
Plan status exposes original applied revision separately from current revision;
console plan/apply responses use the same safe projection. Controller connection
and Runner identity/credential changes require privileged confirmation.

## Account console evidence

Applied profile/Runner/repository registrations resolve through one Controller
execution context before saved-account probe, catalog, start or resume. Remote
native reads execute on the owning Runner; draft remote discovery is rejected
before Controller can spawn a probe. Account plan previews perform structural
validation without requiring an installed local executable.

Profile checks persist separate installation, compatibility and authentication
evidence in the existing entity store. List and detail use one projection;
ordinary reads never repeat native queries. Checks coalesce by account/context,
reject registration changes during a read, and expire after five minutes.
Registered local executable/native configuration file epochs invalidate prior
evidence where observable. External account switches and PATH-resolved upgrades
cannot always be observed without another native check and remain an explicit
limitation. Waiting canonical Runs also prevent unsafe adapter replacement.

## Native input receipts and cancellation

Canonical Web input reserves a durable, actor-bound run-input receipt before
calling the adapter. The identity binds the message and displayed authority;
successful retries return the original acknowledgement, including after restart.
An unconfirmed reservation blocks another input for the same waiting episode,
even with another ID or actor. Legacy canonical requests derive a stable ID;
standalone legacy sessions retain their separate compatibility contract.
No message text is persisted in the receipt. The browser retains its pending
draft/ID in session storage for explicit retry or receipt lookup.

Operator resume and automatic resource recovery use the same canonical
continuation gate and durable run-input receipts. They bind the original waiting
episode, task revision, session and lease before native resume, then recheck them
after the await and atomically advance Run/task/conversation with the accepted
receipt. Cancellation or a changed owner stops the stale continuation; a lost
acknowledgement remains unconfirmed and blocks another resume/input. A cancelled,
failed or mismatched native session cannot establish ACTIVE execution.

Cancellation revokes canonical authority before requesting physical stop. A
missing local process handle cannot confirm termination: the Run remains
unavailable with manual inspection required. The session store rechecks current
task/lease authority immediately before native spawn, and post-send checks still
stop a newly owned child when authority changes after that boundary.

Local Controller session records retain private versioned authority metadata
alongside the existing adapter snapshot: the original applied account/repository
context and requested/unconfirmed/confirmed stop state. Adapter updates preserve
that metadata; old unbound rows are never silently attached to today's account.
Changed or unknown standalone context permits saved history but prevents provider
queries/input through new credentials. Live local handle cancellation remains a
separate safe operation and never uses a recovered PID. Uncertain stop state
occupies admission capacity and protects profile/credential changes even when the
last native snapshot was terminal. A repeated confirmed stop replays its receipt.
An owning adapter's qualified terminal evidence can confirm the stop; detached
local history cannot. Pending/failed persistence also keeps an in-memory denial.
Devin and HTTP adapters save STARTING before external creation requests, retaining
uncertain startup rather than issuing an unrecorded retry. Their shared-store
operations validate the exact profile owner. The shared session console view
separates canonical task links from standalone history and exposes action flags
without private authority hashes or paths.

Controller-managed credential mutations have opaque persisted epochs keyed by
hashed references. The epoch advances before touching the secret store, so an
uncertain or failed write cannot keep old evidence current. A pending write
excludes new local execution/catalog/probe use and ConfigPlan applies that use
that reference. All nonterminal canonical work, pending starts/inputs/stops and
unresolved standalone work block replacement of a local account's credential.
Local catalog scope includes the applied account and observed credential epoch;
remote catalogs retain the owning Runner's native scope. Profile, connector and
credential checks reject late old-context results. External secret-store or
native-login changes remain observable only through qualified native checks,
not a claim of continuous account monitoring. No secret value or digest of a
secret value is saved in these epoch records.

Native catalog requests share only identical account/repository/config/native
scope and reason. A bounded latest UI snapshot per account/repository may be
shown as native-cache after a query outage; it never qualifies explicit execution.
Local catalog cancellation belongs to each adapter reader. Controller releases
HTTP requests when stopping, separately drains native reads for a bounded 3s
and preserves UNKNOWN cleanup diagnostics; late results cannot write storage.
All local catalog readers reuse OwnedProcessGroup and also require bounded
callback closure. Cleanup uncertainty overrides a usable catalog response.
The bounded version reader additionally accepts explicit `ownsGroup:false` for
a freshly spawned, non-detached root. It constructs one `OwnedProcessRoot`,
captures the original PID and bound child signal method, latches exit/close and
caches one stop operation including failure. Root stop uses TERM, bounded polling
and KILL; signal delivery alone cannot prove exit. Shared drainage accepts only
the structural stop capability and requires natural child close separately:
500ms for explicit root probes, 2000ms for existing group probes. Root cleanup
cannot prove descendant/tool termination, native quiescence or writer release.
Default-model ConfigPlans carry optional actor/revision/scope-bound review
metadata, saved atomically and requalified against fresh native catalog evidence
on apply. The publication's explicit account-default choice freezes the concrete
model and parameters in ExecutionSelection; native-default continues to omit
parameters. Legacy default-plan proof requires a fresh review.
Adapter entrypoints validate and clone the v3 selection before native preparation
and recheck stored model/owner binding after awaited work. Legacy invocation
entrypoints without a v3 selection capture one adapter-session default snapshot,
including a known omitted parameter; it cannot coexist with ExecutionSelection.
Historical missing or legacy-shaped model facts require reconciliation before
continuation. These persisted snapshots and their execution owners are immutable;
provider results and ordinary lifecycle state stay separate. Legacy canonical
Run selection compilation is integrated; the full native control Guard remains pending.


## Usage observations

Native adapters may return normalized versioned observations alongside resource
state. Codex exposes bounded cached events without awaiting an active turn,
with a persisted identity for each native turn. Qoder provides a bounded latest
resource snapshot without waiting for result completion. Legacy completed-result
getters retain a coalesced, nonblocking refresh for existing resource probes;
unsettled data remains unknown. Read failures return telemetry metadata without
claiming execution resource failure. Controller collects these from
its background advancement path, independently of dashboard connections. The
owning remote Runner persists its last observed usage; read-only cached usage
remains available after loss of process attachment without allowing execution.

The existing entity store retains one immutable observation per native event
identity. Replays are deduplicated and changed payloads conflict atomically.
Snapshots replace totals for their exact account/run/session/turn/generation/
period scope while preserving historical evidence; later deltas add only after
that snapshot. Metrics use exact decimal strings with explicit units and
inclusion relationships. Account periods are independent of task usage; time
filters refer to observation timestamps, not inferred consumption intervals.
The pure legacy measurement reader returns private read-only evidence, including
attempt/source/native-session and optional billing occurrence. It does not
produce canonical observations or totals. Cross-source event equivalence and
canonical attempt/time admission require an owning producer registration. New
origin-aware records pin attempt/native session and a trusted producer namespace;
collector event/query aliases refer to one immutable native event. Replays with
changed metrics, occurrence or execution identity conflict atomically. Legacy
records and their replay addresses remain unchanged; running legacy sessions do
not acquire producer identity by inference. Origin-aware snapshots and deltas use
the native `occurredAt` for ordering; missing or ambiguous occurrence keeps totals
unavailable. Observation-time filtering retains its existing meaning. Historical
collection time is not a substitute for missing billing occurrence.
Run.tokens remains the compatible latest-turn projection. Missing metrics and
unavailable billing baselines stay unknown. Management reads never query a
native provider. The current normalized token emitter is Codex; providers with
no qualified observation emitter do not acquire synthetic usage values.

An owning fresh model catalog may provide a bounded native-account-model price
snapshot for an exact parameter set. Inventory costs, subscription labels,
native-default with unknown model, cache-only data and parameter mismatches never
become prices. Canonical rates/quantities remain decimal strings. Preview exposes
the admitted snapshot and includes it in the confirmation hash; the existing
immutable ExecutionSelection freezes it on Run and AdapterSession. Pre-start
refresh revalidates terms even when the catalog revision is unchanged. A later
collection timestamp with identical terms preserves the original reviewed fact.

Owning Runners advertise `native-model-pricing-v1`. Strict transport validates the
optional snapshot and rejects private/numeric/unbound fields; Controller refuses
priced requests to older peers, and Runner rechecks the account/model price
before native creation. Ordinary legacy/native-default choices remain unpriced.

The saved usage query can project one selected Run's cost through the existing
exact engine using its frozen price and canonical observations. It verifies
profile/session/generation/attempt/native identity, derives billing time only
from admitted native occurrence and never queries a current catalog or provider.
Actual reported cost stays an independent metric/unit. The projection retains
formula, price, effective inputs, interval/time evidence, completeness and rounding;
filtered observation ranges cannot claim complete Run coverage. Pending/unknown
collection state makes saved amounts partial, and unresolved identity/event/source
conflicts make them unavailable until admitted recovery; later read failures do
not reconcile them. The existing usage UI displays that evidence without converting
amounts through Number.
Conditional-free/rate-interval producer admission and real account/model price
qualification remain follow-up requirements; unsupported evidence stays unavailable.

Account quota is a separate read-only projection, never a Run quantity or a
resource recovery signal. The Codex reader reuses its owned app-server connection
with only `account/rateLimits/read` added to the read allowlist; it receives the
applied account environment and cancellation. Native integer percentages and
credit decimal strings retain exact values, independent periods and missing
fields. No inference is started by this read.

The shared AccountQuotas coordinator in packages/runner coalesces one read per profile,
bounds admitted account reads to four,
and collects from the background worker independently of dashboard connections.
Its five-minute retry schedule and ten-minute source/last-success TTL are scoped
to the existing account/credential/native-file fingerprint. A native period reset
also expires cached evidence without inventing a renewed balance. Failure retains
the matching last success; a changed account hides the former snapshot. Pending
queries block account/credential replacement. A timeout aborts the owned read but
retains its handle until it settles, rejecting late/stale/shutdown callbacks.
Shutdown drains for three seconds and preserves a cleanup-unknown record and the
database when an owning reader remains unconfirmed.

Account/model screens use cached GET projections; only explicit refresh invokes
the native reader. They display source time, failure/staleness, actual zero,
missing dimensions and exact decimals. Legacy Run usage and quota remain separate.
Remote account read/refresh commands use the additive native-account-quota-v1
capability without a Run, lease or workspace. NativeRunnerRuntime owns the same
quota cache and lifecycle; Controller's existing background worker owns the
periodic schedule and the explicit refresh route owns manual requests. A cached
owning read invokes no provider. Physical profile registration and its local
native-file metadata epoch are checked before and after awaits. The shared
metadata helper preserves Controller's existing local fingerprint while remote
paths are read only by their physical owner.

The remote facade returns a strictly validated owner-state projection, including
its opaque source context, source time, last success and stale/error state.
Controller binds it to its own current registration/credential context without
restamping source freshness. An owner response that hides a changed account's
snapshot replaces the old projection; a transport failure may retain the last
matching snapshot only as error. Unknown/private fields and numeric quantities
are rejected at this boundary. The existing generic cache DTO adds only optional
sourceContextFingerprint; no schema migration or historical backfill is needed.

Runner-side pending/cleanup-unknown quota ownership blocks physical account
replacement and storage closure after a Controller wait has ended. Shutdown
stops RPC admission before draining, retains its writer/database on uncertainty,
and fences late responses. Account reads do not occupy the canonical Run lane,
so cancellation remains independent. Unsupported peers/providers stay explicit;
real remote/native account qualification requires separate evidence.

## Managed Pi RPC runtime

An applied profile may explicitly select Pi's compatible `pi-rpc` backend in a
managed worktree. Controller owns one runtime per profile and one host per frozen
ExecutionContextRef. Ordinary dispatch and an owned legacy reroute freeze the
same canonical workspace, selection, Run generation/attempt and Session identity.
Scheduler requires independent final creation and prompt admission. The Adapter
persists and ingests the native binding before sending the first prompt; a failed
event sink durably blocks that invocation instead of accepting later input.

Configured Pi agent/session directories stay outside managed repository scope.
Directory identity is checked before native creation and prompt transmission.
Runtime disconnect closes only its owned local connection and drains callbacks;
it does not prove background tools stopped, delete native sessions or release a
native writer. Shutdown attempts every runtime before saving receipts and keeps
the database available when cleanup or receipt persistence is unconfirmed.
A proven `not-created` failure can close a wholly unused runtime; unknown cleanup
and other active hosts retain the profile replacement barrier.

This compatible start path does not qualify native continuation, stop, history,
handoff or quiescence. A settled Adapter turn cannot authorize automatic
verification/delivery while native pending-tool/approval facts remain unknown.
The exact source is available through the owning runtime, but live Controller
source registration and real native capability qualification remain separate
requirements before a complete Pi task loop can be enabled.

## Internal Devin Local ACP client

The internal Adapter client uses the official ACP SDK for one owned local stdio
connection. It captures physical executable/workspace/native homes, checks
creation authority before the version probe and again before literal ACP spawn,
and removes Dispatcher authority variables from both child environments. Exact
protocol/version, bounded ingress, projected metadata and guarded SDK writes
remain local qualification requirements. Only canonical ExecutionSelection may
choose the explicit model; binding persistence precedes model change or prompt.

Local disconnect uses root-only ownership and independent bounded exit/callback
confirmation. Denied cleanup and unsettled forbidden callbacks remain unknown
in the cached receipt, with the original captured PID. Cancellation submission
cannot establish the prompt terminal, background tool absence or writer release.
This internal client has no public registration or Controller source and grants
no native approval, history or continuation qualification.

## Internal Codex App Server contracts

The preserved Codex stdio transport is internal to adapters and remains pinned to
its source protocol version. It does not register a backend, open a session or
qualify a native capability by being present. Physical home/workspace identity is
captured before an owned, bounded version probe and checked again before the
app-server child starts. Both children use the shared execution environment.

The transport retains bounded UTF-8 JSON framing, correlated requests and original
live callback ownership. A root exit rejects pending requests independently of
inherited pipe closure. Local disconnect stops only that captured root and drains
local pipes; background tools and native writer release remain unknown. Provider
binding, history and guarded execution belong to the separate backend/runtime
composition and do not come from the transport's cleanup receipt.

The shared durable observer explicitly distinguishes reserved identities from
Codex's provider-allocated thread. Only an unbound, currently STARTING Codex
App Server invocation can adopt that exact thread id. It saves providerSessionId
and NativeBinding together before sending the waiting event to the existing
owning sink; an existing identity must match exactly. Partial historical identity
cannot be completed from current configuration. The final admission is
synchronous and checks model/execution/observer/identity on both sides of the
callback. Pi retains the reserved-identity default. This internal contract does
not register or activate a Codex runtime.

The internal App Server backend consumes one captured canonical execution
selection and managed execution reference with the original synchronous final
admission callback. An explicitly injected CodexAdapter uses the same durable
observer and waits for native readiness, preserving the allocated identity when
publishing RUNNING. Default exec registration remains unchanged. Generic native
send/resume/cancel stay closed until the owning command/stop path is qualified.
Read/history and source-kind observations do not qualify native UI surfaces.

Binding and turn-event callbacks share runtime ownership. Initial event durability
precedes the first prompt; terminal result settlement waits for the durable event.
A callback failure fences further input. Local disconnect cancels local waiters
without revoking already admitted callback work; the existing bounded shutdown
reports callbacks unknown if that work has not drained, independently of root
exit. Neither callback completion nor local cleanup proves native writer release.

The Codex execution host composes that backend per managed execution through
NativeRuntimeHosts. It captures the original selection/reference, explicit
executable and physical home/workspace identity; cached sources require the same
durable binding and unchanged directories. Owner, prompt and mutation-authority
callbacks remain synchronous across wrappers. A foreign factory binding is
rejected before durable projection. Cold continuation stays closed; the internal
source continuation retains its original backend policy and binding.
Source lookup captures its binding and rechecks closure, registered ownership
and physical identity after the injected durable-binding lookup, which can itself
start shutdown synchronously.

The host has no aggregate interaction port. Known-unsent acquisition cleanup
clears a local host barrier only with a closed/not-created/drained receipt;
uncertain roots remain retained. Controller composition and actual
installed-protocol/account qualification have separate evidence boundaries.

Explicit App Server registration uses the existing per-profile nativeInteraction
field and confirmed ConfigPlan. It accepts compatible managed-worktree execution
on an embedded Runner with absolute executable and CODEX_HOME paths and native
login. Pi keeps its existing provider/backend pair. A configured App Server
requires its exact supplied execution host; missing/mismatched hosts or native
backend injection without opt-in are rejected rather than using exec.
The Controller owns the scoped Codex host alongside Pi and preserves unchanged
adapters across unrelated ConfigPlans. Spawn admission derives the original Run
from the managed workspace and validates its immutable selection/reference,
reserved Adapter invocation, session, generation, attempt and lease. The original
observer and synchronous beforePrompt guard still fence binding and prompt I/O.

Reads and approval callbacks resolve only the exact persisted execution binding;
a closed or mismatched owned runtime cannot borrow a profile aggregate port.
Qualified inspect/history refresh is bounded and coalesced per session; it stores
metadata, fences late reads and does not prove native quiescence. Startup approval
ingress waits for both the native ACK and owning canonical Task projection before
retaining its original fence. Durable connection epochs cannot be reused after
restart. Generic Codex continuation/cancellation remains unqualified.

Local disconnect closes admission, drains owned roots/callbacks and transactionally
persists normalized cleanup plus an unknown observation/read barrier. Failed
persistence retains the closed host; retry writes its cached receipt without
another physical disconnect. Changing an idle profile requires confirmed durable
local cleanup; an active canonical Run still blocks replacement. Shutdown attempts
all Pi/Codex/OpenCode/Devin Local registries and records each actual backend even if
another disconnect or receipt write fails, then closes HTTP/events and preserves
storage when host cleanup or exposed raw work remains uncertain. Pi tracks raw
guard results and admission/readiness alongside producer acquisition/turn/callback
work; public failure or a cached local receipt cannot erase that lifetime. Current
raw activity can settle while a cached unknown cleanup remains unknown. Local-review,
runtime and cleanup-uncertainty failures share the final error collection, so
simultaneous failures remain visible. Local cleanup never deletes native sessions
or proves background writer release.

Restart accepts only consistent bound canonical managed Codex/OpenCode/Pi/Devin Local metadata
for read and receipt reconciliation. A private checked-storage helper preserves
Run/Task/Session/Adapter/selection/reference/binding agreement, frozen repository/
base and unique SQL/document control ownership. Explicit provider wrappers retain
Codex thread identity, OpenCode global server identity and safe ses session grammar
(maximum512), and Pi global RPC identity with an exact36-character UUID; OpenCode/
Pi forbid thread/parent fields. Qualification performs no writes or physical/
account/native reads; physical checks stay at each provider's existing enabled
runtime construction/admission boundary.
Restart invalidates prior observations, retains exact identity and marks execution
ownership unknown/manual, preserving existing Task recovery transitions; it never
opens a native connection, replays startup or grants cold continuation. Corrupt or
unsupported records keep preflight closed. Consistent opaque rewrites establish
storage agreement only, not external native provenance or actual qualification.

Codex catalog reads capture the profile, logical context and actual owning
backend before asynchronous queries. Exec and App Server keep distinct backend
identities in the fingerprint and content revision. Foreign account context and
unsupported backend ids fail before I/O; catalog candidates still do not prove
entitlement, native model confirmation, price or runtime capability.

## Authorized native history

`GET /api/runs/:id/history` resolves the selected canonical Run/session and exact
persisted native binding through the owning runtime source. It authorizes before
source discovery and again at queued I/O admission and after completion. Captured
Run generation, attempt, lease, selection/reference, workspace and original port
must remain current; a replaced adapter, closed runtime or shutdown cannot publish
a late page. Authorized HUMAN/terminal history remains a read and requires no
execution mutation authority. Missing or unqualified sources yield bounded
unknown/unsupported pages without native input, reattachment or a new session.

The preserved native reader requests50 entries by default, caps pages at100,
retains actual native cursors/order and distinguishes deleted/unreachable,
summary-only, gaps and partial ranges. Each entry/page/serialized response is
bounded; only the requested normalized page leaves the read path. Text and
metadata use existing redactors; credentials in parseable timestamp metadata
cause rejection instead of invented cleaned identities. No transcript is saved
to Core or emitted as binding events.

A five-second deadline aborts the original read context; a late result cannot
return transcript or update persistence. HTTP close and owning native-host cleanup
remain separate from native writer-release or actual-provider qualification.

The canonical Task drawer opens this reader only on an explicit user action.
It matches the successful current Run projection and saved native identity,
requires server-supported historyRead, and clears its bounded window on a
meaningful binding/control/capability change or current header failure. A valid
CONFLICT control state alone does not revoke an authorized read; identity
conflicts still refuse it. The new scope starts collapsed and must be reopened.
The viewer retains plain text, source/range warnings and opaque cursors, with
50 entries per request and at most ten pages/500 rows per explicit window.
Saved NativeSessionSummary facts and native mutation availability stay separate.

## Diagnostic reads and registered checks

The diagnostics snapshot combines saved account evidence, current transport
connections, canonical recovery states, publication/delivery receipts and
durable synchronization failures. It does not invoke native tools, providers,
inference or recovery. Controller readiness remains separate from qualified
execution readiness; pass, fail, unknown and stale remain distinct.

Explicit check requests select a registered check/target. The registry declares
read-only versus provider-query cost and accepts no executable or client-defined
cost. Account checks reuse applied execution context/probe persistence; connector
checks bind the applied connector configuration and reject async drift. Their
saved health evidence expires after five minutes or a configuration change.
Export contains only scalar measurements and aggregate status counts.

Cached native resource reads retain event/session observation times; a new
explicit probe result may establish a new time. Remote cached reads preserve
their original timestamp across restart. Unmeasured process totals and hourly
LLM counts are null; the measured cumulative counter covers generation attempts
since this Controller instance started and excludes independent probes.

## Registered repository context and references

Read-only repository context identifies the configured repository, its durable
local Project, owning Runner and configuration revision separately. Applied
registrations establish local Project rows; publication creates the repository-
less local inbox Project in the same transaction as its first Task. Removing a
registration retains historical Project/Task identity. Context/reference GETs
never write configuration or project rows, create worktrees, fetch or execute
verification commands. A changed registration rejects an in-flight read.

WorkspaceManager reads sorted bounded existing refs, resolves annotated tags to
commits, omits non-commit tags and limits the entire read to eight seconds. Page
offsets refer to current refs, not a frozen execution baseline; publication still
resolves and freezes the chosen commit during review. The additive registered
native.repository_refs command runs only on the owning Runner and rejects
unregistered/foreign repositories. Controller validates the returned bounded
shape; it never interprets a foreign filesystem path. Older/offline Runners
return explicit unavailability rather than local fallback. The shared frontend
reference picker queries only on explicit request and retains native ref names;
repository context is shown independently from account/model readiness.

## Local directory selection bridge

Directory selections are authenticated administrator operations restricted to a
loopback peer and the running embedded Runner identity. Existing same-origin,
CSRF and rate-limit checks remain in force. Request schemas allow only purpose
and registered Runner/repository identifiers. The macOS bridge invokes a fixed
OS choose-folder program after checking console-session ownership; no request
can supply scripts, argv, dialog prompts or starting paths. Other platforms,
SSH/headless sessions and remote Runner requests return explicit unavailability.

Only one dialog is owned at a time. Cancellation retains the active slot until
the operation settles and discards a late selected path. Shutdown aborts/waits
for the owned operation. Bounded memory records expire and are not execution or
repository authority; restart cannot silently recover or reopen a dialog. The
candidate is displayed first and enters a new repository draft only on explicit
selection, retaining ConfigPlan review/apply. Neither cancel nor selection writes
configuration or creates a workspace. Actual Git validity, private path scope,
account/model and execution approval remain subsequent owning-device checks.

## Owning-process private path scope

WorkspaceManager receives private-path policy from its owning composition,
never a browser/transport request. It includes that Controller/Runner data
location, configured native account directories (including disabled accounts),
and default locations actually used by the qualified adapters/catalogs. Foreign
Runner account paths are not resolved on Controller. WorkspaceManager compares
physical paths, including existing ancestors for missing descendants, at
registered-root/declared-scope checks, immediately before worktree creation and
when validating each actual result file. Frozen workspace roots remain usable
after a registration is removed; the owning process private-path policy remains
active independently of that registration. Private-path resolution failures fail
closed with a static reason and do not expose account paths. A whole-repository
scope cannot authorize delivery of a changed file inside an account directory.
This is a repository and delivery scope boundary; native tools still own their
OS permissions and it is not an arbitrary filesystem sandbox.

## Explicit local commit delivery

A local commit is a distinct delivery choice after required verification. The
owning LocalGitDelivery service uses the existing host Git and ProcessManager
in the restored managed worktree. It verifies branch/common repository/ancestry
and scoped result files before staging, checks authority around every owned
command and validates the clean committed result afterwards. Git hooks remain
active inside the owned process group; cancellation drains that group before a
canonical acknowledgement. It never switches the original project worktree,
invokes push or calls a provider API.

A run/generation receipt binds lease, immutable workspace identity and message
before mutation. Completed receipts replay the real SHA without another commit.
Physical completion followed by failed receipt persistence is retained in this
process for a safe persistence retry; restart with an unresolved intent remains
COMMIT_OUTCOME_UNKNOWN and cannot blindly execute again. A terminal local result
stores its commit evidence and post-commit file manifest directly, without a
fabricated external connector. Existing native commits/no-change results are
identified by created=false rather than claimed as newly created.

Controller verification and local commit share the owned-command cancellation
slot. Both native authority and current canonical Task/Run binding must still
match before verification/delivery. The console stores the explicit choice in
its draft, displays it at review and shows the saved SHA separately from task
acceptance. Explicit PR delivery uses the separately reviewed selected-SCM path below.


## Owning Runner commit protocol

An optional delivery intent is frozen with native.workspace_prepare before any
worktree mutation. Omitting it preserves existing none plan hashes; an old
execution cannot acquire commit authority later. native.run_commit accepts only
a Run identity and fenced envelope, never roots, commands or replacement messages.
The Runner requires a successful native turn and successful frozen required
verification, invalidates verification on new input, and prevents new native
turns once delivery has started. Its owned Git process service records the real
commit receipt. A crash during delivery becomes unknown; a completed durable
receipt replays without repeating Git. Lease revocation and shutdown abort and
await owned command groups before acknowledging stop. The Controller validates
Run/generation/branch/SHA and scope before saving the canonical result. It never
runs Git against the remote repository and none/commit never push.

## Explicit owning Git push primitive

Workspace inspection can normalize the owning origin's single fetch/push identity
without returning its URL. The frozen target contains host/repository and a
configuration fingerprint. Credential-bearing URLs, unsafe paths, non-HTTPS/non-Git
SSH URLs, multiple push URLs and mismatched fetch/push identities fail closed.
The push primitive revalidates that target, commits through the existing owned
service, checks clean branch/SHA/scope, then pushes exactly that SHA to the managed
branch with no force, automatic tags or submodule push. Its own durable intent and
receipt prevent blind repetition after an uncertain outcome. It preserves native
Git authentication/hooks and drains the owned process group on cancellation.
The native push protocol exposes this only to a frozen PR intent. Publication
preflight binds that same target to the selected Controller SCM API.

## Native Git delivery negotiation

Standalone Runtime capabilities are the single source for CLI advertisement.
The additive native-git-delivery-v1 capability gates commit/push, delivery target
reads and non-none prepared intents on both Controller and transport dispatch.
Old native-execution-v1 peers retain none execution and receive an explicit
unsupported-delivery precheck rather than a descriptor they cannot validate.

native.repository_delivery reads only the owning registration's normalized origin.
A frozen PR intent authorizes native.run_push after a completed verified turn;
none and commit intents cannot gain push permission. Commit and push use the same
owned-command lifecycle and durable unknown-outcome rules. Verified PR runs cannot
release capacity before their frozen push completes. Native commands accept no
replacement targets, executable arguments, URLs or local roots.

## Explicit SCM publication preflight

New local contracts distinguish workspace.repositoryId from delivery.repository.
none/commit carry no fabricated remote identity; explicit PR contracts can retain
scmConnectorId, repository and baseBranch. External drafts without local execution
context keep their existing compilation semantics.

ScmDeliverySelection is a separate observed publication snapshot: selected
connector, owning target fingerprint, credential/config context and review time.
It is bound into reviewHash and rechecked before publication commit. It is not
a permanent credential epoch in the TaskContract, so later task reviews can
observe the current configured account without rewriting the task's SCM choice.
The owning Runner reads remote origins; the Controller reads selected SCM metadata.
A shared pure target predicate rejects extra/private fields on transport results.

GitHub preflight uses read-only repository and branch metadata, rejects mismatched,
archived/disabled repositories and absent/denied push permission, and requires a
qualified base branch SHA. This does not prove native Git authentication or the
token's Pull Requests write permission. Repository/branch API contracts follow
the [GitHub REST docs](https://docs.github.com/en/rest/repos/repos#get-a-repository)
and [branch docs](https://docs.github.com/en/rest/branches/branches#get-a-branch).
SCM or credential context changes during reads cannot produce qualified evidence.
Explicit PR execution uses this selection through the owned Git/API path below.

## SCM create intents and request authority

DeliveryService owns one PR creation identity per Task/Run/generation. Connector,
idempotency key, lease, target, branches and payload are bound content, so changing
a retry nonce or target cannot escape an unresolved intent. The adapter invokes
beforeCreate after credential resolution and immediately before POST; an atomic
create-if-absent persists PENDING first. A failed preceding GET creates no intent
and can safely retry. A possible POST can only reconcile an existing PR, never
automatically create again when the lookup is empty. Qualified completion is
persisted before delivery evidence and CI reads. Existing legacy delivery evidence
without these newer intents remains replayable under its original contract.

GitHub rechecks authority after credential and response-body awaits, supports
abort signals and keeps fetch exception text out of public diagnostics. Qualified
explicit requests can require a matching repository/head/base/SHA, owned body
marker and HTTPS PR URL. Invalid or changed receipts stay unknown. The provider
reply is fenced again before recording completion/evidence. None of these checks
merge a PR or imply CI/user acceptance.

## Selected SCM execution and partial results

Run reservation persists the reviewed ScmDeliverySelection independently of its
TaskContract, and startup rechecks it before native execution. Delivery fences
include the observed connector credential/config context. Local Git executes
through LocalGitDelivery; remote Git executes through the owning native.run_push.
A composite commit/push response is strictly checked against Run/generation,
branch, target and scoped manifest before it becomes canonical metadata.

DeliveryService receives a selected SCM bridge whose Git evidence is already
confirmed; its provider methods use the exact frozen branch/SHA and PR marker.
The Controller never runs Git for a remote workspace. Existing run-result saves
the confirmed push before the PR request and advances to complete only after
qualified PR evidence. A lost response therefore retains useful push evidence
while its PR creation intent remains unknown. CI pending is preserved and Task
completion remains REVIEW rather than implied acceptance.

Git and Controller HTTP use sequential owned-command cancellation slots. The
HTTP slot starts only after Git's process group has drained, and its abort
settlement does not suppress a Git cleanup failure. CI reads receive the same
abort signal. Completed Run results now explicitly include generation. Legacy
external contracts without scmConnectorId keep their declarative contract and
configured first-SCM behavior. Before a new default-transport Run starts, the
Controller qualifies and freezes that connector, owning origin and base using
the same SCM preflight, then delivers through LocalGitDelivery. It rechecks the
snapshot before native start. Historical default-transport Runs without a frozen
target require review and a new Run; recovery cannot invent a target after an
unrecorded possible write. Default connector Git methods refuse execution outside
the owning path. Explicitly injected GitTransport adapters retain their existing
integration contract; their process ownership is not inferred from default Git
tests.

## Explicit PR console flow

The existing publication composer preserves explicit SCM connector/repository/base
fields in its versioned draft and backup, freezes existing-task delivery fields,
and submits those fields only for PR delivery. Review shows the server's actual
normalized host/target/base; confirmation stays disabled without its selection
snapshot. Capability discovery now advertises PR alongside none and commit.

Task detail reads confirmed results during delivery and recovery states and keeps
Run/phase-scoped query caches. During delivery, bounded read-only polling and the
existing shared event subscription refresh the saved push and current-Run delivery
evidence. Push confirmation, PR receipt and CI evidence are shown independently;
a saved push cannot imply an unpushed commit or an absent/confirmed PR. The frozen
SCM identity filters the selected PR when available, and the same PR link is not
rendered twice. Querying these views invokes no native inference or SCM mutation.

## Create-only availability and later execution qualification

Create-only publication preserves the reviewed declarative task even when owning
Git or SCM evidence is unavailable. Physical scope/private-path policy denials
still reject input; availability failures produce explicit warnings and never
fabricate baseCommit or effectiveDelivery. Committing a create-only review makes
no new device/SCM query. A previously observed baseline stays the reviewed commit
if its ref later moves. Contract READY describes specification completeness,
not proven execution availability. Immediate dispatch still requires all physical
Git, SCM and native checks. When a saved task has no baseline, fresh publication
review supplies a qualified baseCommit to its workspace plan without rewriting
the original TaskContract; that Run executes the approved SHA, not a moving ref.

## Cached standalone usage

AgentAdapter optionally exposes usageObservations for already owned native events;
it cannot perform provider queries or wait for an active turn. Codex implements
this using its existing bounded event cache. The background loop collects eligible
bound standalone sessions independently of UI, rechecks durable identity/account
context after awaits, and records original event time/turn identity. Normalization
validates the native operation ID but omits canonical runId/generation for these
records and rejects canonical-run scope. Terminal cursors avoid permanent rescans;
failed writes remain unknown and eligible for retry. Canonical and standalone
collection share the same validation/dedup/error path. The saved-usage API supports
session filtering and the existing session drawer uses it without provider calls.
Other adapters without qualified usage event protocols remain unknown.

## Publication field diagnostics

Publication errors may add bounded fieldErrors with canonical draft JSON pointers
and required/invalid/too-long codes. Schema normalization whitelists known paths
and never includes validator data or arbitrary parameter keys. Existing error
codes remain for semantic failures; schema field errors use INVALID_DRAFT. The
composer maps these pointers to labelled controls, preserves text, identifies
invalid fields with descriptions and focuses the first issue, opening its
containing details element. Unknown/non-field failures retain the general error.


The existing authenticated Run response includes a RunNativeSessionView derived
only from persisted binding/control/observation facts. TaskDetail shares this
response for read-only status. Observation freshness and control-epoch matching
do not grant mutation authority; native writes remain disabled until the full
runtime/client qualification. Requested selection and last reported native model
remain separate. Native storage references/credential-like text are not projected.


Canonical local-result approval applies only to a completed guarded local
delivery.none Run. It compares the retired generation/lease as immutable identity
and requires current Task/control/context/candidate proof; it never renews that
lease or sends native input. Registered verification runs in the existing managed
source environment with matching before/after content and a retained snapshot.
The proof labels this basis separately from hermetic/native qualification.
Verification SENDING/UNKNOWN receipts do not replay; acceptance and its Task DONE
transition share one database transaction. Historical verification remains
readable; missing/newly changed proof cannot authorize acceptance.


## Internal Devin Local ACP execution

The internal ACP producer admits one managed new Session through canonical
ExecutionSelection. Its explicit allocated identity mode shares the existing
STARTING/invocation/save-before-emit observer state machine and requires durable
binding before native model or prompt writes. Native client updates remain
synchronous; the producer serializes and acknowledges asynchronous persistence
with 500ms individual and aggregate checkpoints, then rechecks authority.

Producer activity tracks actual acquisition, work and original callback settlement
independently of bounded public waits. Runtime composition must consume this raw
status; the Adapter turn wrapper alone cannot establish drain. Unknown disconnect
receipts remain immutable after later settlement. The profile factory now constructs this scoped Adapter through its dedicated
Local ACP backend slot, and Controller now owns its exact scoped runtime. This
composition grants no continuation, history, background-tool or writer-release
qualification.


## Internal Devin Local catalog

The internal scoped Adapter queries only the literal local models inventory and
projects current AccountModelCatalog fields. Its opaque fingerprint binds captured
canonical ownership and physical roots; exact selectors, unknown billing and
unconfirmed access do not imply account qualification. Canonical variants use
native-auto for adaptive and no inferred default, alias or parameter capability.

Both version admission and model output use owned roots and natural-close proof.
The catalog opts into the shared version probe's strict output validation; the
probe retains its existing stdout cap, independently bounds stderr and validates
UTF-8 after drain. The model query has independent 1MiB stream bounds and a whole
query deadline. Cleanup uncertainty wins over usable data, cancellation or timeout.
The explicit Local profile factory supplies this catalog scope to Controller
profile/catalog routes. Actual model-routing trials match exact catalog IDs without
allocating an ACP Session; a selector prefix is unavailable.


## Internal Devin managed runtime

The Controller-side runtime routes one exact managed execution to the real ACP
producer through NativeRuntimeHosts. It captures canonical selection and physical
scope, reserves original callback work before reentry, awaits durable binding/
facts, and checks persisted ownership before readiness and result publication.
Raw producer and runtime acquisition/callback/result work survive public waiter
rejection. Local cleanup preserves original host receipts and appends separately
scoped runtime callback uncertainty; late settlement cannot upgrade cached unknown.

Forced cancellation after producer entry reports unknown until actual outcome
proof is available, including the interval before a binding reply. Result data is
captured before awaited authority and identity checks, and public output uses only
that validated snapshot. This internal runtime exposes no native source, history,
continuation or writer control. Explicit ConfigPlan/factory registration is now
available with explicit Controller runtime composition through the owning factory.

## Explicit Devin Local configuration and factory

ConfigPlan admits Local ACP only with embedded ownership, an explicit managed
backend opt-in and exact executable/dataHome/configHome settings. Structural
validation performs no filesystem or provider work, including disabled reserved
profiles. Cloud Devin v3 retains its separate credential/settings contract.

The Local factory validates ownership before its dedicated backend callback,
captures detached profile/path values, requires the exact supplied backend and
constructs the existing scoped Adapter without starting it. Disabled rows return
before physical or callback work. Both explicit native homes remain private paths
even while disabled; the owning Controller/Runner retains remote-path filtering.

## Devin Local Controller ownership and storage barriers

Enabled Local profiles preflight explicit physical paths and this process's fixed
embedded executor before configuration side effects. Initial configuration precedes
EmbeddedRunner construction, so it uses the configured identity and explicit
withRunner option; later changes also verify the live identity. The dedicated
profile route uses ConfigPlan and an exact field set without CLI discovery.

Admission and binding lookup capture the exact runtime, Adapter and registry
association and reuse the canonical managed Guard. Raw catalog work survives public
CATALOG_CLOSED cancellation, blocks profile changes, and retains sticky uncertainty.
Shutdown collects catalog persistence/drain failures with the existing runtime,
quota and local-review failures, attempts all runtimes, closes HTTP/events and
retains SQLite on unknown cleanup. A receipt retry does not close an owned root twice.
Cold Local metadata qualification uses the existing checked-storage predicate with
an explicit provider wrapper. Local opaque Session IDs have1..512 UTF-16 units,
exclude C0/DEL/unstarted values, and carry no thread/parent fields. Qualification
uses stored agreement only, preserves the prior provider predicates, and performs
no physical/native/account read. Physical enabled admission remains independent;
restart invalidates prior readable evidence and retains manual/unknown ownership.


## Internal Copilot RPC client

The internal Copilot client uses explicit executable/workspace/home and pinned
CLI/protocol qualification with a strict bounded Content-Length ingress wrapper
around the Node JSON-RPC codec. The owned root and original callback lifetimes
remain separate from inherited pipe/background tool/writer release. New bootstrap
persists the original known identity before further model qualification; primitive
resume requires exact local metadata and grants no producer continuation. Read
principals cannot gain mutation via options. Complete outgoing frames recheck the
original authority after backpressure at stdin; unresolved pre-input permission
facts remain sticky through model/idle ordering. This internal client provides
no registered Controller source, account/catalog or native writer qualification.


## Internal Copilot execution producer

CopilotExecutionBackend owns one canonical explicit model and managed reference,
using the internal RPC client and existing physical identity helper. It persists
the allocated global session before input through the shared NativeBindingEvents
STARTING/invocation/save-before-emit path. Native transport updates stay synchronous;
a serial producer queue awaits bounded durable facts before readiness/result. Raw
callback slots and creation admission are reserved before caller reentry, while
public cancellation retains underlying work and immutable unknown cleanup. Native
stop remains unqualified. The internal Adapter grants no catalog, account, source
or writer qualification; Controller runtime/profile registration follows separately.

## Internal Copilot managed runtime

The internal Controller runtime owns one exact managed Copilot producer through
NativeRuntimeHosts, with physical executable/home/workspace identity, creator,
selection and complete binding fences. Its mandatory synchronous assertCurrent
owner checks canonical permission and the expected persisted binding in one
critical section. Only pure local fences follow that decision; an independent
binding lookup cannot authorize input. Diagnostics retains its separate observed
binding lookup and grants no control. The Controller service implements that
joint assertion over real canonical and persisted facts in one store transaction,
after external lease/admission/clock callbacks. It checks current control document
and SQL row, config revision, lease/cancellation, original observer/start reservation,
Adapter workspace/invocation and both complete binding copies. Only direct local
registry/physical fences follow.

Raw acquisition, result and callbacks survive public cancellation; bounded
acknowledgements and aggregate checkpoints preserve immutable unknown receipts.
Result bytes are copied before owner callbacks. Source remains undefined and
native control, continuation, catalog and writer release remain unqualified.
Controller composes this runtime through its exact profile/Adapter association.
Raw acquisition, observer and result work participate in profile replacement and
SQLite shutdown barriers; cached cleanup receipts persist before storage closes,
and a persistence retry does not close the original root twice. Local disconnect
still grants no native tool/writer release. Copilot cannot borrow an aggregate
source if its own runtime is absent. Public model/trial/publication paths reject
unsupported selection before Task/Run/Adapter Session/native allocation.

Copilot ConfigPlan now admits only explicit compatible copilot-rpc on the owning
Embedded Runner with executable/copilotHome and native login. The structural
factory uses a dedicated owning backend slot, captures the minimal profile before
the callback and constructs the existing three-argument Adapter from that capture.
Disabled registrations skip factory work while protecting their configured home.
Console/plan projections omit the five known native directory keys through the
existing private-key/edit boundary; export continues omitting all settings.
Readonly restart admission reuses the shared persisted-agreement certificate with
a narrow Copilot/global binding qualifier. It accepts the actual runtime's opaque
1..512 UTF-16 IDs without control characters, an unstarted prefix, thread or parent;
default client UUID allocation does not narrow supported stored identity. The
certificate performs only database reads, independently of physical admission.
Constructor compatibility and bound reconciliation preserve stored identities,
invalidate old observations and recover nonterminal records as manual unknown/
Runner unavailable. Existing pending SENDING start receipts become UNKNOWN;
no native connection, source, Session, writer or mutation authority is restored.
Enabled live profile construction still has its separate physical preflight.

## Historical profile capability evidence

The existing authenticated profile list/detail adds a pure ProfileInteractionView
beside current probe/resource/action facts. Archived version/scope/evidence can
qualify historical results only; current installation/authentication/capability
and surface status remain unknown. Controller omits private tuple references,
paths, arbitrary instructions and invalid timestamp text. The account capability
panel separates runtime from GUI levels, keeps backend/region/entry filters
independent, and revokes current success on invalidation or failed/mismatched
headers. Existing SSE refreshes both list and selected detail; configuration
changes retain explicit ConfigPlan review/apply.

The exact checked-in archive is copied during the Controller build to its own
collocated dist resource. A descriptor-bounded512KiB+1 loader closes on every
path and does not search checkout docs or cwd. Existing staging carries dist;
source-import tests may have no asset, while the compiled/deployed module owns
its default resource after relocation. The raw archive has no public route.
