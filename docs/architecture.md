# Agent Dispatcher Architecture

This file is the concise implementation map for the frozen design in
`agent-dispatcher-architecture-roadmap-v2026-09-15.md`. If the two disagree,
the frozen design is authoritative.

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
Controller retains unchanged profile adapters of every provider across ConfigPlan applies,
bound to the profile and owning Runner execution identity. Replacement/removal
rejects pending starts/inputs, active native operations, nonterminal canonical
Runs and unresolved legacy sessions; device labels/capacity do not rebuild handles.
Scale/HA remains
outside this boundary.

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
response. Pre/post-start authority checks stop stale children without reviving
cancelled tasks. SCM preflight requalifies the original target/context, while
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
through user input. Run advancement/dispatch exclusivity and messaging inbox
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
credential values; changes to its native schema fail closed. Catalog revisions
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
and pull requests into canonical session/resource/artifact shapes. The
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

## Usage observations

Native adapters may return normalized versioned observations alongside resource
state. Codex exposes bounded cached events without awaiting an active turn,
with a persisted identity for each native turn. Controller collects these from
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
Run.tokens remains the compatible latest-turn projection. Missing metrics and
unavailable billing baselines stay unknown. Management reads never query a
native provider. The current normalized token emitter is Codex; providers with
no qualified observation emitter do not acquire synthetic usage values.

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
