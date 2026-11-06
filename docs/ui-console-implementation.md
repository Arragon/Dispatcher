# Console implementation contract

Approved on 2026-10-02 against `.dispatcher/ui-redesign/`: compact sidebar,
list-first accounts and models, project/agent task views, sectioned settings,
and sidebar configuration assistant. Light is the initial theme; an explicit
dark/light preference persists locally. Preview scenario controls appear only
on the Tasks preview and never replace production evidence.

Shared CSS tokens intentionally propagate to every Web route. Existing routes,
owner authentication, secret input, ConfigPlan confirmation, native provider
permissions, SSE refresh, and task/run identity remain intact. No new external packages
or provider permission changes are required. Native HTML dialogs provide modal
focus, Escape, and focus restoration.

Implementation order:

- [x] Theme, compact shell, accessible drawers, responsive shared styles.
- [x] Account list and row-local login checks; details/add/trial drawers.
- [x] Complete Fleet snapshot project metadata, immutable run model selection,
      reported Codex tokens, and explicit reversible task archive metadata.
- [x] Project/agent task views, filters, history, and execution details.
- [x] Overview, list-first internal models, integration recovery, settings
      sections retaining the entire draft, setup and assistant.
- [x] Regression tests, typecheck/lint/boundaries/build/full suite, then bounded
      desktop/mobile browser verification using the real service.

Missing provider metrics remain unknown, never zero. Configured model selection
is marked separately from runtime evidence. Token totals do not include cached
input twice and never stand for account quotas. Finished tasks remain current
until explicitly archived. Active runs cannot be archived. No PR is merged and
empty CI evidence remains unknown. Existing project metadata can come from
canonical project records, platform extensions, and registered repositories
explicitly referenced by task contracts; project IDs are not repository IDs.

Verification covers cross-project accounts, authoritative current runs, archive
and restore, missing metrics, section edits preserving hidden configuration,
invalidating stale plans, theme persistence, keyboard dialogs, error recovery,
and existing owner/secret/native adapter safeguards. Production's empty task
state is verified separately from populated regression fixtures.

## Verification evidence

`pnpm check` passes build, typecheck, lint, boundaries and all 292 tests in 41 files.
Browser verification uses the real 8347 instance for accounts, themes and honest
empty task state; a separate temporary Controller database on 8351 exercises
populated project/account views and archive restore. Fixture names explicitly
say 验收样本 and never enter the personal database. Required decision replies
use server authority fences; isolated backends validate operations without
sending real provider tasks. Native login and end-to-end acceptance remain
separate from this UI verification.

Screenshots in the ignored local `.dispatcher/ui-redesign/` directory:
`implemented-light-accounts.png`, `implemented-dark-accounts.png`,
`implemented-mobile-accounts.png`, and `implemented-project-view.png` (isolated
sample data). Independent review found archive reservation and stale reply
races; both now have server guards and regression tests. UI code is local and
uncommitted; Linear INH-1385 records progress as In Progress, not acceptance Done.
