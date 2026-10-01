# Dispatcher 个人 MVP Step3–5 接力单

## 基线与 PR 边界

2026-10-01 核对 GitHub 与 Slack 原线程：PR #4 已于 19:30:39 UTC（12:30:39 Pacific）合并，main 为 `af00240b6d62999065141ea390df29d6fe4bbd26`，包含原 HEAD `86978f9187b5559a65363d1af072fd34cb656080`。未发现 Step3–5 后续 PR 或远端分支提交。#4 review threads 与其 HEAD combined statuses 都为空；空状态不证明代码失败。此次不合并任何 PR。

决定：从 main 新建 `codex/personal-mvp-step3-5`，提交一个后续 PR，按 Step3、4、5 分提交。三步复用同一个 Controller 后台循环，集成回归需要一起验证；继续增加 #4 的 diff 已无意义。保留既有 adapter、scheduler、SCM、canonical task/outbox 边界，不新增依赖。

## Task 1: Step3 / INH-1396

文件：`apps/controller/src/service.ts`、`packages/semantic/src/index.ts`；回归：`apps/controller/test/personal-loop.test.ts`、`packages/semantic/test/compiler.test.ts`。

- 抽取 `dispatchTask(taskId, body, idempotencyKey?)`，HTTP 与 privileged/operator semantic tool `task.dispatch` 共用；在创建 worktree 前验证 READY 状态，单 Controller 串行调度防止容量竞态。
- 固定命令 `task dispatch <INH-xxx|taskId> [profile]`，task/profile 别名都通过 resolver；歧义进入 clarification。
- 保留 durable confirmation，不直接执行 privileged 命令。workflow 与来源线程持久绑定；成功回复 run id/routing 并绑定原线程。重放或回复失败后重试不会再起 run。
- scheduler 启动 adapter 前回调 Controller，把 STARTING run、QUEUED task、currentRunId 和派发 receipt 原子保留；完成时使用最新 task revision，避免并发评论留下 orphan agent。
- WAITING_USER 在原线程提问，校验 run/session/generation/revision 后续接同 session，并同步 task 回 RUNNING；FAILED/REVIEW_READY 也优先原线程。
- 同一消息的已消费回复保留 durable receipt；Slack 429/重启后只重试 ack，不会回答下一个问题。多次 WAITING_USER 的 canonical 命令 ID 按 episode 分开。
- 定向命令：`pnpm vitest run packages/semantic/test/compiler.test.ts apps/controller/test/personal-loop.test.ts`。先添加失败回归，再实现，预期通过。

## Task 2: Step4 / INH-1382

文件：`apps/controller/src/service.ts`、`packages/runner/src/lease.ts`、`packages/runner/src/process.ts`、`packages/runner/src/remote.ts`、`packages/scheduler/src/index.ts`、`packages/adapters/src/codex.ts`；回归：`packages/runner/test/process.test.ts`、`packages/runner/test/distributed.test.ts`、`apps/controller/test/personal-loop.test.ts`。

- 通过 Embedded Runner heartbeat 与后台循环续租当前非终态 run；续租独立于长时间 verification/SCM await。持久化 expiry；禁止过期、撤销、旧 generation 续租或交付。
- 非终态（含 STARTING、WAITING_USER、VERIFYING、DELIVERING）持续计入容量；lease failure 先终止 authority，再取消当前 adapter session，并显示 cleanup 失败原因。
- ProcessManager 在读取 pid 前安装 error/close handler 并等待 spawn；保留原始可读原因。
- 启动失败留下 FAILED run/task 与原因，无 PR；Codex 异步 spawn 失败结果保留诊断，Slack 收到 FAILED。
- 异步 advance 落盘前重新校验 state/generation，并保留 heartbeat 已续租的 expiry。修复基线 runner shutdown/replay race：等待进行中命令落 journal，关闭后的原连接不再发送，也不借用新连接回复。
- 定向命令：`pnpm vitest run packages/runner/test/process.test.ts packages/runner/test/distributed.test.ts packages/scheduler/test/scheduler.test.ts packages/adapters/test/codex.test.ts apps/controller/test/personal-loop.test.ts`。测试时钟推进超过 40 分钟并验证旧 lease fence。

## Task 3: Step5 / INH-1383

文件：`packages/integrations/src/github.ts`、`packages/integrations/src/scm.ts`、`packages/integrations/src/delivery.ts`、`packages/persistence/src/index.ts`、`apps/controller/src/service.ts`；回归：`packages/integrations/test/github.test.ts`、`packages/persistence/test/persistence.test.ts`、`packages/integrations/test/contracts.test.ts`、`apps/controller/test/personal-loop.test.ts`。

- CI 合并 commit statuses 与 paginated check-runs：失败优先，其次 pending，所有观察到的检查通过才 PASSED；零检查为 PENDING。
- 先持久化 commit/PR，再读 CI；CI 读取失败不重复 push/PR。后台继续读取 COMPLETE run 的 CI 并持久化 evidence，重启后继续。
- reconcile 中已成功读取的 PR 状态/head 不因 CI 读取失败丢失；新 head 的 CI 回到 PENDING，移除旧 head 的检查链接。
- PR 已创建时 task 为 REVIEW（Linear 配置 `statusIds.REVIEW` 映射 In Review）；CI pending/failed 不能自动 Done。默认通过后仍 REVIEW；GitHub connector `settings.doneOnCiPassed=true` 才自动 Done。
- CI 状态变化写 canonical comment → durable outbox，并在原 Slack 线程通知；失败通知可重试，幂等。过期 generation/currentRun 不得推进新任务投影。
- 既有 delivery evidence 插入只去重，需新增按 evidence revision 的更新 CAS；不改变表结构，也不把这一 CAS 扩大表述为 run 排他/inbox claim 的跨进程保证。
- 定向命令：`pnpm vitest run packages/integrations/test/github.test.ts packages/integrations/test/contracts.test.ts apps/controller/test/personal-loop.test.ts apps/controller/test/m6-e2e.test.ts`。

## 可直接写回 Linear 的文案（INH-1381）

> Step0–2 实现边界澄清：后台 worker 自动推进 ACTIVE、VERIFYING、DELIVERING，并消费 messaging inbox、drain projection outbox；RESOURCE_BLOCKED 与 WAITING_USER 不在自动 advance 扫描集合中。RESOURCE_BLOCKED 通过既有资源探测/恢复策略或显式 resume 路径恢复，不能将本项验收理解为 worker 会直接轮询推进资源阻塞 run。
>
> 同一 run 的 advance 排他通过单个 Controller 进程内的 in-flight Promise 实现；messaging inbox claim 为该进程内的 list-then-save，尚不是跨进程互斥或数据库原子 CAS。当前验收限定单用户、单 Controller、SQLite、Embedded Runner；不支持多个 Controller 共享同一数据库进行并发消费。多 Controller 锁/CAS/fencing 留给后续团队/高可用里程碑。重启恢复与正常重复事件去重不等同于外部副作用 exactly-once。
>
> PR #4 已合并；CI combined status 空数组仅表示没有 status context，不据此判定代码失败，也不宣称 CI 已通过。Step3–5 由后续 PR 承接。

Linear connector 当前需要重新认证；本文件提供文案，尚未写入 Linear，不改变 Issue 状态。

## 验证与真实使用边界

环境要求从仓库配置取得：Node >=24.12，pnpm 11.19；本次实际使用 bundled Node 24.19.0、pnpm 11.25.0。全量 gate：`pnpm check`（build/typecheck/lint/boundaries/test）；定向测试见各步。基线：34 文件/195 测试断言通过，但 Remote Runner restart 测试出现 `Remote runner client is not started` 未处理异常，check exit 1；已添加 shutdown/replay 回归并修复，最终检查重新执行。

Controller 集成测试使用 workspace `dist`，因此改动 packages 后先运行 `pnpm build`，再执行定向命令。Step3：3 文件/14 测试通过；Step4：5 文件/29 测试通过；Step5 初轮：5 文件/41 测试通过。续租快照与 shutdown/replay 回归从失败到通过；只读审查的七项问题也都有失败→通过回归。最终 `pnpm check` 通过，36 文件/228 测试，无未处理异常（2026-10-01；build/typecheck/lint/boundaries/test 全部通过）。

单 Controller 可用循环的自动化测试必须覆盖：Linear 导入 → Slack 确认派发 → WAITING_USER 同 session 回复 → verification → 一个 PR → CI pending/failed/passed → Linear/Slack；重复事件、重启、Slack 429、verification 失败与不可执行路径。

真实 Slack App、Linear 测试项目、GitHub 测试仓库、已登录 Codex Profile 的现场 Gate 属于 INH-1387；fixture 结果不能作为真实环境证据。Step6/7（备份、orphan 清理、Dashboard）不纳入本次 Step3–5 PR。

进程被 kill 后，已有 Codex turn 的真实重接尚未验证；adapter 的进程 handle 在内存中，本次重启回归覆盖派发/续接确认和 COMPLETE run 的 PR/CI 观察，不声称恢复仍在运行的原生进程。外部副作用不提供任意 crash 边界的 exactly-once 保证。

## 执行裁决与未验范围

- 原目录只有参考 Markdown，直接在该 checkout 建 feature branch，未额外创建 worktree；如需并行修改，应另建隔离 checkout。
- #4 已合并，三步以一个后续 PR 承接；若 main 后续发生变化，需要重新检查集成，不重写已合并 #4。
- INH identifier 使用 normalized extension，Linear UUID 仍用于 binding；旧任务缺 identifier 时要使用 canonical task ID。
- evidence revision CAS 只更新已有 evidence，不提升 inbox/run 排他的跨进程保证；多 Controller 部署仍不支持。
- 修复基线 runner shutdown/replay 是 Step4 生命周期范围内的本地 gate 修复；shutdown 等待进行中 handler，长期不返回的 handler 仍会延迟关闭。
- INH-1387 live Gate、真实 provider 兼容、正在执行进程重接、任意 crash 边界 fault injection 未验；成本是现场启用前还需 smoke test，不能据 fixture 宣称 live 验收完成。
- 多 Controller、Step6/7 与 CI 配置修复不在本次范围。没有延后的 Minor 审查项。
## 个人循环现场操作（INH-1387 待执行）

```bash
export PATH="/Users/wangdongxin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
cd /Users/wangdongxin/projects/dispatcher
pnpm install --frozen-lockfile
pnpm check
pnpm dispatcher -- serve --with-runner
```

从终端打印的单次登录链接进入 Dashboard，配置已注册本地仓库与固定 verification ID、Linear/GitHub/Slack connectors、已登录的隔离 Codex profile。通过安全输入保存 SecretStore 凭据，仅把 `secret://...` 引用放入 config。Linear 的 `settings.repository` 必须匹配仓库 ID，`settings.statusIds.REVIEW` 必须是实际 In Review 状态 UUID；`DONE` 仅在开启自动 Done 时需要。GitHub 默认保持手工验收，`settings.doneOnCiPassed=true` 是明确的自动验收开关。

将 Linear webhook 和 Slack Events/Interactivity 都指向已启用 connector 的 `/api/connectors/<instance-id>/webhook`（沿用现有入口和签名校验）。通过 owner 授权入口 `POST /api/connectors/<slack-instance-id>/messaging-identities` 绑定自己的 `externalPrincipalId`（Slack user ID）、`principalId`、`roles: ["operator"]`；显示名不提供权限。请求使用现有 owner bearer 或 Dashboard session/CSRF，外网地址和 allowedHosts 按现有认证边界配置。

在 Linear 填写 Scope、Acceptance Criteria、Verification（条目使用已注册命令 ID），确认导入的 canonical task 为 READY。在 Slack 新线程发送 `task dispatch INH-xxx Orion`（profile 可省略），点击确认，保留返回的 run ID 和路由说明。WAITING_USER 时直接在同线程回复；无需手工调用 advance。验证完成后同线程收到 PR，Linear 进入 In Review；CI 无检查或仍在运行时为 pending，失败与恢复会继续回流，Controller 重启后仍从同一 PR 接着观察。

现场验收记录一个真实 task ID、run ID、provider session ID、PR URL、Linear 状态和 Slack 线程链接；再验证一次 WAITING_USER 回复和一次重启后的 CI 回流。未取得这些证据前，不将 INH-1387 标为已验收。
