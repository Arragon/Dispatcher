# macOS convergence remaining issues

Local implementation/evidence backlog; none of these rows claims a passed
Gate. Continue independent units without bypassing data/control safeguards.

| ID | Linear | State | Evidence / impact / next action |
| --- | --- | --- | --- |
| R-001 | INH-1920 / CV-03 | local remediation verified; whole-branch review pending | Reproduced 3 failures at the original all-CPU test pool. Atomic draft replacement/generation checks pass 16 UI cases. Test-worker budget now min(4, CPUs), preserving parallelism and native 3s/5s deadlines; all slow/invalid probe assertions remain. Two complete default pnpm check runs pass 90 files/802 tests. Source and resource evidence: docs/evidence/convergence/README.md. Real CLI/provider qualification remains separate. |
| R-002 | INH-1841/1845 | real macOS evidence pending | Directory selection/cancel and complete browser/Codex loop require integrated-candidate evidence; fixtures do not prove them. |
| R-003 | INH-1535/1538/1491/1561 | formal evidence pending | Native identity/release/reclaim and Slack/Linear/GitHub daily chain retain original Gates; unqualified native control stays closed. |
| R-004 | INH-1562/1390 | performance evidence pending | Initial budgets: idle CPU <1%, RSS <250 MB. Smoke does not replace long-running scenarios; record host/config/SHA and measured values. |
| R-005 | INH-1925 / CV-08 | control runtime composition pending | Schema 5/writer support does not imply safe control recovery. Controller currently refuses live native-bound/control records before restoring authority. Replace this admission barrier with fully composed per-Run Guard/observation/recovery only when all write paths are fenced. |
| R-006 | INH-1386/1564 | restore reconciliation and real drill pending | Backup/restore API and synthetic negative tests are ported; archives/restored databases deliberately retain startup barriers. CLI/doctor reconciliation workflow and real macOS restore evidence are still required before claiming daily recovery. |
