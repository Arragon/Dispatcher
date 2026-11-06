# v3 frontend adaptation

Continue the approved Dispatcher-Merged-v3 visual system and the backend implementation document. Document content is design input, not authorization to change native logins or external services.

## Milestones and acceptance

1. Shared API and task workspace: retain structured failure metadata; use structured UI intents; read canonical task/contracts/attempts/archive and immutable results independently of Fleet visibility; distinguish Task acceptance from Run completion; preserve reply authority. Add frontend and Controller regressions. Check official quota.
2. Management adaptation: explicit ConfigPlan review for Harness creation; canonical publication trial; working native catalog/default configuration entry; consistent invalidation after configuration changes; version-fenced settings/setup/internal-model plans with draft conflict recovery; connect integration/device/repository/policy/diagnostic states without fabricated capabilities. Add relevant regressions. Check official quota.
3. Finish: pending/error/empty/responsive/accessibility coverage, all routes against the built Controller; no paid provider calls required for frontend acceptance. Run complete project gate with bounded workers, UI detector, independent final review, evidence and checkpoint. Check official quota.

Stop after a milestone if any readable official quota window has remaining <=15%. Existing optional backend extensions (policy auto routing, remote publication execution, native GUI takeover, precise provider cost/quota) remain explicitly unavailable. Preserve ConfigPlan, secrets and adapter boundaries.

## Validation commands

Derived from package.json and root AGENTS.md: pnpm vitest run <files>, pnpm check --maxWorkers=4 (complete gate, bounded Vitest concurrency). Browser verification uses an owned disposable Controller profile, preserving primary user data.

## Progress

- Audited all route families and relevant backend APIs. Existing approved visual direction retained. Initial worktree clean on codex/dispatcher-v3-console, base 08dd791. Initial quota remaining 82%.
- Milestone 1: structured ApiError, structured UI workflow intents, canonical task drawer with persisted attempts/archive/frozen run contract/results implemented. Targeted 22 frontend/Controller tests passed; added persisted projection assertions then 4 targeted tests passed, web TypeScript passed. Quota remaining 81%.
- Milestone 2: Harness preview-only account ConfigPlans with explicit apply, canonical trial link, native default review/clear, shared projection invalidation, atomic editing-base checks (legacy clients without baseRevision preserved), setup preview/apply, internal role reset without inference, integration retry capability and truthful loading/error states implemented. 67 targeted tests passed; 5 adaptation tests passed; complete typecheck and lint passed. Milestone 1 final quota was 80%, correcting the intermediate 81% observation.
- Final review: four Important findings fixed in one pass: explicit cache/draft reset, wizard input locking, per-role async selection fences, Fleet-independent deep links. Six regressions observed RED then GREEN; pending failback also covered. No deferred review minors.
- Final hardening: browser reproduction fixed table hidden-text overflow (598px ->390px); publication recovery now uses bound review snapshots and ignores late preview reads after editing. Two publication regressions observed RED then GREEN.
- Milestone 3: pnpm check --maxWorkers=4 passed 48 files /368 tests, detector returned [], desktop1280 and mobile390x844 route verification passed all13 surfaces; viewport restored. Native directory queried read-only and existing real run/result verified; no paid native task rerun. Final evidence in docs/console-v3-verification-2026-10-15.md. Latest quota remaining76%.
