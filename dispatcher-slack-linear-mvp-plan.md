# Slack–Linear–Dispatcher 个人最小可用闭环：开发步骤（2026-10-01）

依据：Linear 项目 Agent Dispatcher 当前状态（INH-1380 ~ INH-1394 均未开始）、main@ff0a899 代码静态审查、docs/architecture.md 与 ADR-001。本轮未改代码、未改 Linear、未跑测试。

## 0. 目标与边界

日常使用路径：

1. 在 Linear 建 Issue（状态 Todo），Dispatcher 通过 Linear webhook 导入为 canonical task + TaskContract。
2. 在 Slack 发 `task dispatch INH-xxx`（或线程里回复），Dispatcher 调度到本机 Embedded Runner 上的一个真实 Codex Profile。
3. 后台 worker 自动推进 run：Agent 需要人工输入时进入 WAITING_USER，Slack 线程收到提问；在线程里回复后，原 session 继续。
4. 验证通过后提交 commit/PR，持续回读 CI；CI 通过前 Linear 不进 Done。
5. Linear 状态/评论与 Slack 的 REVIEW_READY / FAILED 通知保持一致。

部署范围：单机 Controller + SQLite + Embedded Runner、1 个 Codex Profile、1 个 Slack App、1 个 Linear 测试项目、1 个带 CI 的 GitHub 测试仓库。Dashboard 只作排障兜底。

暂不做：Remote Runner（M12.1）、第二种 Agent（INH-1389）、双 Codex Profile（INH-1388 的一部分）、Team Mode / PostgreSQL（M14）、从 Slack 创建 Linear Issue（放到可选扩展）。

说明：交付终点仍然是 GitHub PR。现有 delivery 链路只支持 PR/commit，所以“Slack-Linear-Dispatcher”在实现上必须包含 GitHub。

## 1. 代码现状（静态审查结论）

已有，不需要从零写：
- Slack connector：HMAC 签名、时间窗、replay 去重、event / action / slash command 归一化、thread 回复、429/401/5xx 分类、secret:// 取凭据。
- Controller 消息入口：/api/connectors/:id/webhook → durable messaging-inbox（按 idempotencyKey 去重）→ handleMessagingMessage。
- 身份绑定：/api/connectors/:id/messaging-identities，把 Slack user 绑到 principal 和角色，服务端鉴权。
- WAITING_USER：notifyAttention 发通知并按 thread 绑定 session/run/generation；线程回复后校验 revision/generation，调用 agent.send 续接同一 session。
- 固定命令：task/run/fleet/profile 的 status / list / cancel / pause / resume / reroute；其余文本走内部 LLM 解析成 TypedIntentV2。
- Linear：ingress / getTask / listChanges / updateProjection / addComment / reconcile。Linear connector 的 settings.repository 决定任务交付到哪个仓库（单仓库映射，个人版够用）。
- 调度：/api/tasks/:id/dispatch → CanonicalScheduler → 创建隔离 worktree → 启动 Agent；/api/runs/:id/advance 负责推进、验证、交付、投影和通知。

本链路的缺口（按阻塞程度）：
- G1（阻塞）run 推进只能手动调用 POST /api/runs/:id/advance，notifyAttention 也只在这里触发。没有后台 worker 时，Slack 收不到 WAITING_USER / REVIEW_READY。→ INH-1381
- G2（阻塞）Slack 无法发起 dispatch：固定命令没有 dispatch，semantic tool 列表也没有 task.dispatch。dispatch 只有 HTTP API。→ Linear 没有对应任务，需新增
- G3（阻塞）Slack 入口是同步处理：webhook 请求内完成鉴权、LLM 解析、agent.send 后才返回。Slack 要求 3 秒内 ack，否则会重试。另外没有过滤 bot_id/subtype（Bot 自己发的消息会再进入入口），也没处理 X-Slack-Retry-Num。→ Linear 没有对应任务，需新增
- G4（阻塞长任务）lease 固定 15 分钟，没有续租；进程 spawn 失败的处理顺序有误。→ INH-1382
- G5（阻塞正确性）CI 只读 commit status API，没有持续 reconcile，Linear 完成语义（CI pending 不能 Done）没收口。→ INH-1383
- G6（阻塞安全）控制面 API（包括 messaging-identities、dispatch、secrets）缺单用户认证；Slack webhook 是公网入口。→ INH-1384
- G7（日常可用）SQLite 备份恢复、orphan worktree 清理。→ INH-1386
- G8（证据）INH-1282、INH-1294、INH-1279 的 Done 证据基于 fixture/contract，没有真实 Slack/Linear/GitHub/Codex 凭据下的端到端证据。→ INH-1387 / INH-1388

## 2. 开发步骤（按依赖顺序）

### Step 0 — 质量基线（INH-1380，Todo/High）
- 范围：在本机和 CI 上让 pnpm build / test / lint / typecheck / check / boundaries 全绿；确认 CI 失败原因（上一轮没拿到日志）；锁定 Node/pnpm 版本；排查日期相关测试和 DISPATCHER_SECRET_STORE_KEY 这类环境依赖。
- 验收：main 上 CI 连续绿；本地一条命令就能复现。
- 关系：后续所有步骤的前置。

### Step 1 — 单用户安全与 Slack 入口加固（INH-1384 + 新增 S1）
INH-1384（已有）：
- 控制面 API 加单用户认证（本地 token 或 session）；principal 只从服务端认证结果取，不信任请求体。
- 保护 messaging-identities、dispatch、secrets、config 等写接口；收紧 runner enrollment 凭据的交付方式。
新增 S1「Slack ingress 异步 ack、bot echo 过滤与重试语义」：
- webhook 只做验签和归一化，写入 inbox 后立即返回 200；由 worker 消费 inbox 处理消息（可与 INH-1381 共用 worker 框架）。
- 忽略 bot_id、本 App 自己发的消息，以及 message_changed / message_deleted 等 subtype。
- 带 X-Slack-Retry-Num 的重试请求，通过 event_id / idempotencyKey 去重后直接 ack。
- 失败分类：未绑定用户 → 线程内提示“未授权”（只提示一次，不重复发）；处理异常 → inbox 标 FAILED，进 dead-letter。
- 验收：重复事件不会重复执行；伪造签名或过期时间戳返回 401；Bot 自己的消息不会触发处理；入口 p99 ack < 1s；日志、事件、Slack 回复中没有凭据。

### Step 2 — 后台推进 worker 与重启恢复（INH-1381，依赖 1380）
- 范围：常驻 worker 推进 run（ACTIVE → WAITING_USER / VERIFYING → DELIVERING → COMPLETE/FAILED），驱动 projection outbox drain 和 messaging inbox 消费；Controller 重启后从 SQLite 恢复所有未结束的 run/outbox/inbox。
- 重点：notifyAttention 改为由状态变化触发，不再依赖手动 advance；通知幂等键继续使用 attention:taskId:state:generation。
- 验收：不手动调用 advance，Slack 也能收到 WAITING_USER 和 REVIEW_READY；处理过程中 kill Controller，重启后同一 run 继续，没有重复 PR 或重复通知。

### Step 3 — Slack 发起 dispatch（新增 S2，依赖 1381、1384）
- 把 /api/tasks/:id/dispatch 的逻辑抽成 Controller 内的 dispatchTask 服务方法；HTTP API 和 semantic tool 共用这一个方法，不复制逻辑。
- 新增 semantic tool task.dispatch（权限：operator 角色，有副作用，需要确认）；固定命令新增 `task dispatch <INH-xxx|taskId> [profile]`，用 semanticCandidates 已有的 externalRefs 别名，把 Linear 编号解析成 canonical task。
- Slack 回复：dispatch 成功后回复 run id 和路由说明，并把该线程绑定到 run；后续的 attention 通知和 WAITING_USER 都发到这个线程，不再新开顶层消息。现在 notifyAttention 每次都在 alertChannel 新发消息，这里需要支持“已有线程优先”。
- 验收：未绑定或非 operator 用户被拒绝；任务不在 READY 状态时返回明确错误；同一条 Slack 消息重复投递只会产生一个 run；任务编号有歧义时返回澄清，不做猜测。

### Step 4 — 长任务 lease 与进程失败（INH-1382，依赖 1380）
- 范围：Embedded Runner 心跳续租；lease 过期后按 generation fencing 处理；修正 ProcessManager 的 spawn error 处理（先注册 error handler，再检查 pid）；Codex 可执行文件缺失时 run 直接 FAILED，并给出可读原因。
- 验收：40 分钟以上的任务不会因为 15 分钟 lease 失败；可执行文件路径错误时 Slack 收到 FAILED 通知并附原因；过期 generation 的交付被拒绝。

### Step 5 — 交付、CI reconcile 与 Linear 完成语义（INH-1383，依赖 1380）
- 范围：verification 失败时不允许交付；PR 创建幂等；同时读取 check-runs 和 commit status，持续 reconcile CI；Linear 投影规则为 PR 已开且 CI pending → In Review，CI passed → 按配置进入 Done 或保持 In Review，CI failed → 评论并在 Slack 通知。
- 验收：CI pending 不会进 Done；重复交付只有一个 PR；CI 失败后 Slack 和 Linear 都有记录。

### Step 6 — SQLite 备份恢复与 orphan 清理（INH-1386，依赖 1381、1382）
- 个人版最低要求：一条命令完成在线备份并做恢复演练；恢复后 inbox/outbox 幂等仍然有效（重放后不会重复发 Slack 消息或评论）；安全清理 orphan worktree。

### Step 7 — Dashboard 兜底（INH-1385，依赖 1381、1384）
- 本链路以 Slack 为主界面，这一步可以缩小范围：只保留 Need Attention 列表、dead-letter 重试/解决、run 取消、错误原因展示。

### Step 8 — 端到端 Gate（INH-1387，扩展为包含 Slack）
- 前置：Step 0–7。
- 真实环境：Slack 测试 workspace/App、Linear 测试项目和 webhook、GitHub 测试仓库及 CI、一个已登录的 Codex Profile、本机 secret store（DISPATCHER_SECRET_STORE_KEY）。
- 必跑场景：
  1. Happy path：Linear Todo → Slack dispatch → Codex 完成 → PR → CI 绿 → Linear 状态正确 → Slack REVIEW_READY。
  2. WAITING_USER：Agent 提问 → Slack 线程回复 → 同一 session 继续；使用旧 generation/revision 的回复被拒绝。
  3. Verification 失败：没有 PR，Linear 有评论，Slack FAILED。
  4. 重复投递：Linear 和 Slack 事件各重放一次，不产生重复副作用。
  5. 中途重启 Controller：任务继续完成。
  6. CI 失败或长时间 pending：不进入 Done。
  7. Slack 429 或断网：通知重试后最终送达，不重复。
- 证据：每个场景附 run id、Linear/Slack/GitHub 链接和 SQLite 事件摘录，并对证据做脱敏扫描。与 fixture/contract 测试结果分开记录。

### Step 9（之后）— 日常可用
- INH-1388 拆分：真实 Slack 证据已并入 Step 8；双 Codex Profile 留在 INH-1388。
- INH-1389（第二种 Agent）、INH-1390（Need Attention / 资源阻塞 / 资源基线）完成后，进入 Team Mode（INH-1351）。
- 可选扩展 S3：在 Slack 用 `task create` 调用 Linear issueCreate（Linear connector 当前没有 create，需要新增，且要走确认流程）。

## 3. 关键路径与并行

INH-1380 → { INH-1381, INH-1382, INH-1383, INH-1384 + S1 }（可并行）→ S2（依赖 1381 + 1384）→ { INH-1385, INH-1386 } → INH-1387（含 Slack）

建议实现顺序：1380 → 1384+S1 → 1381 → S2 → 1382 → 1383 → 1386 → 1385 → 1387。在 1381 和 S2 完成后先做一次不带 CI 的 Slack 联调，尽早暴露真实 Slack 行为的差异。

## 4. 建议的 Linear 调整（需确认后才执行）

- 新增 S1「Slack ingress 异步 ack、bot echo 过滤与重试语义」（M6.1，High）：依赖 INH-1380；blocks INH-1387。
- 新增 S2「Slack 发起 dispatch：task.dispatch semantic tool / 固定命令 / 线程绑定」（M6.1，High）：依赖 INH-1381、INH-1384；blocks INH-1387。
- 修改 INH-1387 描述（未开始，按约定可以改）：Gate 增加 Slack 链路场景。
- 修改 INH-1388 描述（未开始）：注明真实 Slack 证据前移到 INH-1387，INH-1388 只保留双 Codex Profile 日常证据。
- 可选新增 S3「Slack 创建 Linear Issue」（Low）。
- 引用其他 Issue 时只写纯文本编号，避免 Linear 自动生成关联。
