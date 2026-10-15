# Publication backend verification — 2026-10-15

## Preview and creation

`c08356c` adds durable preview/create/read receipts. Stage 1 targeted verification: 6 files / 45 tests passed. Preview only reads registered Git state and stores the review; it does not create a worktree or task. Creation reserves receipt, task, contract and publication in one SQLite transaction. Tests cover duplicate/parallel keys, restart replay, rollback, expiry, configuration/base drift, unsafe references/scopes and incomplete tasks.

## Local execution

Stage 2 full gate: `pnpm check`, 44 files / 320 tests passed. The existing dispatch path owns managed worktrees and native startup. Contracts, command descriptions and selection are frozen per Run; publication state participates in startup reservation. Interrupted starts remain unknown rather than relaunching. Local results retain bounded changed paths and the worktree, without remote delivery evidence or automatic acceptance.

Real native evidence (separate from injected backends): Codex CLI `0.162.0-alpha.17.2`, native configuration selection, isolated repository/data directory. Publication `5813750e-04cf-4fec-b96d-71472b3670c8`, Task `13d81f94-a452-48f8-849d-bfb84bbc9341`, Run `cc0eff3f-bf35-4ca3-89f9-58543c5a774d`. The native process created `result.txt` with the exact requested bytes; registered verification passed, Run COMPLETE, Task REVIEW. No SCM connector, commit, push or PR was used. Evidence retained at `/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-native-publication-KXdMD2/evidence.json`.

The first native probe exposed a missing Run provider-session update and stderr warnings overriding successful summaries; regression tests and fixes were added. A later explicit-model probe must verify those fixes against the native client. Native process exit zero alone now fails without a completed JSON turn and provider session identity.

## Supported boundary

Publication currently supports manual local Codex execution with `delivery=none`. Local project IDs are server-derived `local:<repositoryId>`; tasks without a repository use `local:inbox`. Policy routing, remote publication execution, commit/PR publication and other providers fail explicitly. Existing integration ingress/PR delivery remain available through their existing paths. This does not claim arbitrary-path sandboxing by an agent or end-user acceptance of generated code.

## Native model catalogs and independent review

Codex `account/read` and paginated `model/list` are queried through a bounded,
read-only RPC client. Every native query process is reaped before return. The
installed CLI generated protocol schemas in `/tmp/dispatcher-codex-protocol`;
`ModelListParams`, `GetAccountParams` and `GetAccountResponse` match the used
methods. Seven native models and model-specific reasoning effort values were
observed. All entries remain unconfirmed access with unknown billing; no API
price or account entitlement was fabricated. Official references:
[app-server protocol](https://learn.chatgpt.com/docs/app-server) and
[native catalog versus entitlement](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

Real explicit selection: `gpt-6-luna`, reasoning `low`; publication
`9a6cc6fe-fa0e-4dd8-9936-ec25cc06ef23`, Task
`a7c92f1e-3b23-4874-adbd-5fe2ab390c69`, Run
`c2fa4699-598e-48b0-8196-43e6bb7a9008`, native session
`01a141f1-bd19-74d3-b077-94b3e1866b4c`. Exact file bytes and registered
verification passed; Run COMPLETE and Task REVIEW. Retained evidence:
`/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-native-explicit-sLUieO/evidence.json`.

Browser verification used the real isolated Controller at `http://localhost:4176`:
account/repository native catalog, supported effort choices, unconfirmed access,
unknown pricing, preview/confirm/create, then reload/read of the same canonical
Task `ff57b0c3-2912-4b2f-b3d2-237988d6141c`. Browser console reported no errors.
Screenshots are saved as `native-model-catalog.jpg` and
`publication-receipt.jpg` in the current Codex visualizations directory.

A fresh-context independent reviewer identified five issues. Regression tests
were observed failing before fixes: repository override/current scope changes,
create-only model-intent loss, detached ACTIVE restart, source/base-worktree
symlink differences and definitive authentication failure on native defaults.
All were corrected. Additional tests cover native RPC process cleanup, strict
uncoerced DTO inputs, concurrent per-session frozen selection, late account
responses and verification after repository registration removal. Controlled
reroute of publication Runs requires a fresh review and is explicitly refused
by the legacy reroute command; automatic physical-session reattachment is not
claimed.

## Final gate and recovery guard

Final `pnpm check`: **46 files / 333 tests passed**, including build, typecheck,
lint and architectural boundaries. `git diff --check` passed. Logs:
`/tmp/dispatcher-final-check.log`.

After the independent-review fixes, another real `gpt-6-luna / low` publication
completed from preflight to retained local REVIEW: publication
`467f4155-00d1-4851-bc55-b2aceb10e2d1`, Task
`675aae5a-7d40-45a5-adbe-e9013a3a64a1`, Run
`e101ed2b-dc9c-46e5-8a6d-ad226e7969a0`, provider session
`01a141f9-b3f6-7063-9027-fbb923fa8455`. Exact file verification passed. Evidence:
`/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-native-explicit-XuYEHm/evidence.json`.

Stable browser draft IDs plus atomic `publication-draft` bindings coalesce
identical previews across tabs. An uncertain commit persists its original key
and prevents a replacement preview until the original receipt or a durable
rejection is read. A confirmed created task may be followed by an explicit new
draft. Final-build browser reload and Controller restart still recovered Task
`ff57b0c3-2912-4b2f-b3d2-237988d6141c`; actual execution details display the
requested model separately from runtime model confirmation. Final screenshots:
`publication-receipt-final.jpg` and `native-execution-final.jpg`.

Official quota at completed checkpoints: 94% after preview/create, 93% after
local execution. A later safety check showed 89% remaining; no reset was used.
The final checkpoint quota is reported in the completion response.
