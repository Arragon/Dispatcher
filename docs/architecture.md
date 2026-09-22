# Agent Dispatcher Architecture

This file is the concise implementation map for the frozen design in
`agent-dispatcher-architecture-roadmap-v2026-09-15.md`. If the two disagree,
the frozen design is authoritative.

## Delivered boundary (M0–M13 implementation)

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
for launchd, Windows Service, systemd, Unix PTY, and ConPTY. Scale/HA remains
outside this boundary.

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

The Internal LLM page manages endpoints, profiles, ordered fallback pools and
role switches. Configuration commits through `ConfigPlan`; credential values
still bypass form state and enter SecretStore directly. Connection tests are
explicit—there is no background health polling. Adapter manifests are exposed
read-only to the Agents page, where their JSON Schema and UI Schema generate
the base configuration form.

The Agents page discovers Codex and Qoder CLI installations, creates alias-based
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
