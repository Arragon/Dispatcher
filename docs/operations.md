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
and `three-runs` remain `not-runnable` until M4 supplies the Generic Execution
Harness.

Accepted milestone baselines are copied into `benchmarks/baselines/` so they
remain reviewable after local runtime data is cleaned.
