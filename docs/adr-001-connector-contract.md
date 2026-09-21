# ADR-001: Canonical connector boundary and compatibility matrix

Status: accepted for M5–M6.

## Decision

Dispatcher owns canonical task and run state. Task platforms, messaging tools,
and source-control hosts are adapters around that state, not alternative domain
models. Each integration separates a versioned `ConnectorDefinition` from one
or more configured `ConnectorInstance` records. Provider identities are stored
as `ExternalBinding` records and raw provider payloads stop at the adapter edge.

Writes follow inbox/outbox semantics. Ingress verifies and normalizes first,
then commits dedupe, canonical revision, bindings, and outgoing projections in
one transaction. Delivery workers retry transient and rate-limited failures,
dead-letter permanent or exhausted failures, and preserve stable idempotency
keys.

Protocol envelope v1.1 adds connector, origin, causation, correlation, external
event, and idempotency metadata. The parser accepts existing v1.0 fixtures for
rolling compatibility but rejects fields that carry raw provider payloads.

## Compatibility matrix

| Boundary | Current implementation | Required capabilities | Compatibility rule |
| --- | --- | --- | --- |
| Task platform contract | Fake, Linear | ingress, read, project, comment, reconcile | Provider-specific fields remain extensions; common fields use explicit ownership and revision checks |
| Messaging contract | Fake | notify | Idempotent send is frozen now; production Slack behavior is deferred to M10 |
| SCM contract | Fake, GitHub | branch, commit, pull request, CI status | Passed verification plus current generation/lease are mandatory before delivery |
| Agent adapter | Generic Mock/CLI, Codex | start, send/resume, status, cancel, result, diagnostics | Profile authentication and sessions are isolated by `CODEX_HOME`; public views expose aliases only |
| Protocol | v1.0 read, v1.1 read/write | typed command/event/response envelope | Unknown versions/types and raw payload fields fail closed |
| Persistence | schema v1/v2 upgrade to v3 | canonical tasks, bindings, inbox/outbox, cursors, dead letters, evidence | Migrations are transactional and preserve pre-M5 config/entity state |

## Consequences

- A new provider must pass the reusable contract kit before Controller wiring.
- Capability negotiation fails explicitly when a required namespace/version is
  absent; unsupported behavior is never guessed from provider identity.
- Connector deletion is blocked while bindings or pending projection records
  still depend on the instance.
- Dual projection keeps one canonical task ID and independent external
  revisions, so platform switching can be rehearsed without changing task
  ownership.
