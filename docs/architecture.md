# Agent Dispatcher Architecture

This file is the concise implementation map for the frozen design in
`agent-dispatcher-architecture-roadmap-v2026-09-15.md`. If the two disagree,
the frozen design is authoritative.

## Delivered boundary (M0–M6)

The current system is a single Node.js Controller with an optional in-process
Embedded Runner. In addition to the M0–M4 foundation, it owns canonical tasks,
connector bindings, inbox/outbox projection, deterministic routing, TaskContract
compilation, isolated Codex profiles, Linear task ingress/projection, and GitHub
delivery evidence. The M6 vertical path is Linear issue → canonical task →
managed Git worktree → Codex run → verified commit/PR/CI evidence → Linear
projection. Remote Runner authentication, Slack, richer Fleet management, and
the real-time task dashboard remain later capabilities.

```text
React Dashboard
      │ HTTP + SSE
      ▼
Fastify Controller ─── ConfigPlan Engine ─── SecretStore
      │                       │
      │ typed events          └── opaque secret:// references only
      ├── Internal LLM Runtime ─── protocol adapters + safe fallback
      ├── Connector Registry ─── Linear / GitHub / contract fakes
      ├── Canonical Task Service ─── inbox + outbox + bindings
      └── Deterministic Scheduler ─── Codex profile + managed worktree
      │
      ▼
Embedded Runner ─── Adapter Contract ─── Execution Backend
      │                                      │
      ├── versioned Controller–Runner protocol
      └── Workspace Manager + bounded raw logs + Verification Registry

Controller + ConfigPlan + Canonical Tasks ─── SQLite repositories (WAL)
```

## Package ownership

| Package | Responsibility | Must not own |
| --- | --- | --- |
| `domain` | Six primary entities, four state machines, invariants | I/O, HTTP, SQLite, UI |
| `protocol` | Versioned envelopes, commands, events, responses | Transport or persistence |
| `persistence` | SQLite lifecycle, migrations, repositories, CAS revisions | Business orchestration |
| `runner` | Event bus, Embedded transport, registry and heartbeat | Controller policy |
| `llm-runtime` | Protocol normalization, probes, role pools, safe switch, circuit/fallback/failback | Semantic intent or secret persistence |
| `adapters` | Manifest, discovery, normalized session contract, Generic Mock/CLI | Scheduler or database internals |
| `semantic` | Deterministic TaskDraft → TaskContract compilation and `NEEDS_SPEC` classification | Provider payloads or execution |
| `scheduler` | Deterministic eligibility/ranking and Run creation bound to task/contract revisions | Provider implementation or task persistence |
| `integrations` | Connector contracts, Linear, GitHub, canonical task commands, projections, delivery evidence | Controller HTTP or secret persistence |
| `workspace` | Repository registry, isolated Git worktrees, path and cleanup policy | Agent behavior or delivery policy |
| `config` | Canonical schema, precedence, plan/apply/verify/rollback, secrets | Web rendering |
| `observability` | Structured logging and recursive redaction | Domain decisions |
| `controller` | Lifecycle composition, HTTP/SSE API, CLI, static assets | Provider-specific logic |
| `web` | Dashboard, settings, setup wizard | Secrets or direct database access |

`fleet` remains an explicit future seam. Slack is represented only by the
messaging connector contract fake; its production control plane starts at M10.

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

The Agents page discovers Codex CLI installations, creates alias-based
profiles through ConfigPlan, tests authentication explicitly, and shows only
profile aliases and normalized session state. `CODEX_HOME`, account IDs, and
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

Runner processes are lazy, group-cancellable and timeout/idle-timeout aware.
Stdout/stderr become bounded activity summaries while redacted raw output goes
to rotating files with per-file and total budgets. SQLite does not store raw
output. Verification Registry executes only pre-registered file/argv commands
in the run worktree with timeout/output limits; required failures block
delivery while optional failures remain explicit evidence.

## Connector and MVP workflow

Connector definitions advertise versioned capabilities independently from
configured connector instances. External IDs and revisions live in
`ExternalBinding`, while provider-only fields stay in `platformExtensions`.
The version 1.1 protocol envelope adds origin, causation, correlation,
connector, event, and idempotency metadata while continuing to accept v1.0
fixtures. Raw provider payloads are rejected at the protocol boundary.

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

## Change rules

- Add a state only by changing its domain contract and transition tests.
- Add a protocol message only through the versioned protocol package.
- Add a database shape only through an idempotent migration and upgrade test.
- Add a task platform or SCM provider only through the connector contract kit;
  keep raw payloads at the adapter edge.
- Never start an Agent in a client-selected directory. Resolve a configured
  repository and create a Dispatcher-managed worktree first.
- Never move secret values into configuration, logs, URLs, audit payloads, or
  process arguments.
- Do not implement a later provider integration inside Controller or Runner to save a
  package boundary.
