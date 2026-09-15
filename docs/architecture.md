# Agent Dispatcher Architecture

This file is the concise implementation map for the frozen design in
`agent-dispatcher-architecture-roadmap-v2026-09-15.md`. If the two disagree,
the frozen design is authoritative.

## Delivered boundary (M0–M2)

The current system is a single Node.js Controller with an optional in-process
Embedded Runner. It stores durable state in SQLite, serves a static React
Dashboard, and owns canonical configuration and secret references. Remote
Runner authentication, real coding-agent execution, scheduling, Linear,
GitHub, Slack, semantic analysis, and internal-LLM runtime behavior remain
M3+ capabilities. Their package directories reserve the documented ownership
boundaries but contain no implied production behavior.

```text
React Dashboard
      │ HTTP + SSE
      ▼
Fastify Controller ─── ConfigPlan Engine ─── SecretStore
      │                       │
      │ typed events          └── opaque secret:// references only
      ▼
Embedded Runner
      │
      └── versioned Controller–Runner protocol

Controller + ConfigPlan Engine ─── SQLite repositories (WAL)
```

## Package ownership

| Package | Responsibility | Must not own |
| --- | --- | --- |
| `domain` | Six primary entities, four state machines, invariants | I/O, HTTP, SQLite, UI |
| `protocol` | Versioned envelopes, commands, events, responses | Transport or persistence |
| `persistence` | SQLite lifecycle, migrations, repositories, CAS revisions | Business orchestration |
| `runner` | Event bus, Embedded transport, registry and heartbeat | Controller policy |
| `config` | Canonical schema, precedence, plan/apply/verify/rollback, secrets | Web rendering |
| `observability` | Structured logging and recursive redaction | Domain decisions |
| `controller` | Lifecycle composition, HTTP/SSE API, CLI, static assets | Provider-specific logic |
| `web` | Dashboard, settings, setup wizard | Secrets or direct database access |

`adapters`, `llm-runtime`, `semantic`, `scheduler`, `fleet`, `workspace`, and
`integrations` are explicit future seams. Code enters them only when their
roadmap milestone begins.

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

## Configuration and secrets

Effective configuration follows the frozen precedence:

```text
defaults < bootstrap input < canonical database state < explicit runtime override
```

All persisted configuration must pass the versioned JSON Schema and semantic
validation. A proposed change becomes a `ConfigPlan`; sensitive and privileged
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

## Change rules

- Add a state only by changing its domain contract and transition tests.
- Add a protocol message only through the versioned protocol package.
- Add a database shape only through an idempotent migration and upgrade test.
- Never move secret values into configuration, logs, URLs, audit payloads, or
  process arguments.
- Do not implement an M3+ integration inside Controller or Runner to save a
  package boundary.
