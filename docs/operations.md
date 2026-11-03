# Local Operations

## Prerequisites and verification

Use Node.js 24.22.1 or newer and pnpm 11.19.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` runs the build/project-reference typecheck, ESLint, architecture
boundary check, and all Vitest suites. A focused package test can be run with:

```bash
pnpm exec vitest run packages/config/test/config.test.ts
```

## Start locally

```bash
pnpm dispatcher -- serve --with-runner
```

The Controller listens on `127.0.0.1:8347`; open that address for the
Dashboard. State defaults to `.dispatcher/`. Set `DISPATCHER_DATA_DIR` or pass
`--data-dir <path>` to isolate it.

CLI `serve` and offline `config` require exclusive ownership of
the canonical data directory before opening its business database. A second
process fails with `DATA_DIRECTORY_IN_USE`; use the running Controller's health,
diagnostics and ConfigPlan APIs while it owns the directory. The separate
`.controller-instance.sqlite` file contains no user records. Do not remove it
while a process may own the directory. A crash releases the OS lock; successful
shutdown releases it after Controller cleanup. This protection requires the new
CLI and does not make an older binary compatible with a newer schema.

`doctor --data-dir /absolute/data` is read-only and can inspect an active
Controller's directory without writer ownership. It checks a private temporary
copy of stable main/WAL files, each capped at 256 MiB, and removes only that
owned copy on completion. Source changes, rollback journals, unsupported schemas
or archive/restore barriers require attention; retry after settling the owning
service. It never initializes a missing directory, upgrades a schema, resolves
restoration or starts a provider. Exit 0 means the reported inspection needs no
listed attention; `executionReadiness` remains `not-assessed`. Reports contain
aggregate counts rather than records, transcripts or credentials. The old
configurationRevision read was removed because it initialized configuration.

Useful probes:

```bash
curl http://127.0.0.1:8347/health
curl http://127.0.0.1:8347/ready
pnpm dispatcher -- doctor
```

## Configuration

```bash
pnpm dispatcher -- config export
pnpm dispatcher -- config validate ./config.json
pnpm dispatcher -- config import ./config.json
pnpm dispatcher -- config import ./config.json --apply
pnpm dispatcher -- config import ./config.json --apply --confirm
```

Import without `--apply` creates a preview plan. Sensitive and privileged
changes fail until `--confirm` is present. Exports are redacted and contain no
secret values. Applying a config that enables an integration also fails until
its referenced SecretStore item has been created through the Dashboard secret
input.

M6 dispatch also requires a repository entry with a stable ID, absolute local
Git root, default base ref, optional relative scope paths, and registered
verification commands. Each command has a stable ID, fixed file/argv, timeout,
output budget, and required/optional policy. Linear issue `## Verification`
items name those IDs; request payloads cannot supply executable commands. The
Linear connector's `settings.repository` must name the repository ID. Codex
profiles require an isolated `settings.codexHome`; connector/profile settings
and every credential change still go through ConfigPlan.

Useful M6 API probes after configuration:

```bash
curl http://127.0.0.1:8347/api/connectors
curl http://127.0.0.1:8347/api/tasks
curl http://127.0.0.1:8347/api/connectors/dead-letters
curl -X POST http://127.0.0.1:8347/api/connectors/projections/drain
curl -X POST http://127.0.0.1:8347/api/runs/<run-id>/advance
```

Webhook signatures must be generated from the exact request bytes and sent to
`POST /api/connectors/<linear-instance-id>/webhook` in `linear-signature`.
Task dispatch is `POST /api/tasks/<canonical-task-id>/dispatch` with an optional
`profileId`, registered `repositoryId`/`baseRef`, and optional
`capabilities`/`runnerTags`/`providerIds`. Without a profile ID the scheduler
selects deterministically from every configured profile; workspace paths are
never accepted from the client.
`POST /api/runs/<run-id>/advance` is idempotent. It observes the Codex session,
runs the contract's registered verification commands, and performs fenced
GitHub commit/PR/CI delivery. A retry resumes from the persisted run phase, so a
temporary GitHub outage cannot repeat completed verification or create another
pull request.
If advancement returns `202` with `WAITING_USER`, send the response through
`POST /api/agents/profiles/<profile-id>/sessions/<session-id>/input`; the same
Codex provider session resumes and the Run/task return to active execution.
Run `POST /api/connectors/<id>/reconcile` to advance the durable connector
cursor. Permanent projection failures appear in the dead-letter endpoint;
outbox failures can be explicitly retried through
`POST /api/connectors/dead-letters/<id>/retry` after the remote cause is fixed.

macOS uses Login Keychain. On systems without the macOS backend, set a strong
master key before starting:

```bash
export DISPATCHER_SECRET_STORE_KEY='<at-least-16-characters>'
```

## RHIZA service ingress

The versioned ingress is `/api/integrations/rhiza/v1`; see
[`rhiza-ingress-v1.md`](rhiza-ingress-v1.md) for the wire contract and scopes.
It is disabled by default. Configure `rhizaIngress` through the existing
ConfigPlan flow, after creating each referenced `secret://rhiza/<client-id>`
credential in SecretStore. Each grant binds its authority, scopes, repositories,
Profiles and expiry. Owner tokens and Dashboard sessions cannot act as a client.

Consumers pin protocol1.1/artifact1.1.0 and its manifest digest. Query the original
semantic request key after a lost response; never submit a replacement key to
retry a physical effect. Production model-evidence capabilities remain empty:
the installed ingress exposes authenticated read/control paths, while new
submission and verified-model negotiation remain unavailable until qualified.
The conformance client uses synthetic fixtures, not a real RHIZA/provider Gate.

This source appends RHIZA migrations12–18/writer8–14 while retaining1–11. Older
schema11/writer7 releases cannot be treated as rollback writers after migration;
the incompatible original private16 catalog is refused. Use the existing backup
and isolated restore preparation flow before any separately authorized activation.

## Prepare a fixed Controller release

Use a committed clean integration checkout. Staging preserves dirty work by
refusing to proceed; it does not stash/reset it or overwrite an existing target.

```bash
pnpm stage:controller --out /absolute/persistent/releases/unique-candidate
pnpm stage:controller verify /absolute/persistent/releases/unique-candidate
```

The tool builds, copies tracked source and compiled output into a private
workspace, then uses the existing pnpm offline deployment with injected workspace
dependencies. Source data, registry credential files and node_modules caches are
excluded. It detaches hardlinks and checks a moved runtime through HTML/assets,
an authenticated API and a real PTY fixture, then writes release.json with source
SHA, exact Node/platform, schema/writer metadata and content hashes. This is an
isolated package smoke; no real provider, browser, service or recovery Gate is
implied. A failed target retains its preparing/failure marker for inspection.
Runtime dependency scripts/licenses remain in the pnpm package boundary.
New manifests use version 2 with runtime admission version 1, measured by the
packaged CLI runtime-contract command. Version-1 artifacts remain inspectable
but cannot qualify for a new service binding. Installation pins source SHA,
release directory and exact Node/CLI; start/restart recheck the inventory. The
service checks its environment pin before data-directory ownership or database
initialization. Status reports verified/unverified/legacy metadata; stop and
log inspection remain available when artifact integrity fails.

## macOS Controller background service

Build and stage the complete workspace and dependencies at a persistent release
path first. Service installation does not copy a worktree into a release. It
rejects managed worktree or temporary Node/CLI paths. Select its absolute CLI
path explicitly when invoking installation from a development checkout:

```bash
pnpm dispatcher -- install --cli-path /absolute/persistent/release/runtime/dist/cli.js --data-dir /absolute/persistent/data
pnpm dispatcher -- status
pnpm dispatcher -- restart
pnpm dispatcher -- logs
pnpm dispatcher -- stop
pnpm dispatcher -- uninstall
```

The CLI installs `dev.dispatcher.controller` in the current user's
`~/Library/LaunchAgents`, writes logs under the selected data directory, and
uses a 30-second abnormal-exit restart throttle with a 60-second launchd shutdown
allowance. Paths and working directory stay fixed in its plist; status/logs read
that definition even when invoked from another directory. Status returns only
selected metadata and does not dump launchctl environment values. Account
executables outside its fixed PATH need their registered absolute executable.

`start` enables the service and uses bootstrap or kickstart without `-k`.
`stop` disables it across logins, boots it out, waits for the reported Controller
PID and checks data-directory ownership. `restart` must finish that stop before
enabling/start; stop uncertainty prevents restart/uninstall. `uninstall` retains
all user data and removes the plist only after confirmed Controller stop.
Changing installed runtime/data paths returns `SERVICE_UPGRADE_REQUIRED` and
preserves the existing definition. Offline preparation is available below;
offline definition switching/reconciliation are available; rollback after database
changes, data restore activation and real host qualification are still pending.
Failed bootstrap keeps the definition and error for inspection.
Parsed definitions carry their captured byte hash. A symlink, shared/writable
unsafe file or observed change before bootstrap/kickstart fails closed with
SERVICE_DEFINITION_INVALID/CHANGED. Inspect and re-read the installed definition;
do not overwrite it to bypass review. Native XML/binary parsing uses the captured
bounded bytes, not a second open of an asynchronously changed pathname.
These local lifecycle tests do not establish real login, sleep, Keychain, native
Agent stop or A acceptance. No system daemon is installed.

After stopping the installed service, review an offline preparation plan:

```bash
pnpm dispatcher -- prepare-upgrade --release-dir /absolute/next-release --backup-out /absolute/new-backup
pnpm dispatcher -- prepare-upgrade --release-dir /absolute/next-release --backup-out /absolute/new-backup --execute --confirm --plan-id <reviewed-id>
```

Both releases must already be qualified with the same schema/writer protocol as
the current database. The parent backup directory must exist; the new backup
must be outside data/release trees. Changed data/definitions invalidate the plan.
Loaded services, active/uncertain Runs, pending effects, native bindings and
unqualified legacy/custom definitions require resolution first. No migration is
attempted. Preparation validates the DB archive by restoring only a new private
copy with both startup barriers, then stores previous.plist, candidate.plist and
service-upgrade.json. It preserves the installed definition and data bytes, and
starts nothing. Do not copy archive databases or remove barriers to activate a
rollback. Credentials/native homes remain outside this backup. An incomplete
service-upgrade-preparing.json retains the failed attempt for inspection; do not
reuse/overwrite that directory. Prepared artifacts are inputs to the following
reviewed offline switch and do not complete the upgrade/rollback Gate.

```bash
pnpm dispatcher -- apply-upgrade --record /absolute/new-backup/service-upgrade.json --plan-id <reviewed-id> --confirm
pnpm dispatcher -- rollback-upgrade --record /absolute/new-backup/service-upgrade.json --plan-id <reviewed-id> --confirm
pnpm dispatcher -- reconcile-upgrade --record /absolute/new-backup/service-upgrade.json --plan-id <reviewed-id> --confirm
```

Apply disables the unloaded service, holds data ownership, installs a deployment
marker through the existing database startup barrier, journals the operation and
switches only the exact candidate definition. It leaves service activation
explicit. An unconfirmed switch preserves its displaced file and barrier; only
reconcile-upgrade may finish that known local install or restore the exact captured
old definition after verifying unchanged data, artifacts and unloaded supervision.
It will not overwrite a foreign definition or erase an unrelated restore marker.
These commands never restore user data, start/replay a native session, or clear an
unknown external effect. CLI service mutations share a separate OS operation lock;
status/log reads remain available. After database changes, rollback requires a
matching backup and separately qualified recovery. Do not remove barriers manually.

Rollback uses that same reviewed plan only after a confirmed switch and while
the database main/WAL bytes still match preparation. It verifies both pinned
releases and disabled/unloaded supervision, journals a separate reverse transaction,
retains all previous transaction locations and restores only the old definition.
It leaves service activation explicit. A failed reverse install keeps the same
writer barrier; reconciliation can restore its pre-rollback candidate or confirm
the old definition already installed. Original version-one forward journals without
a direction field remain reconcilable. Changed data requires backup recovery,
not this definition-only command. A rolled-back plan cannot be reapplied; prepare
and review a new plan. This is not changed-data recovery or real host acceptance.

New service definitions bind `--log-dir <logs>/runtime`. Controller structured
logs retain at most four 256 KiB files within a 1 MiB owned-stream budget. Unknown
raw entries and oversized records become metadata markers, and unrelated *.log
files are preserved. `logs --lines 100` reads at most 64 KiB, displays complete
structured records after redaction, and rejects symlinks/nonregular files.
New definitions route raw stdout/stderr, including pre-import errors, to
`/dev/null`: only the bounded redacted structured stream is retained. `logs
--stderr` reports RAW_STDIO_NOT_RETAINED; before structured logging starts, logs
reports LOG_NOT_CREATED. Use status lastExitCode, doctor and release verification
to diagnose early failure. Existing six/eight-argument file-stream definitions
remain inspectable with bounded redacted tail; replacing them requires upgrade.
Native Runner stream retention and real host drills retain their own Gates.

## Offline database backup and restore preparation

Stop the owning Controller before backup. These commands capture only SQLite
data, with private archive permissions and checksum/inventory verification;
Keychain/encrypted SecretStore files and provider native homes are separate.

```bash
pnpm dispatcher -- backup --data-dir /absolute/data --out /absolute/new-backup-bundle
pnpm dispatcher -- restore --bundle /absolute/new-backup-bundle --target-data-dir /absolute/new-restored-data
pnpm dispatcher -- restore --bundle /absolute/new-backup-bundle --target-data-dir /absolute/new-restored-data --execute --confirm
```

Backup holds the data-directory lock and inspects a stable private main/WAL copy,
each capped at 2 GiB, preserving source bytes and schema. Restore defaults to
preview, rejects an existing target, and execution preserves both filesystem and
database reconciliation barriers. Only its new staging copy may upgrade schema.
It never downgrades or removes source triggers. A target won by another owner is
left intact. `applied: true` means a blocked copy was prepared; it cannot start
Controller yet. Qualified reconciliation/activation, native/credential recovery
and the real macOS recovery drill remain pending. Do not remove barriers manually.

## Inspect orphan workspaces and processes

Run the read-only report against an existing data directory:

```bash
pnpm dispatcher -- orphans --data-dir /absolute/data
```

The CLI inspects a stable private database copy and reports bounded ordinary and
retained worktrees plus saved process claims. It cannot execute maintenance;
saved PIDs remain unverified. A missing inventory root is left absent.

An authenticated owner can use `GET /api/maintenance/orphans` for the current
Controller inventory. `POST /api/maintenance/processes/:processId/stop` and
`POST /api/maintenance/workspaces/:runId/cleanup` default to preview with `{}`.
Execution requires `{"execute":true,"confirmed":true}`. The process id must name
a current handle owned by that Controller, not a saved operating-system PID.
Canonical/native references, unresolved mappings or tools, replaced directories
and restore barriers prevent the operation. Unknown stop outcomes remain pending;
retirement moves a qualified independent worktree intact into `.retained` and
returns its retained path. These source trees have no automatic deletion policy.

## Native Remote Runner

Build the Runner CLI, then inspect the platform-specific plan before applying
it. The credential reference must resolve from macOS Keychain, Windows
Credential Manager, or Linux Secret Service; the token itself is never written
to the service definition.

```bash
pnpm --filter @dispatcher/runner build
node packages/runner/dist/cli.js doctor \
  --controller wss://controller.example/runner \
  --credential-ref secret://runner/dispatcher/build-01
node packages/runner/dist/cli.js install --dry-run \
  --runner-id build-01 \
  --controller wss://controller.example/runner \
  --credential-ref secret://runner/dispatcher/build-01
```

After reviewing the plan, remove `--dry-run`. The same commands are available
on macOS, Windows, and Linux:

```text
agent-runner enroll | install | upgrade | start | stop | restart | status | doctor | logs | uninstall
```

macOS uses a per-user launchd agent, Linux a per-user systemd unit, and Windows
the Service Control Manager. Non-loopback Controller listeners require TLS.
Runner capabilities include OS, architecture, service manager, PTY backend,
credential store, process-tree control, and resource statistics. A draining
Runner rejects new Runs while preserving its existing sessions.

Enrollment tokens are one-time and expire after ten minutes by default. Save a
token to a mode-0600 file, run `agent-runner enroll --enrollment-file <path>`,
and the CLI stores the resulting credential in the native credential store,
persists only runner identity/reference metadata, and removes the consumed
token file. `upgrade` rewrites the service definition without changing
`runnerId`; keep the previous package available until `doctor` and `status`
pass so rollback is the same service rewrite against the prior CLI path.

## M14 agent profiles

Open **Agents & Profiles** or use the schema-driven endpoints:

```text
GET  /api/adapters/manifests
GET  /api/adapters/compatibility
POST /api/agents/<adapter-id>/discover
POST /api/agents/<adapter-id>/profiles
POST /api/agents/profiles/<profile-id>/test
```

Supported adapter IDs are `cursor`, `devin`, `kiro`,
`workbuddy-codebuddy`, and `generic-cli` (plus the existing `codex` and
`qoder`). Store provider credentials first through the secure secret API and
put only a provider-scoped reference such as `secret://devin/main` in the
profile. Profiles are persisted through ConfigPlan; the UI never reads secret
values back.

Cursor discovery runs `cursor-agent --version` and `cursor-agent status`;
Kiro discovery runs `kiro-cli --version` and the structured model-list probe.
Their business runs use official headless structured-output modes. Devin uses
an organization ID and the v3 API. WorkBuddy/CodeBuddy requires explicit
health/start/status/input/cancel paths because no vendor endpoint is assumed.
Generic CLI requires a fixed executable and argv array; placeholders are only
accepted as complete argv values.

Treat discovery success, contract tests, and real provider execution as three
separate gates. Without an installed CLI, Devin account, or reachable local
service, keep the corresponding external acceptance item open and record the
missing host/account evidence.

## Resource benchmark

The M1 acceptance scenarios are:

```bash
pnpm benchmark -- --scenario idle --duration 600 --release-dir /absolute/staged-release
pnpm benchmark -- --scenario dashboard-open --duration 600 --release-dir /absolute/staged-release
```

Reports are written beneath `.dispatcher/benchmarks/` and include environment,
sample count, raw measurements, targets, assessment, and limitations. `one-run`
and `three-runs` remain not-runnable until this harness configures real Agent load.
Metadata/log-only workloads remain informational.

The harness binds the release manifest/source/Node/CLI before spawning, verifies
the full runtime after measurement and records its own source/script hashes
separately. Unpackaged development remains informational even after 600 seconds;
other build output may change while it runs. CPU/RSS assessment covers only the
named process/window and leaves history, native-process, safety and soak Gates
open.

Accepted milestone baselines are copied into `benchmarks/baselines/` so they
remain reviewable after local runtime data is cleaned.

Two additional controlled workloads use the same fixed release:

```bash
pnpm benchmark -- --scenario history --history-runs 10000 --duration 5 --release-dir /absolute/staged-release
node benchmarks/native-interactions.mjs --release-dir /absolute/staged-release
```

History measures synthetic metadata pagination through the Controller API. The
native component harness uses owned Node fixtures with the packaged transport
and Runner to check host sharing, queued input, cancellation, retained output and
bounded history reconstruction. It records its script hash and rechecks package
integrity; failed runs retain temporary evidence. These workloads do not qualify
browser rendering, real provider throughput, native writer release or a soak Gate.


## Check native capabilities before publication

The publication page describes compatible execution limits. Select an account and
expand “原生交互能力与限制” to read its backend/region capability evidence; a
server-reviewed backend narrows the view. This is a read-only account query.
Pending, failed or mismatched configuration reads leave current capabilities
unconfirmed; “重新读取能力说明” retries without changing the draft.
Use “原生交互要求” to inherit account policy, choose compatible execution, require
native history/handoff, or require a specific native interface. Changing this choice
clears the previous model review and keeps the task body. A blocked preview preserves
the selected requirement and disables confirmation; it never downgrades it silently. Compatible intent can be
saved on a create-only inbox/NEEDS_SPEC Task; actual execution is reviewed when
dispatching. Strict requests still need the required qualification.

Strict requests require an explicit `nativeInteraction: { enabled: true }` feature
policy applied through a confirmed privileged ConfigPlan, plus current qualified
backend/context evidence. The flag alone does not qualify a native session or GUI.
Set it to false to prevent new strict dispatch; existing human-control locks and
frozen continuation requirements still apply. Compatible profile policy cannot carry
a GUI surface. Strict profile defaults require the explicit feature configuration,
and existing provider registration restrictions remain in force.

The optional requirement is frozen with the reviewed execution choice and protected
by schema19/writer15. A Run carrying it, or a reroute target with a strict native policy,
requires a new publication review before changing accounts; the legacy reroute command preserves the original execution and
returns `INTERACTION_REVIEW_REQUIRED`. Remote Runner requirement enforcement and real native/GUI
qualification remain unavailable until separately proven.

## Local result review

For a completed guarded local delivery.none Run, Task details shows the saved
result and current review separately. Run the registered required verification
against the current candidate, inspect the retained content and verification
record, then explicitly confirm and accept. The Task transitions REVIEW to DONE
only with matching current candidate/Task/generation/retired lease/control proof.
Native input is never sent by this action. Verification runs in the existing
managed source environment and records matching before/after content plus a
retained snapshot; this is not a hermetic build claim.

Browser refresh restores an uncertain action with its original key. Read status
first; retrying uses the same body/key. A lost SENDING/UNKNOWN is never replayed
as a fresh execution. Stop verification acts only on the Controller's captured
owned process. Unconfirmed cleanup retains ownership/data for reconciliation.
Old results without new proof remain readable and need explicit revalidation;
advanced native/remote Runs retain their separate qualification Gates.

## Validate retained native roundtrip evidence

After building observability, run the read-only consistency checker against a
saved record, separately captured current tuple and the local artifact directory:

```bash
node scripts/validate-native-evidence.mjs --record /absolute/record.json --current-tuple /absolute/current-tuple.json --artifact-root /absolute/artifacts
```

The version1 schema is `docs/evidence/native-sessions/roundtrip.schema.json`.
Checks include exact Task/Run/generation/session/thread/execution/model identity,
AUTOMATED→HUMAN→AUTOMATED epochs, scoped account/client/version, mandatory GUI
scenarios, owned-writer release/readback traces, returned verification commit,
bounded regular artifact bytes/hash, and private metadata redaction. A tuple
drift requires re-verification; fixture provenance cannot become runtime/UI proof.

CLI exit0 means consistency and supplied-file checks passed. It cannot supply
trusted review or enable a capability: `releaseEligible` remains false without
out-of-record reviewed-record authority, and no CLI option grants that authority.
Historical records and synthetic validator tests are not current provider/account
qualification. This tool changes no Controller state, configuration or credentials.


Dashboard event streams stop at HTTP write backpressure, unsubscribe and end the
accepted buffer; an undrained owned connection is destroyed after at most2s.
Clients reconnect through the existing event cursor/replay/reset contract. This
bounds connection drain during service stop and prevents accumulating future
frames for a slow client. Controlled HTTP tests do not replace real burst/slow-
reader memory measurement or soak evidence.


Task detail uses GET /api/tasks/:id?runsOffset=0&runsLimit=20 for Run history.
The optional page mode returns runPage (offset/limit/total/nextOffset/hasActiveRun)
and the separately scoped currentRun. Values must be nonnegative safe integer
offsets and page sizes1..100; absent nextOffset means the counted history ended.
Rows follow saved-time descending order with an ID tie breaker. Offset pages are
live reads and can move as Runs update; they are not immutable snapshots or write
permission. The default unpaged resource remains its existing contract. This mode
bounds Run decoding, not Task delivery evidence or global Fleet queries.


Synthetic history API measurements use the standard entry:

```bash
pnpm benchmark -- --scenario history --history-runs 1000 --duration 5
pnpm benchmark -- --scenario history --history-runs 10000 --duration 5 --release-dir /absolute/qualified-release
```

The harness imports the selected runtime's persistence to create only a new owned
fixture, and verifies every paginated identity before recording page timing/bytes.
Old artifacts without paged Task reads fail evidence validation. history remains
informational: the workload covers Controller API metadata, not browser rendering,
native/provider execution or all P4 metrics. CPU sampling includes active queries;
it is not an idle-budget assertion. Reports capture loaded runtime/harness/helper
identity and cleanup disposition. Existing user directories are never seeded.
