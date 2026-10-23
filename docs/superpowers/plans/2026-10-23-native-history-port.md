# Native history service and API port

> REQUIRED SUB-SKILL: superpowers:executing-plans. Implement inline with TDD and a scoped read-only review; do not dispatch implementers.

**Goal:** Preserve a499d84's bounded authorized native-history reader behind the current exact binding/source and canonical Run API.

**Base:** e9f6329; default178 files/2056 tests passes87.11s. Existing parent CV-09/13 and original actual-provider Gates stay open.

**Architecture:** Reuse the same-repository native-history service and its complete original tests. Controller resolves the selected persisted binding through the owning runtime.source, authorizes the captured Run via NativeInteractions and keeps the current HTTP auth/error contract. History is an explicit read, with no prompt/reattach/replay, transcript persistence, selection conversion or provider-payload exposure. Cold/unqualified sources return a bounded unknown/unsupported page.

**Files:** Add apps/controller/src/native-history.ts and test/native-history.test.ts from a499d84; modify only the current service composition and codex-runtime-service tests for the owning API, plus relevant architecture/know-how/evidence/disposition notes. Existing types, redactors, libraries and source license apply; no new dependency or persisted format.

- [x] Migrate all original history assertions; observe missing-module RED, then reuse the bounded default50/max100 reader, UTF8/page-byte limits, redaction, exact native cursor, source and authorization recheck, five-second AbortSignal and late-page refusal. Keep original assertions; adapt fixtures only for actual current prerequisites.
- [x] Add authenticated API RED cases for exact selected Run/source, unqualified reads without native queries, bounded pagination, malformed query rejection, source/adapter/generation/lease drift during a pending read, shutdown and no transcript persistence/input/replacement session.
- [x] Compose the preserved service through current NativeInteractions and exact owning sources. Keep frozen Run metadata/contract behavior, reject missing/foreign contexts, check capture after await and sanitize bounded error mapping.
- [x] Run targeted reader/Codex-service/recovery/metadata/history-memory regressions, default mise exec -- pnpm check, and an independent fresh-context read-only review with fixes. Save exact evidence/source and Linear readback before completion.

**Review:** authorization before port resolution; exact session/native store/workspace/source/Run selection and generation; no aggregate borrowing; late timeout or shutdown page cannot disclose or persist data; historical Run data and existing HTTP contracts remain readable. Bound bytes and native cursor without manufacturing completeness.

**Boundary:** This ports the existing reader/API. It does not qualify actual account/protocol, native writer release, GUI, OpenCode, service/release, or other outstanding parent tasks. R-020 is recorded without deadline/assertion/worker/retry weakening.


Final local evidence: original27 cases unchanged plus4 new reader regressions
(31 total); Codex service has90 including16 history API cases. Focused6 files/
143 tests pass; transport/history/service3 files/137 pass after atomically
publishing the child fixture receipt (all original assertions retained). Initial
queued-admission RED and3 timestamp RED have minimal GREEN fixes. Independent
review approved the timestamp fix and fixture synchronization with no residual
findings. Final defaultfull3 exits0 with179 files/2103 tests (86.37s), plus build/
typecheck/lint/boundaries. Earlier full2's incomplete receipt failure remains
recorded separately from R-020. This increment is locally complete; the parent
CV-09/OpenCode and actual-provider/native/release Gates remain incomplete.
