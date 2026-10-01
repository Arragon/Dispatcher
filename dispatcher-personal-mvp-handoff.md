# Dispatcher 个人 MVP Step3–5 接力单

## 基线与 PR 边界

2026-10-01 核对 GitHub 与 Slack 原线程：PR #4 已于 19:30:39 UTC（12:30:39 Pacific）合并，main 为 `af00240b6d62999065141ea390df29d6fe4bbd26`，包含原 HEAD `86978f9187b5559a65363d1af072fd34cb656080`。未发现 Step3–5 后续 PR 或远端分支提交。#4 review threads 与其 HEAD combined statuses 都为空；空状态不证明代码失败。此次不合并任何 PR。

决定：从 main 新建 `codex/personal-mvp-step3-5`，提交一个后续 PR，按 Step3、4、5 分提交。三步复用同一个 Controller 后台循环，集成回归需要一起验证；继续增加 #4 的 diff 已无意义。保留既有 adapter、scheduler、SCM、canonical task/outbox 边界，不新增依赖。

## Task 1: Step3 / INH-1396

文件：`apps/controller/src/service.ts`、`packages/semantic/src/index.ts`；回归：`apps/controller/test/personal-loop.test.ts`、`packages/semantic/test/compiler.test.ts`。

- 抽取 `dispatchTask(taskId, body, idempotencyKey?)`，HTTP 与 privileged/operator semantic tool `task.dispatch` 共用；在创建 worktree 前验证 READY 状态，单 Controller 串行调度防止容量竞态。
- 固定命令 `task dispatch <INH-xxx|taskId> [profile]`，task/profile 别名都通过 resolver；歧义进入 clarification。
- 保留 durable confirmation，不直接执行 privileged 命令。workflow 与来源线程持久绑定；成功回复 run id/routing 并绑定原线程。重放或回复失败后重试不会再起 run。
- WAITING_USER 在原线程提问，校验 run/session/generation/revision 后续接同 session，并同步 task 回 RUNNING；FAILED/REVIEW_READY 也优先原线程。
- 定向命令：`pnpm vitest run packages/semantic/test/compiler.test.ts apps/controller/test/personal-loop.test.ts`。先添加失败回归，再实现，预期通过。

## Task 2: Step4 / INH-1382

文件：`apps/controller/src/service.ts`、`packages/runner/src/lease.ts`、`packages/runner/src/process.ts`、`packages/scheduler/src/index.ts`、`packages/adapters/src/codex.ts`；回归：`packages/runner/test/process.test.ts`、`packages/runner/test/distributed.test.ts`、`apps/controller/test/personal-loop.test.ts`。

- 通过 Embedded Runner heartbeat 与后台循环续租当前非终态 run；续租独立于长时间 verification/SCM await。持久化 expiry；禁止过期、撤销、旧 generation 续租或交付。
- ProcessManager 在读取 pid 前安装 error/close handler 并等待 spawn；保留原始可读原因。
- 启动失败留下 FAILED run/task 与原因，无 PR；Codex 异步 spawn 失败结果保留诊断，Slack 收到 FAILED。
- 定向命令：`pnpm vitest run packages/runner/test/process.test.ts packages/runner/test/distributed.test.ts packages/scheduler/test/scheduler.test.ts packages/adapters/test/codex.test.ts apps/controller/test/personal-loop.test.ts`。测试时钟推进超过 40 分钟并验证旧 lease fence。

## Task 3: Step5 / INH-1383

文件：`packages/integrations/src/github.ts`、`packages/integrations/src/delivery.ts`、`apps/controller/src/service.ts`；回归：`packages/integrations/test/github.test.ts`、`apps/controller/test/personal-loop.test.ts`。

- CI 合并 commit statuses 与 paginated check-runs：失败优先，其次 pending，所有观察到的检查通过才 PASSED；零检查为 PENDING。
- 先持久化 commit/PR，再读 CI；CI 读取失败不重复 push/PR。后台继续读取 COMPLETE run 的 CI 并持久化 evidence，重启后继续。
- PR 已创建时 task 为 REVIEW（Linear 配置 `statusIds.REVIEW` 映射 In Review）；CI pending/failed 不能自动 Done。默认通过后仍 REVIEW；GitHub connector `settings.doneOnCiPassed=true` 才自动 Done。
- CI 状态变化写 canonical comment → durable outbox，并在原 Slack 线程通知；失败通知可重试，幂等。过期 generation/currentRun 不得推进新任务投影。
- 定向命令：`pnpm vitest run packages/integrations/test/github.test.ts packages/integrations/test/contracts.test.ts apps/controller/test/personal-loop.test.ts apps/controller/test/m6-e2e.test.ts`。

## 可直接写回 Linear 的文案（INH-1381）

> Step0–2 实现边界澄清：后台 worker 自动推进 ACTIVE、VERIFYING、DELIVERING，并消费 messaging inbox、drain projection outbox；RESOURCE_BLOCKED 与 WAITING_USER 不在自动 advance 扫描集合中。RESOURCE_BLOCKED 通过既有资源探测/恢复策略或显式 resume 路径恢复，不能将本项验收理解为 worker 会直接轮询推进资源阻塞 run。
>
> 同一 run 的 advance 排他通过单个 Controller 进程内的 in-flight Promise 实现；messaging inbox claim 为该进程内的 list-then-save，尚不是跨进程互斥或数据库原子 CAS。当前验收限定单用户、单 Controller、SQLite、Embedded Runner；不支持多个 Controller 共享同一数据库进行并发消费。多 Controller 锁/CAS/fencing 留给后续团队/高可用里程碑。重启恢复与正常重复事件去重不等同于外部副作用 exactly-once。
>
> PR #4 已合并；CI combined status 空数组仅表示没有 status context，不据此判定代码失败，也不宣称 CI 已通过。Step3–5 由后续 PR 承接。

Linear connector 当前需要重新认证；本文件提供文案，尚未写入 Linear，不改变 Issue 状态。

## 验证与真实使用边界

环境要求从仓库配置取得：Node >=24.12，pnpm 11.19。全量 gate：`pnpm check`（build/typecheck/lint/boundaries/test）；定向测试见各步。基线：34 文件/195 测试断言通过，但 Remote Runner restart 测试出现 `Remote runner client is not started` 未处理异常，check exit 1，须在最终验证明确记录。

单 Controller 可用循环的自动化测试必须覆盖：Linear 导入 → Slack 确认派发 → WAITING_USER 同 session 回复 → verification → 一个 PR → CI pending/failed/passed → Linear/Slack；重复事件、重启、Slack 429、verification 失败与不可执行路径。

真实 Slack App、Linear 测试项目、GitHub 测试仓库、已登录 Codex Profile 的现场 Gate 属于 INH-1387；fixture 结果不能作为真实环境证据。Step6/7（备份、orphan 清理、Dashboard）不纳入本次 Step3–5 PR。
