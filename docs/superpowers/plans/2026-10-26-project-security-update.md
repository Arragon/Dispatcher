# Project runtime and dependency security update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the observed dependency advisories and Node builtin Undici version through a scoped project update, preserving all existing execution, packaging and safety behavior.

**Architecture:** Keep the existing Node24/pnpm11/Fastify/Vite/Vitest stack. Change exact direct pins, resolve compatible existing transitive dependencies, and align the project and CI Node version. No application API, database, provider capability or deployment activation changes.

**Tech Stack:** Node24.22.1, pnpm11.19.0, Fastify5.12.6, Vite8.3.3, Vitest5.0.3.

**Spec:** `dispatcher-candidate-convergence-architecture-plan.md` CV-13 steps3/4 and original failure/acceptance requirements; root AGENTS verification/license/high-risk rules; current read-only preparation `/tmp/dispatcher-cv13-refresh-20261026/preparation.json` and toolchain-boundaries.md. This task is a CV13 security increment; it does not close CV11/12 prerequisites or the entire CV13/CV14/formal Gates.

## Global Constraints

- Domain/protocol remain free of Web, persistence, transport and provider SDK imports. Configuration goes through ConfigPlan; secrets remain opaque `secret://` references and must never be returned by APIs/exports.
- Preserve the protected primary checkout and all prior captured evidence. Use only the attached convergence worktree; no global/default Node or pnpm change, real provider/account/native session/service activation, push or merge.
- Keep `packageManager` and mise/CI pnpm at11.19.0. Its compiled executable reports bundled Node26.0.0, a separate runtime: changing mise Node does not qualify the manager's internal dependencies.
- Set mise and CI Node to24.22.1 and supported engine/documentation minimum to24.22.1. Verify actual installed executable, builtin Undici7.30.1, OpenSSL3.5.9 and package compatibility; the official release index is preparation, not installation proof.
- Direct updates are only root Vitest5.0.0→5.0.3, Controller Fastify5.12.4→5.12.6 and Web Vite8.3.0→8.3.3. Align Vitest's actual mocker/spy family with its declared dependencies. No new root leaf dependency or blanket update.
- Required resolved repairs: fast-uri3.1.9 and4.2.3 (preserve actual3/4 parent ranges), brace-expansion5.0.12, source-map-js1.2.2 and undici8.12.2. Preserve existing build allowlist and supply-chain/lifecycle/integrity controls; no severity downgrade, audit suppression, unsupported flag or cross-major leaf override.
- Use three narrowly scoped pnpm overrides only for existing supported parent contracts: `css-tree@3.2.1>source-map-js: 1.2.2`, `postcss@8.5.28>source-map-js: 1.2.2`, `jsdom@30.0.1>undici: 8.12.2`. Actual pnpm11.19 targeted/exact/dev leaf updates left those two names unchanged in isolated trials. Their verified parent ranges accept these versions. The override is a real current security requirement, not hypothetical compatibility.
- Keep tests, workers, timeouts, assertion purposes, default gate and release admission checks unchanged. Existing test coverage verifies the dependency/runtime behavior; add a regression only if an actual implementation bug or necessary compatibility adaptation is discovered. Report conflict before expanding application scope.
- Freeze source/report/tooling/external inputs throughout each command. Retain commands, UTC/wall/exit/log digests, source and tool identities, exact lock deltas, registry/license/tarball/installed/deployed evidence, original temporary output payloads before cleanup, and any failure. No reconstructed first-run evidence.

## Review Focus

- mise, engine/docs and CI must name the same qualified Node minimum; pnpm's bundled runtime must remain accurately distinguished.
- Targeted resolution must preserve real3/4 fast-uri compatibility and explain every new/removed package, including Vitest's changed why-is-node-running major and Vite's Rolldown/platform binding patches.
- Approved native lifecycle scripts and actual packaged license/NOTICE attribution must survive frozen install and isolated production deployment, without widening allowBuilds or dropping obligations.
- The Node builtin fetch/SQLite/process changes must pass the unchanged full gate, including final admission, timeout, cleanup and recovery behavior; dependency metadata alone cannot establish this.
- A clean resolved audit cannot establish exploit reachability, real-account/provider/writer/service/release acceptance, or Node security facts for the separate pnpm binary.

---

### Task 1: Qualify the repaired project stack

**Files:**
- Modify: `package.json`, `apps/controller/package.json`, `apps/web/package.json` (only the specified pins/engine).
- Modify: `pnpm-lock.yaml`, `pnpm-workspace.yaml` (targeted resolved graph and three exact existing-parent overrides).
- Modify: `mise.toml`, `.github/workflows/ci.yml` (only Node pin; preserve every workflow step and pnpm pin).
- Modify: `README.md`, `docs/operations.md`, `docs/know-how.md` (existing runtime floor statements only).
- Modify: `docs/dependencies.md` (replace stale audit claim with exact updated versions/license/security scope and retained baseline).
- Test: existing full `pnpm check`, existing release/staging and HTTP/PTY/runtime coverage; no new test file anticipated.

**Interfaces:**
- Consumes current workspace exports, CLI/runtime-contract and existing isolated `pnpm deploy --prod`/release staging semantics; no signature changes.
- Produces an exact updated project toolchain/lock graph with unchanged application contracts, meaningful command evidence and qualified attribution for downstream CV13/CV14 work.

- [ ] **Step1: Confirm baseline and repair inputs before mutation.** Read relevant architecture/know-how, nested AGENTS, manifests, current source HEAD and exact primary protection. Use retained audit28 and Node24.21.0/builtin7.29.1 observations as the identified failing security condition; do not introduce a deliberately vulnerable runtime/exploit or redundant test. Verify exact registry candidates, parent ranges, package names/integrities/licenses, scripts and compatible engines; capture original package/lifecycle/license payloads before removal or install. Current isolation probe artifacts are under `/tmp/dispatcher-cv13-resolution-probe-20261026`, not final installation evidence.

- [ ] **Step2: Prepare project runtime and exact resolution.** Retain global/default/primary identities, then install additional Node24.22.1 using existing mise capability without changing globals. Update only the listed pins and minimum statements. Resolve fast-uri/brace using actual supported targeted recursive update; add only the three qualified parent overrides for the two otherwise unchanged leaf packages. Generate lock with pnpm, never hand-edit integrity/resolutions. The probe copied lockSHA223c9f52c496bb5d85b37b2daa151e9186dd14d1ae00dd5d26f3c82f0d6b28ea is a comparison reference, not a mandatory replacement for freshly verified resolution. Account for every delta; preserve unrelated versions unless the changed package's actual declaration requires it.

- [ ] **Step3: Install and qualify attribution.** Run ordinary `mise exec -- pnpm install --frozen-lockfile` with existing controls. Capture actual executable/version and native lifecycle bytes/results; do not bypass blocked policy or scripts. Verify actual installed package versions/parent resolution and tarball SRI/license/NOTICE against official registry artifacts for every changed package family. Run `mise exec -- pnpm licenses list --json` and `mise exec -- pnpm audit --json`, retain full raw results; zero advisories is the target for this known graph, any new advisory remains explicit. Check Node builtin/runtime facts separately from package Undici. If unsupported/policy-blocked, record exact evidence and narrow next action before changing scope.

- [ ] **Step4: Validate unchanged behavior and packaging.** Existing full default `mise exec -- pnpm check` must pass once on the frozen new candidate; any failure is preserved and diagnosed, no green-by-configuration workaround. Build as required before cross-package checks. Run existing meaningful isolated production deploy/attribution check with frozen source/lock, approved lifecycle and original temp payload retention; verify actual Controller Fastify and reachable package/license facts via the owning package's resolver. If using the clean-source staging entry, commit the tested candidate first and preserve its clean-source requirement; no host service activation. Add targeted checks only for a concrete failure or packaging uncertainty; do not rerun an unchanged full gate gratuitously.

- [ ] **Step5: Self-review, report and commit.** Review exact allowed-file diff and lock graph, no new ignored/suppressed control, no incidental CI rewrite. Document observed audit/runtime/license/install/full/deploy facts and limitations in the task report, with covering files/commands/output and frozen inputs. Commit the scoped deliverable; root independently audits evidence and generates the exactBASE..HEAD package for spec+quality review, then updates source503/Linear. CV13 remains In Progress until its other recovery/performance/source obligations are satisfied.


Root self-review: CV13 security requirements map to the one independent task and five Review Focus checks;11path scope follows actual existing contracts. Devin b091d6c is locally accepted; proceed under the user continuous-execution authorization using SDD, without a new plan-confirmation stall. Actual runtime/install/license/full/deploy proof still required.

## Local acceptance

Task1 complete5cc7c05, independent Spec/Quality0C/I/M and root17run/540Git/source/
artifact/primary audits clean. All11deliverables equal finalfull candidate inputs;
actual audit0/full209files4417/non-test/license/runtime/production attribution pass.
Generated101build outputs are intentional, preexisting cache preimage identity-only/
postbytes retained, no full snapshot/hermetic claim. pnpm bundled runtime and all
broader CV13/14/physical/formal Gates remain open. No reset/global/default/primary/
native/provider/service/push/merge change. Next canonical Task history14 is separate.
