# Local Operations

## Prerequisites and verification

Use Node.js 24.12 or newer and pnpm 11.19.

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
Task dispatch is `POST /api/tasks/<canonical-task-id>/dispatch` with a
`profileId` and optional registered `repositoryId`/`baseRef`; workspace paths
are never accepted from the client.
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

## macOS launchd prototype

Build first so the CLI path exists, then use:

```bash
pnpm dispatcher -- install
pnpm dispatcher -- status
pnpm dispatcher -- restart
pnpm dispatcher -- logs
pnpm dispatcher -- stop
pnpm dispatcher -- uninstall
```

The prototype installs `dev.dispatcher.controller` in the current user's
`~/Library/LaunchAgents`, writes logs under the selected data directory, and
uses a 30-second restart throttle. It does not install a system daemon.

## Resource benchmark

The M1 acceptance scenarios are:

```bash
pnpm benchmark -- --scenario idle --duration 600
pnpm benchmark -- --scenario dashboard-open --duration 600
```

Reports are written beneath `.dispatcher/benchmarks/` and include environment,
sample count, raw measurements, targets, assessment, and limitations. `one-run`
and `three-runs` use the M4 execution harness and managed worktree boundary.

Accepted milestone baselines are copied into `benchmarks/baselines/` so they
remain reviewable after local runtime data is cleaned.
