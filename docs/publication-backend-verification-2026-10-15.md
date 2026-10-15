# Publication backend verification — 2026-10-15

## Preview and creation

`c08356c` adds durable preview/create/read receipts. Stage 1 targeted verification: 6 files / 45 tests passed. Preview only reads registered Git state and stores the review; it does not create a worktree or task. Creation reserves receipt, task, contract and publication in one SQLite transaction. Tests cover duplicate/parallel keys, restart replay, rollback, expiry, configuration/base drift, unsafe references/scopes and incomplete tasks.

## Local execution

Stage 2 full gate: `pnpm check`, 44 files / 320 tests passed. The existing dispatch path owns managed worktrees and native startup. Contracts, command descriptions and selection are frozen per Run; publication state participates in startup reservation. Interrupted starts remain unknown rather than relaunching. Local results retain bounded changed paths and the worktree, without remote delivery evidence or automatic acceptance.

Real native evidence (separate from injected backends): Codex CLI `0.162.0-alpha.17.2`, native configuration selection, isolated repository/data directory. Publication `5813750e-04cf-4fec-b96d-71472b3670c8`, Task `13d81f94-a452-48f8-849d-bfb84bbc9341`, Run `cc0eff3f-bf35-4ca3-89f9-58543c5a774d`. The native process created `result.txt` with the exact requested bytes; registered verification passed, Run COMPLETE, Task REVIEW. No SCM connector, commit, push or PR was used. Evidence retained at `/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-native-publication-KXdMD2/evidence.json`.

The first native probe exposed a missing Run provider-session update and stderr warnings overriding successful summaries; regression tests and fixes were added. A later explicit-model probe must verify those fixes against the native client. Native process exit zero alone now fails without a completed JSON turn and provider session identity.

## Supported boundary

Publication currently supports manual local Codex execution with `delivery=none`. Local project IDs are server-derived `local:<repositoryId>`; tasks without a repository use `local:inbox`. Policy routing, remote publication execution, commit/PR publication and other providers fail explicitly. Existing integration ingress/PR delivery remain available through their existing paths. This does not claim arbitrary-path sandboxing by an agent or end-user acceptance of generated code.
