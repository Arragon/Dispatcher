# Agent Dispatcher：最新版架构与开发路线图

> 文档类型：Architecture + Engineering Specification + Roadmap（二合一）  
> 状态：当前冻结设计基线  
> 版本：2026-09-15  
> 目标读者：开发 Agent、维护者、架构审查者  
> 核心定位：面向个人/小团队的轻量、多平台 Coding Agent Operations Control Plane；Web Dashboard 为正式控制面

---

## 0. 文档结论

本项目不再被定义为“Linear 到几个 Coding Agent 的转发器”，也不应演进成一个自由自治、拥有宿主机无限 shell 权限的超级 Agent。

最终定义是：

> **一个以 Linear 为任务事实源、以 Slack 为主要人机交互入口、以 Controller 负责调度和全局状态、以跨平台 Runner 负责真实执行、以 GitHub 作为代码交付证据层的多平台 Coding Agent Operations Control Plane。**

系统从第一天即采用：

```text
一个 Controller
    +
任意数量 Runner
    +
多个 Provider
    +
每个 Provider 下多个 Profile
    +
每个 Profile 下多个 Session / Run
```

Runner 原生支持 macOS / Windows / Linux。第一版可以让 Controller 与 macOS Runner 同机运行；代码仍必须遵守正式 Runner 接口，但同机 Embedded Mode 允许使用 in-process transport 以降低开销。后续将 Controller 搬到 NAS、Linux 小主机或服务器时，再切换为正式的 authenticated Runner Protocol，即可在不改核心领域模型的情况下同时控制多台设备。

系统的智能边界固定为：

```text
LLM：理解语言、归纳状态、处理模糊语义、给出受约束建议
程序：权限、状态、额度、路由约束、执行、资源锁、重试、交付
Coding Agent：真正修改代码、运行测试、完成任务
Human：高风险 Gate、产品/架构决策、最终人工验收（如需要）
```

最重要的设计原则是：

> **LLM 是“语义编译器”，不是 root 用户。**

---

# 1. 项目目标

## 1.1 根目标

将当前分散的 Cursor、Codex、Devin、Qoder、Kiro、WorkBuddy/CodeBuddy 等 Coding Agent 统一成一个可观察、可路由、可远程干预的执行资源池，使用户不再需要逐个打开不同 Agent、复制任务、盯运行状态、判断额度、手工恢复会话。

用户的日常交互应尽可能收敛到：

```text
Web Dashboard：系统配置、内置 LLM 对话、Fleet 实时控制面、诊断与人工接管
Slack：日常命令、通知、决策、远程干预
Linear：项目、任务、排期、依赖、进度、历史
GitHub：代码、PR、CI、Review、真实交付结果
```

Controller/Runner 对底层复杂度做统一封装。

## 1.2 成功条件

MVP 成功不是“支持尽可能多的 Agent”，而是以下闭环稳定成立：

```text
Linear Ready Task / Slack Command
        ↓
Controller 理解任务并选择 Runner + Provider + Profile
        ↓
Runner 创建隔离执行环境并启动 Agent
        ↓
Agent 持续开发 / 测试 / 修复
        ↓
状态实时进入 Fleet
        ↓
需要人工时 Slack 提醒
        ↓
用户在 Slack/Linear 回复
        ↓
同一 Session 继续
        ↓
PR + CI + 结果回写 Linear
```

同时必须满足：

1. 多个 Agent 可并行运行但不能互相污染工作目录。
2. 同一个 Task 不能因断线/重调度而被两个有效 Run 同时交付。
3. Agent 因额度耗尽停止时不能误判为任务失败。
4. Controller 能知道“哪台设备、哪个 Agent/Profile、正在做哪个项目的哪个任务、当前进行到哪一步、为什么停止”。
5. 用户可给同一 Provider 的不同账号/Profile 设置代号，并在 Slack/Linear/Fleet 中统一显示。
6. LLM 能理解自然语言，但所有执行行为都必须通过结构化工具与 Policy Engine。
7. Controller 和 Runner 可以分机部署，并可同时控制多台 macOS/Windows/Linux 设备。

---

# 2. 明确不做什么

以下内容不属于第一阶段目标，也不应因为“未来可能需要”提前实现：

```text
多 Controller 高可用
Raft / Paxos / 分布式共识
Kubernetes
Kafka
Redis Cluster
Temporal
Airflow
通用工作流编排 DSL
自建完整 CI/CD 平台
取代 Linear 的任务系统
取代 GitHub 的代码协作系统
取代 Slack 的聊天系统
自研 Coding Model
让 LLM 任意生成并执行 shell
自动 merge 所有 PR
基于 GUI 坐标点击 Terminal.app 作为主控制方式
```

如果未来出现真实需求，再新增；当前不预留复杂抽象。

---

# 3. 最终系统模型

## 3.1 总体架构

```text
                                  User
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             Web Dashboard       Slack          Linear
          Config / Fleet / AI   Remote Ops    Task Source
                    │              │              │
                    └──────────────┼──────────────┘
                                   ▼
              ┌──────────────────────────────────────┐
              │ Agent Operations Controller           │
              │                                      │
              │ Web/API Gateway                      │
              │ Configuration Engine + SecretStore   │
              │ Semantic Controller                  │
              │ Internal LLM Runtime                 │
              │ Policy Engine                        │
              │ Dispatcher / Scheduler               │
              │ Fleet Manager / Resource Monitor     │
              │ Task / Run State Engine              │
              │ Linear / Slack / GitHub Sync         │
              │ SQLite + Event Bus                   │
              └──────────────────┬───────────────────┘
                                 │
                 Embedded transport or Runner Protocol
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
  │ macOS Runner │          │Windows Runner│          │ Linux Runner│
  │ Codex × N   │          │ Cursor      │          │ CI/Test     │
  │ Qoder       │          │ WorkBuddy   │          │ Server Env  │
  │ Kiro        │          │ GUI/ETW     │          │ Codex/Qoder │
  │ CodeBuddy   │          │ ADB         │          │ ...         │
  └──────┬──────┘          └──────┬──────┘          └──────┬──────┘
         └────────────────────────┼────────────────────────┘
                                  ▼
                                GitHub
                           Branch / PR / CI
```

## 3.2 核心职责分离

### Web Dashboard

Web Dashboard 是正式控制面，而不是附属页面。

适合：

- 首次部署和 Setup Wizard。
- Agent/Profile/Runner/Integration/LLM 配置。
- 与 Configuration Assistant 对话。
- Fleet 实时观察与高信息密度查询。
- Internal LLM 手动切换、fallback 观察与恢复。
- Logs/Diagnostics/System Impact。
- 需要复杂上下文的人工干预。

不适合：

- 复制 Linear 的完整项目管理能力。
- 作为代码审查系统替代 GitHub。
- 通过高频 polling 制造伪实时体验。

### Slack

Slack 是“遥控器”，不是状态数据库。

适合：

- 发自然语言命令。
- 查看 Fleet 摘要。
- 接收 WAITING_USER / RESOURCE_BLOCKED / FAILED / REVIEW_READY 等通知。
- 给正在运行的 Agent 追加指令。
- 暂停、恢复、转派、取消任务。
- 远程进行简单决策。

不适合：

- 长期保存项目状态。
- 维护依赖关系。
- 作为代码产物证据。

### Linear

Linear 是任务事实源。

适合：

- Project / Milestone / Issue。
- 任务优先级、依赖、状态、排期。
- Task Contract。
- Agent/执行策略元数据。
- Run 摘要、PR 链接、失败原因、人工决策历史。

### GitHub

GitHub 是代码交付事实源。

适合：

- branch / commit / PR。
- diff。
- CI。
- Review。
- merge 记录。

### Controller

Controller 是“全局脑 + 控制平面”，但不是 Coding Agent。

它负责：

- 接收 Slack / Linear 事件。
- 调用便宜快速 LLM 做语义解析。
- 通过 Policy Engine 校验行为。
- 选择 Runner / Provider / Profile。
- 维护 Task / Run / Fleet / Resource 全局状态。
- 处理 quota/reset/capacity。
- 发起、停止、恢复、转派任务。
- 对 Runner 进行 fencing。
- 将状态同步到 Linear/Slack/GitHub。

### Runner

Runner 是“执行平面”。

它负责：

- 管理本机 Coding Agent 登录态。
- 创建 worktree。
- 启动 SDK/API/daemon/CLI/PTY session。
- 读取事件、stdout、usage、heartbeat。
- 向 Agent 发送后续消息。
- 运行本地验证命令。
- 提交、push、创建 PR（根据策略）。
- 缓存断线事件并在重连后 replay。

Runner 不负责全局调度。

---

# 4. 核心领域模型

最终核心对象固定为：

```text
Project
  └── Task
       └── Run
            ├── Runner
            ├── Provider
            ├── Profile
            └── Session
```

附加状态对象：

```text
RunnerState
ResourceState
TaskState
RunState
```

## 4.1 Project

来自 Linear Project。Dispatcher 不复制第二套 Project 数据库，只缓存必要 ID 与元数据。

## 4.2 Task

通常对应一个 Linear Issue。

Task 是系统主业务实体，Run 是 Task 的一次执行尝试。

例如：

```text
Task: KIS-137

Run #1
Qoder/Main
FAILED

Run #2
Cursor/Main
RUNNING
```

因此 Fleet 必须显示“当前有效 Run”，但历史 Run 不能被覆盖。

## 4.3 Provider

Provider 是 Agent 产品类别：

```text
codex
cursor
devin
qoder
kiro
codebuddy
```

## 4.4 Profile

Profile 是同一 Provider 下的独立执行资源，可以代表：

- 不同账号。
- 不同套餐。
- 不同 workspace / org。
- 不同认证状态。
- 不同额度池。
- 不同模型策略。

例如：

```text
Provider: codex

Profiles:
  codex.orion   → Pro
  codex.atlas   → Plus
  codex.nova    → Plus
```

用户只需要看到代号；真实邮箱、token、账户 ID 不应出现在 Slack/Linear。

## 4.5 Runner

Runner 是一台实际执行设备。

例如：

```text
mac-neo
windows-main
sles-ci
```

## 4.6 Session

Session 是 Provider 侧可续接的会话或本地进程会话。

必须记录 Provider 原生 session/thread ID，确保 WAITING_USER、额度恢复后可继续原 Session，而不是总是重新开始。

## 4.7 Run

Run 是“Task 在某个 Runner + Provider + Profile 上的一次具体执行”。

Run 应记录：

```text
run_id
linear_issue_id
project_id
runner_id
provider
profile_id
provider_session_id
branch
worktree
state
attempt
generation
lease_id
started_at
last_activity_at
ended_at
activity_summary
failure_reason
resource_block_reason
pr_url
verification_state
```

---

# 5. Task Contract：所有 Agent 的统一输入

最低人工介入的前提不是更强模型，而是输入与完成条件机器可判定。

每个 Task 在进入自动执行前，必须被转换为固定 Task Contract。

建议结构：

```yaml
issue: KIS-137
project: Kisu
repository: Arragon/Kisu

objective:
  summary: Implement target-language selection for selection translation.

scope:
  include:
    - src/selection/**
    - src/settings/**
    - tests/**
  exclude:
    - KCL schema
    - upstream compatibility layer

acceptance_criteria:
  - User can select target language.
  - Selection translation uses the selected language.
  - Existing default behavior remains unchanged.

verification:
  required:
    - npm test
    - npm run lint
  optional:
    - playwright test selection-language.spec.ts

constraints:
  - Do not modify database schema.
  - Do not change public API compatibility.
  - Do not modify files outside declared scope unless necessary and explained.

delivery:
  commit: true
  push: true
  create_pr: true
  merge: false

execution_policy:
  test_failure: auto_fix
  schema_change: ask_user
  dependency_upgrade: ask_user
  destructive_operation: deny

requirements:
  os: any
  capabilities: []

routing:
  preferred_agents:
    - qoder
    - cursor
  task_class: B
  autonomy: autonomous
  review_gate: ai_review
```

Task Contract 的来源可以是：

1. GPT/ChatGPT 已经拆好的 Linear issue。
2. Linear issue 本身已足够详细。
3. Semantic Controller 对自然语言命令进行结构化补全。

如果关键字段缺失且会影响正确性，Task 不应直接执行，应进入 `NEEDS_SPEC`。

---

# 6. Input Gateway

Input Gateway 统一接入：

```text
Slack Events / Commands
Linear Webhooks
Linear Poll/Reconcile
GitHub Webhooks
Runner WebSocket Events
Scheduled Resource Probes
```

所有外部输入先转换成内部 Event Envelope：

```json
{
  "eventId": "evt_...",
  "type": "linear.task.ready",
  "source": "linear",
  "receivedAt": "2026-09-15T03:10:00+08:00",
  "actor": {
    "type": "user",
    "id": "..."
  },
  "payload": {},
  "traceId": "trace_..."
}
```

Controller 的业务层不应直接依赖 Slack/Linear 原始 payload。

---

# 7. Semantic Controller：LLM 语义层

## 7.1 定位

Semantic Controller 默认使用便宜、快速、非思考或低推理模型，例如 DSV4F / Qwen3.8 Flash 一类模型；具体模型不硬编码，而必须通过 Internal LLM Runtime 的 Endpoint/Profile/Role/Fallback 体系选择。

它负责：

- 自然语言 → Typed Intent。
- 对用户命令做实体解析。
- 对未知错误做辅助分类。
- 将长 Agent 输出压缩成短 activity summary。
- 对“等待资源还是转派”给出建议。
- 对 Fleet/Project/Task 状态做自然语言回答。

它不负责：

- 自由执行 shell。
- 绕过 Policy。
- 修改真实 credential。
- 直接操作宿主机文件。
- 决定高风险架构变化。
- 自动 merge 高风险 PR。

## 7.2 固定任务链

每次 LLM 调用都使用严格链路：

```text
1. Receive typed context
2. Identify user intent / event meaning
3. Select one allowed action family
4. Return strict JSON
5. JSON Schema validation
6. Policy validation
7. Deterministic execution
8. Persist result
```

LLM 不允许自由调用任意函数。

## 7.3 Natural Language → Intent 示例

用户在 Slack：

```text
Atlas额度恢复以后继续做 LIN-183，测试失败让它自己修，
但是如果发现要改数据库 schema 就问我。
```

输入：

```json
{
  "message": "...",
  "context": {
    "taskId": "LIN-183",
    "currentProvider": "codex",
    "currentProfile": "codex.atlas",
    "taskState": "WAITING_RESOURCE"
  },
  "allowedIntents": [
    "resume_when_available",
    "set_runtime_policy",
    "request_status",
    "cancel"
  ]
}
```

LLM 只允许返回：

```json
{
  "intent": "resume_when_available",
  "taskId": "LIN-183",
  "profileId": "codex.atlas",
  "conditions": {
    "resourceState": "AVAILABLE"
  },
  "runtimePolicy": {
    "verificationFailure": "AUTO_FIX",
    "schemaChange": "ASK_USER"
  },
  "confidence": 0.98
}
```

## 7.4 Tool 白名单

Semantic Controller 可请求：

```text
fleet.query
project.query
task.query
resource.query
route.suggest
run.start
run.pause
run.resume
run.cancel
run.reroute
agent.send
linear.comment
linear.update_state
slack.notify
github.get_pr_status
verification.request
human.request
```

它不直接获得：

```text
shell.exec(raw)
filesystem.read(anywhere)
credential.read
sudo
network.post(anywhere)
git.merge
```

必要的本地命令由 Runner 的受控 Execution Harness 处理。

## 7.5 Prompt Injection 防护

以下内容一律标记为 UNTRUSTED DATA：

```text
Agent stdout/stderr
Git repository content
test output
web page content
issue attachments
第三方 API 返回的自由文本
```

Semantic Controller 的输入结构必须明确区分：

```json
{
  "trustedContext": {},
  "untrustedData": "..."
}
```

原始终端日志不应整段输入 LLM。优先 deterministic parser，必要时只截取局部片段。

即使 LLM 被 prompt injection 影响，它也只能请求 Tool 白名单动作，最终仍经过 Policy Engine。

---

# 8. Policy Engine

Policy Engine 是系统最终权限裁决层，必须完全确定性。

## 8.1 主要 Policy

```text
谁可以启动任务
谁可以取消任务
哪些 Task Class 可自动转派
哪些变更必须人工确认
哪些 Provider 可用于哪些项目
哪些 Profile 必须保留额度
哪些 Runner 可执行哪些任务
是否允许创建 PR
是否允许 push
是否允许自动修测试
是否允许修改 schema
是否允许 dependency upgrade
是否允许执行特定命令
```

## 8.2 示例配置

```yaml
routing:
  class_A:
    prefer: [codex, devin]
    auto_reroute: false

  class_B:
    prefer: [qoder, cursor, codex]
    auto_reroute: true

  class_C:
    prefer: [qoder, cursor, kiro]
    auto_reroute: true

risk_rules:
  data_migration:
    prefer: [devin, codex]
    human_gate: true

  schema_change:
    human_gate: true

  destructive_fs:
    deny: true

resources:
  codex.orion:
    reserve_for: [A, review, escalation]

  qoder.main:
    min_remaining_reserve: 1000

reroute:
  class_C:
    allowed_if_progress_below: 0.30
    allowed_if_blocked_minutes_above: 90

  class_A:
    allowed: false
```

---

# 9. Dispatcher / Scheduler

Dispatcher 是 Controller 内部模块，不是系统本体。

路由顺序：

```text
Task
 ↓
Task requirements
 ↓
Eligible Runners
 ↓
Eligible Providers
 ↓
Eligible Profiles
 ↓
Resource / quota / capacity filter
 ↓
Policy ranking
 ↓
Cost / preference / recent performance ranking
 ↓
Selected Runner + Provider + Profile
```

## 9.1 Runner 选择

任务声明 requirements：

```yaml
requirements:
  os: windows
  capabilities:
    - etw
    - gui
```

Runner 注册 capabilities：

```json
{
  "runnerId": "windows-main",
  "platform": "windows",
  "arch": "x64",
  "capabilities": ["gui", "browser", "powershell", "etw", "android-adb"],
  "tags": ["powerful", "hardware"],
  "capacity": 3
}
```

Scheduler 自动匹配，不建议在 Linear issue 里直接写死设备名。

仅特殊任务允许：

```yaml
runner_affinity: windows-main
```

## 9.2 Provider 选择

Provider 选择参考：

- Task Class。
- 风险类型。
- 项目历史成功率。
- Agent 当前并发。
- ResourceState。
- 当前促销额度/预算策略。
- Session 连续性。
- 环境适配度。

## 9.3 Profile 选择

同一 Provider 下可有多个 Profile。

例如：

```text
codex.orion
codex.atlas
codex.nova
```

Linear/Slack 可展示代号，但 Profile 的真实认证信息只存在 Runner secret store。

Profile 不应被设计成“一个额度耗尽后自动轮另一个账户以规避平台限制”的 rotation 机制。它只表示合法独立的执行资源；具体使用必须遵守相应服务条款。

---

# 10. Fleet Manager

Fleet 是系统实时控制面，而不是“额度表”。

它必须同时回答：

```text
有哪些 Runner 在线？
每台 Runner 上有哪些 Agent/Profile？
每个 Profile 当前可不可用？
每个 Agent 正在做哪些 Project / Task？
每个 Run 当前处于什么状态？
最近在做什么？
哪里需要人工介入？
哪些任务因额度阻塞？
哪些任务疑似卡死？
哪些任务已经进入 Review？
```

## 10.1 Fleet Manager 内部拆分

```text
Fleet Manager
├── Resource Registry
│   Provider/Profile 额度、reset、健康、并发
├── Workload Registry
│   Runner/Profile → Project/Task/Run 映射
├── Runtime Monitor
│   Run 活动、心跳、停滞、问题、结果
└── Fleet View
    面向 Slack/CLI/未来 Web UI 的查询聚合
```

## 10.2 三种主视角

### By Agent/Profile

```text
@Dispatcher agent Orion
```

应返回：

```text
Codex Orion · Pro
Resource: AVAILABLE
Slots: 2 / 3
5h: 63% remaining
Weekly: 81% remaining
Runner: mac-neo

Current:
RHZ-91 · Rhiza · RUNNING · 47m
ALR-18 · Adaptive LLM Router · VERIFYING · 1h12m

Queue:
KIS-151 · Class A
```

### By Project

```text
@Dispatcher project Rhiza
```

应返回：

```text
RHZ-91 · Codex Orion · RUNNING
RHZ-94 · Devin Main · WAITING_USER
RHZ-96 · Qoder Main · QUEUED
RHZ-88 · Cursor Main · REVIEW
```

### By Task

```text
@Dispatcher task KIS-137
```

应返回当前 Run、历史尝试、PR、阻塞原因、Session、活动摘要等。

## 10.3 Activity Summary

Fleet 不应该只显示 `RUNNING`。

还应显示短 activity summary：

```text
RUNNING
Implementing OAuth callback validation

VERIFYING
pytest 311/312; fixing one regression

WAITING_USER
Needs decision on DB schema migration
```

Activity summary 可由 Semantic Controller 根据结构化事件生成，但状态本身由状态机决定。

## 10.4 Stall Detection

如果 Run 标记 RUNNING，但连续一段时间没有 meaningful activity，应进入：

```text
SUSPECTED_STALL
```

Meaningful activity 包括：

- Provider heartbeat。
- tool event。
- stdout/stderr activity。
- file modification。
- process CPU activity（仅辅助）。
- verification progress。

通知示例：

```text
🟡 KIS-137 may be stalled
Agent: Qoder Main
No meaningful activity for 34 minutes.
Last event: npm test started
```

---

# 11. Resource Monitor：额度、限流与可用性

不同 Agent 的可观察能力不同，所以统一模型必须支持 source + confidence，而不是伪造精度。

## 11.1 ResourceState

```ts
type Availability =
  | "AVAILABLE"
  | "LOW"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "WAITING_RESET"
  | "AUTH_ERROR"
  | "PROVIDER_DOWN"
  | "UNKNOWN";

interface ResourceState {
  profileId: string;
  availability: Availability;

  usage?: {
    remaining?: number;
    total?: number;
    percentage?: number;
    unit?: string;
  };

  limits?: Array<{
    name?: string;
    window?: string;
    resetsAt?: string;
  }>;

  reason?: string;

  source:
    | "OFFICIAL_API"
    | "SDK"
    | "CLI"
    | "SESSION_EVENT"
    | "ERROR_PARSER"
    | "ESTIMATED";

  confidence: "HIGH" | "MEDIUM" | "LOW";
  checkedAt: string;
}
```

## 11.2 多信号策略

每个 Provider Adapter 按优先级尝试：

```text
Official API / SDK
    ↓
Daemon / ACP
    ↓
Structured headless CLI output
    ↓
Provider session events
    ↓
Known error parser
    ↓
Scheduled health probe
    ↓
UNKNOWN
```

绝不因为某 Provider 无公开 usage API 就伪造“剩余 37%”。

## 11.3 Reset 处理

额度耗尽：

```text
RUNNING
  ↓
RESOURCE_BLOCKED
  ↓
WAITING_RESOURCE
```

记录：

```text
profile_id
reason
expected_reset_at
resume_policy
provider_session_id
```

到达 expected_reset_at 后不能直接宣布恢复，而应：

```text
scheduled probe
    ↓
confirmed usable
    ↓
ResourceState = AVAILABLE
    ↓
resume eligible run
```

Slack：

```text
🔴 Codex · Atlas 暂不可用
原因：5h usage limit reached
受影响：LIN-183
预计恢复：04:12
Session preserved
```

恢复后：

```text
🟢 Codex · Atlas 已恢复可用
LIN-183 已可继续
```

## 11.4 额度阻塞不是失败

严格区分：

```text
FAILED
RESOURCE_BLOCKED
RUNNER_UNAVAILABLE
WAITING_USER
```

否则统计会失真，也会导致错误自动转派。

---

# 12. Execution Harness：如何控制 Agent

主原则：

> 不要以“看 Terminal.app 窗口并模拟键盘”为主方案。

统一优先级：

```text
1. 官方 API / SDK
2. daemon / ACP / local service
3. structured headless CLI
4. PTY / tmux
5. GUI terminal automation（仅极端兜底，原则上不实现）
```

## 12.1 统一 AgentAdapter

```ts
interface AgentAdapter {
  start(input: StartRunInput): Promise<StartRunResult>;
  send(sessionId: string, message: string): Promise<void>;
  pause?(sessionId: string): Promise<void>;
  resume?(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  status(sessionId: string): Promise<AgentSessionStatus>;
  usage?(profileId: string): Promise<ResourceState>;
  result(sessionId: string): Promise<RunResult>;
}
```

## 12.2 PTY/tmux 的定位

如果某 Agent 只有交互式 CLI，Runner 可使用 `node-pty` 管理伪终端。

可选叠加 tmux，便于维护者人工 attach：

```text
tmux session: agent-KIS-137-atlas
```

Controller/Runner 不依赖 terminal tab、窗口坐标或 GUI focus。

---

# 13. Provider / Profile 设计

## 13.1 Codex

### 多 Profile

多个合法独立 Codex CLI 登录态通过隔离状态目录管理：

```text
~/.codex-profiles/orion
~/.codex-profiles/atlas
~/.codex-profiles/nova
```

映射：

```text
codex.orion → CODEX_HOME=.../orion
codex.atlas → CODEX_HOME=.../atlas
codex.nova  → CODEX_HOME=.../nova
```

每个 Profile 单独登录，不复制认证文件。

### Fleet 展示

```text
Agent: Codex
Profile: Orion
Plan: Pro
Runner: mac-neo
State: RUNNING
```

### 额度监控

Codex Adapter 支持多信号：

- 结构化 rate-limit 事件（如可读取）。
- 可解析状态输出。
- Provider 错误文本。
- reset 时间。
- reset 后 probe。

具体接口随 Codex 当前版本变化，应封装在 adapter 内，禁止业务层直接解析 Codex 私有日志格式。

## 13.2 Cursor

支持两种 backend：

```text
cursor-native / cloud
cursor-local / cli
```

若使用原生 Linear delegation，Controller 可只负责发 delegation 并观察状态；若使用本机 CLI，则由 Runner 管理 worktree、进程和 session。

## 13.3 Devin

优先使用官方 API / 原生 Linear 集成。

重点标准化：

- session 创建。
- waiting_for_user。
- usage/out_of_quota。
- max task/session budget。
- PR/result 链接。

## 13.4 Qoder

优先本机 SDK / headless CLI，以使用已购订阅资源；Cloud Agent 可作为可选 backend。

重点支持：

- 长任务持续执行。
- session 继续。
- usage/credits。
- structured events。

## 13.5 Kiro

优先 headless CLI / GitHub 触发方式。

如果 usage 只能通过交互命令读取，则使用 PTY adapter，并输出统一 ResourceState。

## 13.6 WorkBuddy / CodeBuddy

优先 daemon / local service / ACP 类接口。

该 Provider 适合：

- Windows 本机。
- GUI / 浏览器。
- 硬件。
- 内网。
- 需要手机 remote control 的会话。

## 13.7 Generic CLI Adapter

必须提供一个受限 Generic CLI Adapter，便于未来接入新的 Agent：

```yaml
provider: example
command: example-agent
mode: pty
start_args: ["--task", "${TASK_FILE}"]
resume_strategy: session_id
usage_probe: null
```

但 Generic Adapter 不允许自动获得全权限；新 Provider 默认 capability 最小化。

---

# 14. Runner Architecture

## 14.1 Runner 组成

```text
Runner
├── Registration / Heartbeat
├── Capability Detector
├── Profile Registry
├── Process / PTY Manager
├── Agent Adapters
├── Workspace Manager
├── Verification Runner
├── Git / PR Client
├── Local Resource Probe
├── Local Journal
└── Secret Store Adapter
```

## 14.2 Runner 注册

示例：

```json
{
  "runnerId": "mac-neo",
  "platform": "macos",
  "arch": "arm64",
  "version": "0.1.0",
  "capabilities": [
    "browser",
    "xcode",
    "ios",
    "local-agent"
  ],
  "tags": ["always-on", "cheap", "personal"],
  "profiles": [
    "codex.orion",
    "codex.atlas",
    "codex.nova",
    "qoder.main",
    "kiro.main",
    "codebuddy.mac"
  ],
  "capacity": 5
}
```

## 14.3 Runner Tags

Tags 用于调度偏好，而不是硬需求。

例如：

```text
mac-neo:
  always-on
  cheap
  personal

windows-main:
  powerful
  gpu
  gui
  hardware

sles-ci:
  isolated
  server
  ci
```

Task 可以声明：

```yaml
prefer_runner_tags:
  - isolated
avoid_runner_tags:
  - expensive
```

## 14.4 跨平台服务

Runner 必须支持：

```text
macOS   → launchd
Windows → Windows Service
Linux   → systemd
```

统一 CLI：

```text
agent-runner install
agent-runner start
agent-runner stop
agent-runner restart
agent-runner status
agent-runner doctor
agent-runner logs
```

---

# 15. Runner Protocol

## 15.1 通信方式

第一版采用：

```text
Runner 主动连接 Controller
WebSocket + TLS
```

原因：

- NAT 简单。
- Runner 无需开放入站端口。
- heartbeat 和 event streaming 自然。
- 便于笔记本切换网络。
- steering 简单。
- reconnect 简单。

同局域网可以直连；跨网络建议通过 Tailscale/WireGuard 类安全网络，不要求 Controller 主动 SSH Runner。

## 15.2 Message Envelope

```json
{
  "protocolVersion": "1",
  "messageId": "msg_...",
  "runnerId": "mac-neo",
  "type": "run.state",
  "seq": 735,
  "sentAt": "2026-09-15T03:20:00+08:00",
  "payload": {}
}
```

## 15.3 Controller → Runner RPC

第一版只需要：

```text
run.start
run.send_input
run.pause
run.resume
run.cancel
run.status
run.tail_log
resource.probe
runner.health
workspace.cleanup
```

## 15.4 Runner → Controller Events

```text
runner.registered
runner.heartbeat
runner.degraded
run.started
run.activity
run.waiting_user
run.resource_blocked
run.verifying
run.completed
run.failed
resource.updated
pr.created
journal.replay
```

---

# 16. Lease、Generation 与 Fencing

多 Runner 系统从第一版就必须防止同一 Task 被两个有效 Run 同时交付。

Controller 创建 Run 时发放：

```json
{
  "runId": "run_83",
  "leaseId": "lease_991",
  "generation": 3,
  "expiresAt": "..."
}
```

Runner 在关键动作中必须携带 generation：

- 更新 terminal state。
- push branch。
- 创建 PR。
- 标记 COMPLETE。
- 交付 artifact。

如果 Task 被重新调度：

```text
generation 3 → 4
```

旧 Runner 即使断线后恢复，generation 3 的 delivery 也必须被 Controller 拒绝。

这是多 Runner 的第一性安全机制，比复杂分布式锁更重要。

---

# 17. Runner Local Journal 与断线恢复

Controller 是 Task State 的权威；Runner 是 Runtime State 的权威。

如果 Controller 断线：

- Runner 已启动的 Agent 不应被杀掉。
- Runner 继续执行。
- 所有重要事件写入 `runner-events.sqlite` 或 append-only journal。

重连：

```text
Controller last ack = 730
Runner local seq = 735
→ replay 731..735
```

如果 Runner 掉线：

```text
RunnerState = OFFLINE
TaskState ≠ FAILED
RunState = RUNNER_UNAVAILABLE
```

Runner 恢复后 Controller 执行 reconcile：

- session 是否仍存在？
- process 是否仍运行？
- branch 是否变化？
- PR 是否已创建？
- lease/generation 是否仍有效？

---

# 18. Workspace Manager

每个本地 Run 必须使用独立 worktree。

推荐：

```text
~/agent-runner/
├── repos/
│   ├── kisu/
│   ├── rhiza/
│   └── workflow-manager/
│
├── worktrees/
│   ├── KIS-137-qoder-run83/
│   ├── KIS-138-cursor-run84/
│   └── RHZ-91-codex-run85/
│
├── state/
├── logs/
└── journal/
```

Workspace Manager 负责：

```text
repo prepare
fetch
base revision check
create worktree
branch naming
scope path check
cleanup
stale worktree detection
```

多个 Agent 不允许共享同一个可写 checkout。

---

# 19. State Machines

## 19.1 TaskState

建议：

```text
BACKLOG
READY
QUEUED
RUNNING
WAITING_USER
WAITING_RESOURCE
VERIFYING
REVIEW
DONE
CANCELLED
FAILED
```

`NEEDS_SPEC` 可作为 READY 前状态。

## 19.2 RunState

```text
CREATED
STARTING
ACTIVE
WAITING_USER
RESOURCE_BLOCKED
RUNNER_UNAVAILABLE
SUSPECTED_STALL
VERIFYING
DELIVERING
COMPLETE
FAILED
CANCELLED
SUPERSEDED
```

## 19.3 RunnerState

```text
ONLINE
DEGRADED
DRAINING
OFFLINE
```

## 19.4 ResourceState

```text
AVAILABLE
LOW
RATE_LIMITED
QUOTA_EXHAUSTED
WAITING_RESET
AUTH_ERROR
PROVIDER_DOWN
UNKNOWN
```

## 19.5 关键转换

### 额度耗尽

```text
Run ACTIVE
  ↓
RESOURCE_BLOCKED
  ↓
Task WAITING_RESOURCE
  ↓
Resource WAITING_RESET
  ↓
probe succeeds
  ↓
Resource AVAILABLE
  ↓
Run ACTIVE / RESUMED
```

### 需要人工

```text
Run ACTIVE
  ↓
WAITING_USER
  ↓
Slack alert
  ↓
User reply
  ↓
Policy validation
  ↓
agent.send
  ↓
ACTIVE
```

### 自动转派

```text
Run FAILED / RESOURCE_BLOCKED
  ↓
Policy permits reroute
  ↓
old Run SUPERSEDED
  ↓
generation++
  ↓
new Run CREATED
```

---

# 20. Linear Integration

## 20.1 角色

Linear 是 Source of Truth，不需要再建第二套任务表。

Controller 缓存 ID、状态与必要字段，但不把本地 DB 变成新的 PM 系统。

## 20.2 推荐元数据

尽量使用 Label Group / 原有字段表达：

```text
Agent
  Auto
  Codex
  Cursor
  Devin
  Qoder
  Kiro
  CodeBuddy

Task Class
  A
  B
  C

Execution
  Autonomous
  Supervised
  Local

Gate
  No Gate
  AI Review
  Human Review

Window
  W1
  W2
  W3
  W4
  Later
```

Profile 不一定需要做成 Linear label；可由 Dispatcher 作为 run metadata/comment 展示，防止标签爆炸。

## 20.3 Task Contract 存储

推荐：

- 核心目标与 Acceptance Criteria 直接写 issue description。
- Dispatcher-specific metadata 放固定 fenced YAML 区块或结构化附件。
- Run 历史通过 comments / links / Controller DB 关联。

## 20.4 状态回写

Controller 应回写：

- 当前 Agent/Profile。
- 当前 Runner。
- Run state。
- Activity summary。
- WAITING_USER 原因。
- WAITING_RESOURCE 原因/reset。
- PR URL。
- verification summary。
- escalation history。

避免把 token 级日志倒进 Linear。

---

# 21. Slack Integration

## 21.1 Slack 的最终定位

```text
Slack = command + notification + intervention bus
```

不需要为每个 Agent 安装独立 Slack App。理想状态只有一个主要 Bot：

```text
@Dispatcher
```

## 21.2 主要命令

LLM 支持自然语言，因此命令不需要死记；底层 typed intents 包括：

```text
fleet
agent <profile>
project <project>
task <issue>
waiting
stalled
review
quota
run <issue> [agent/profile]
resume <issue>
pause <issue>
cancel <issue>
reroute <issue> <agent/profile>
reply <issue> <message>
```

自然语言示例：

```text
现在谁闲着？
Kisu 现在有哪些任务在跑？
Qoder 正在做什么？
今天有哪些任务因为额度停了？
把 LIN-138 给 Qoder，schema 变更要问我。
Atlas 恢复额度以后继续之前的任务。
```

## 21.3 通知级别

默认只推高价值事件：

```text
WAITING_USER
RESOURCE_BLOCKED
RESOURCE_RECOVERED
FAILED
ESCALATED
SUSPECTED_STALL
REVIEW_READY
RUNNER_OFFLINE
```

普通 progress 不刷屏。

---

# 22. GitHub / Delivery

标准交付链：

```text
Agent changes
  ↓
verification
  ↓
commit
  ↓
push branch
  ↓
create PR
  ↓
CI
  ↓
Linear REVIEW
```

PR 创建前应满足：

- 当前 Run generation 仍有效。
- 分支归属当前 Run。
- 必需 verification 已执行或明确记录跳过原因。
- 无越界文件修改，或已有说明。
- 没有检测到明显秘密泄露。

默认 `merge: false`。

自动 merge 必须作为后续可选策略，不进入 MVP。

---

# 23. Security Model

## 23.1 Runner 用户隔离

Coding Agent 不应运行在包含用户全部私人数据与高权限密钥的主账户下。

推荐建立专用执行用户/环境，只给：

```text
worktrees
必要 repo
最小 GitHub 凭据
各 Provider 登录态
Runner 所需网络权限
```

不默认给：

```text
sudo
私人 Documents/Desktop
照片
主浏览器 Profile
主 SSH 私钥
系统级配置写权限
```

## 23.2 Secret Storage

Controller 与 Runner 分离 secrets：

Controller：

- Linear token/webhook secret。
- Slack bot token/signing secret。
- GitHub App/API 凭据（如 Controller 需要）。
- Semantic LLM API key。

Runner：

- Provider 登录态。
- Provider API token（仅本地 Provider 需要时）。
- Repo access credential（尽量细粒度）。

## 23.3 Raw shell

LLM 不拥有 raw shell。

Runner 可提供：

```text
verification.run(command_id)
workspace.exec(approved_command_id)
```

命令来自项目配置白名单，而不是 LLM 自由字符串。

若必须开放有限自由命令：

- cwd 必须位于当前 worktree。
- 禁止 sudo。
- 禁止访问 worktree 外路径。
- 高风险 token/regex/AST 检测。
- 危险命令人工 Gate。

---

# 24. Persistent Storage

第一版 Controller 使用 SQLite 足够。

不引入 PostgreSQL/Redis，除非真实并发和可靠性需求证明需要。

## 24.1 主要表

```text
projects_cache
tasks
runs
run_events
runners
runner_sessions
providers
profiles
resource_states
leases
user_decisions
notifications
llm_interactions
routing_decisions
```

## 24.2 推荐关键字段

### tasks

```text
id
linear_issue_id
project_id
state
class
execution_mode
gate
contract_json
current_run_id
created_at
updated_at
```

### runs

```text
id
task_id
attempt
runner_id
provider
profile_id
provider_session_id
state
generation
lease_id
branch
worktree_path
activity_summary
last_activity_at
failure_reason
resource_block_reason
pr_url
started_at
ended_at
```

### profiles

```text
id
provider
display_name
runner_id
plan_label
max_parallel
enabled
config_json
```

### resource_states

```text
profile_id
availability
usage_json
limits_json
source
confidence
reason
checked_at
```

### run_events

只存结构化事件，不要求存完整 token stream。

---

# 25. Observability

## 25.1 需要记录的指标

不要只统计 token/credits。真正有决策价值的是：

```text
tasks_started
tasks_completed
first_pass_success
human_intervention_count
reroute_count
retry_count
verification_failure_count
resource_block_minutes
runtime_minutes
review_reject_count
provider_error_count
stalled_count
```

按：

```text
provider
profile
project
task_class
runner
```

聚合。

## 25.2 长期可回答的问题

系统应能回答：

```text
Qoder 在 Kisu 最近 30 天的一次通过率如何？
哪个 Agent 最容易因额度停？
哪些 Profile 的可用时间最稳定？
哪些 Runner 经常离线？
哪些 Agent 在 UI 任务最省人工？
Class A 任务由 Devin 与 Codex 的真实差异是什么？
本月哪一个促销套餐真正换来了最多可合并 PR？
```

这才是 Dispatcher 长期价值，而不是仅靠社区评价分 Agent。

---

# 26. Failure Handling

## 26.1 分类优先于重试

失败必须先分类：

```text
RESOURCE
AUTH
PROVIDER_OUTAGE
RUNNER
SESSION
BUILD
TEST
SPEC_AMBIGUITY
POLICY_BLOCK
AGENT_ERROR
UNKNOWN
```

不能所有错误都“再跑一次”。

## 26.2 默认策略

```text
RESOURCE → 等待 reset 或按 policy 转派
AUTH → 停止并通知
PROVIDER_OUTAGE → backoff / optional reroute
RUNNER → 等待 runner reconnect / optional reroute
TEST → Agent 自动修复，次数受限
SPEC_AMBIGUITY → WAITING_USER
POLICY_BLOCK → WAITING_USER
UNKNOWN → 最多一次保守重试，然后 escalation
```

## 26.3 Session 连续性优先

若任务已经完成大部分工作，Profile 因额度暂时阻塞，默认更倾向：

```text
保留 session
等待 resource 恢复
继续同一 session
```

而不是立即换 Agent 从零开始。

是否自动转派由 task class、progress、预计等待时间、资源成本共同决定。

---

# 27. Multi-Platform Deployment

## 27.1 支持矩阵

Controller：

```text
Linux   ✅ 推荐长期部署
macOS   ✅
Windows ✅
```

Runner：

```text
macOS   ✅ 一级支持
Windows ✅ 一级支持
Linux   ✅ 一级支持
```

## 27.2 部署拓扑 A：单机开发

```text
Mac
├── Controller
└── Runner
```

二者仍通过 localhost WebSocket，不允许直接调用内部函数绕过协议。

用途：MVP 开发、调试。

## 27.3 部署拓扑 B：Controller 独立

```text
NAS/Linux mini PC
└── Controller

MacBook Neo
└── Runner
```

优点：

- Mac 重启不影响 Slack/Linear 控制面。
- Controller 更稳定。
- Mac 只运行真实 Agent。
- 权限边界更清晰。

## 27.4 部署拓扑 C：多 Runner

```text
Controller
├── mac-neo
├── windows-main
└── sles-ci
```

不同任务自动匹配执行环境。

---

# 28. 推荐技术栈与复用边界

保持单语言优先、后台轻量、前端静态化。

## 28.1 核心运行时

```text
Node.js current LTS
TypeScript strict
Fastify（或经基准证明更轻的同类 HTTP server）
Zod / JSON Schema
SQLite WAL
最小内部队列或 p-queue
Git subprocess wrapper / simple-git（按实测选择）
```

Runner 双向远程通信使用 authenticated WebSocket；Embedded Runner 使用 in-process transport；Dashboard 实时状态优先 SSE。

## 28.2 Web

```text
Vite + React static SPA
shadcn/ui
TanStack Query
TanStack Table + Virtual
react-jsonschema-form
Tremor（KPI/低频 dashboard 图表，按需）
uPlot（只有高频时间序列确有需求时）
```

不采用常驻 SSR 作为默认部署要求。

## 28.3 Agent 执行

```text
官方 SDK/API 优先
daemon/ACP 次之
structured headless CLI 次之
node-pty / tmux 兜底
GUI 坐标自动化不作为正式 Adapter backend
```

## 28.4 Observability

```text
Pino → structured logs
SQLite → normalized metadata/events
rotating files → raw stdout/stderr
OpenTelemetry API/instrumentation → 可内置
OTel exporter/collector → 默认关闭、按需启用
```

## 28.5 Internal LLM

常用协议优先轻量原生 adapter；LiteLLM 作为可选 long-tail gateway，不是 Mac 默认强依赖 sidecar。核心 fallback/safe-switch/health 状态由 Dispatcher 自己掌握。

## 28.6 为什么暂不切 Go/Rust

Runner 的主要复杂度来自 Provider SDK、CLI、PTY、平台服务和工程集成，而不是计算吞吐。TypeScript 可以共享 Controller/Runner/Protocol/Adapter/Web 的类型和 Schema。

只有出现明确证据，例如 Windows service 长期不稳定、Node 内存预算实际超标、单文件分发成为强需求、PTY/进程管理出现无法接受的问题，再评估将 Runner 内核迁移 Go/Rust。

---

# 29. 推荐 Monorepo 结构

```text
agent-dispatcher/
├── apps/
│   ├── controller/
│   └── web/
│
├── packages/
│   ├── domain/
│   ├── protocol/
│   ├── runner/
│   │   ├── core/
│   │   └── platform/
│   │       ├── macos/
│   │       ├── windows/
│   │       └── linux/
│   ├── adapters/
│   │   ├── codex/
│   │   ├── qoder/
│   │   ├── cursor/
│   │   ├── devin/
│   │   ├── kiro/
│   │   ├── codebuddy/
│   │   └── generic-cli/
│   ├── config/
│   │   ├── engine/
│   │   ├── manifest/
│   │   ├── schemas/
│   │   └── secret-store/
│   ├── llm-runtime/
│   │   ├── protocols/
│   │   ├── profiles/
│   │   ├── health/
│   │   └── routing/
│   ├── semantic/
│   ├── policy/
│   ├── scheduler/
│   ├── fleet/
│   ├── workspace/
│   ├── persistence/
│   ├── observability/
│   └── integrations/
│       ├── linear/
│       ├── slack/
│       └── github/
│
├── docs/
├── tests/
└── package.json
```

依赖方向必须保持单向；`domain` 与 `protocol` 不依赖 Web、具体 Agent SDK 或外部集成。

---

# 30. 配置模型：Canonical Store，而不是 YAML 为真相

## 30.1 原则

正式配置由 Controller 的 Canonical Config Store 管理。用户默认通过 Dashboard/Configuration Assistant 修改；CLI 提供恢复、导入、导出和自动化接口。

```text
Web GUI ─┐
AI Assistant ─┼→ Configuration Engine → Canonical Config Store
CLI ──────┘                              │
                                          └→ SecretStore references
```

YAML/JSON 只作为 import/export 形式，不是运行期唯一事实源。

## 30.2 示例导出（无 Secret）

```yaml
controller:
  id: home-controller
  listen: 127.0.0.1:8347
  deployment_mode: embedded

internal_llm:
  global_default: alice-qwen
  role_pools:
    command_parser: semantic-primary
    config_assistant: semantic-primary
    runtime_summarizer: cheap-pool

llm_endpoints:
  - id: alibaba-main
    protocol: openai-chat-compatible
    base_url: https://example.invalid/v1
    credential_ref: secret://llm/alibaba-main

llm_profiles:
  - id: alice-qwen
    endpoint: alibaba-main
    model: qwen3.8-flash
    temperature: 0

runners:
  - id: mac-neo
    mode: embedded
    capacity: 5
    tags: [always-on, personal]

agent_profiles:
  - id: codex.orion
    provider: codex
    display_name: Orion
    runner: mac-neo
    settings:
      codex_home: /Users/agent-runner/.codex-profiles/orion

  - id: qoder.alice
    provider: qoder
    display_name: Alice
    runner: mac-neo
    backend: sdk
```

`credential_ref` 永远指向 SecretStore。

## 30.3 配置来源优先级

运行时配置冲突按明确优先级解决：

```text
safe runtime override（临时、可过期）
→ Canonical Config Store
→ deployment bootstrap env
→ built-in defaults
```

环境变量只用于 bootstrap/secret reference 等部署需要，不作为长期人工配置主界面。

---

# 31. Controller API / Internal Commands

第一阶段按领域分组，不追求公开通用平台 API：

```text
GET  /health
GET  /fleet
GET  /runners
GET  /profiles
GET  /tasks/:id
GET  /runs/:id

POST /tasks/:id/run
POST /runs/:id/message
POST /runs/:id/pause
POST /runs/:id/resume
POST /runs/:id/cancel
POST /runs/:id/reroute

GET  /config
POST /config/plans
POST /config/plans/:id/apply
POST /config/plans/:id/rollback

GET  /llm/runtime
POST /llm/profiles/:id/test
POST /llm/roles/:role/switch
POST /llm/pools/:id/order

POST /discovery/agents
POST /integrations/:id/test
```

Web 的实时 Fleet 使用独立 SSE event stream；Runner 使用独立 authenticated protocol endpoint，不与普通 Dashboard API 混为一套权限面。

---

# 32. 典型端到端工作流

## 32.1 Linear Auto Dispatch

```text
Linear issue
State = Ready
Agent = Auto
        ↓
Webhook
        ↓
Controller loads Task Contract
        ↓
Semantic normalization if needed
        ↓
Policy Engine
        ↓
Scheduler
        ↓
mac-neo + qoder.main
        ↓
Runner creates worktree
        ↓
Qoder session
        ↓
Fleet RUNNING
        ↓
verification
        ↓
PR
        ↓
Linear REVIEW
        ↓
Slack REVIEW_READY
```

## 32.2 Slack-first

```text
User:
“把 KIS-137 交给 Qoder，测试失败让它自己修，schema 变更问我。”
        ↓
Semantic Controller
        ↓
Typed Intent
        ↓
Policy
        ↓
Update Linear Task Contract / runtime policy
        ↓
Start Run
```

## 32.3 Agent 需要决策

```text
Agent detects schema issue
        ↓
Runner normalized event
        ↓
Run WAITING_USER
        ↓
Linear comment
        ↓
Slack alert
        ↓
User replies in thread
        ↓
Semantic Controller → typed instruction
        ↓
Policy
        ↓
Runner → agent.send
        ↓
same session ACTIVE
```

## 32.4 额度耗尽

```text
Codex Atlas hits limit
        ↓
Resource Monitor
        ↓
Profile WAITING_RESET
Run RESOURCE_BLOCKED
Task WAITING_RESOURCE
        ↓
Slack alert
        ↓
Scheduled probe at/after reset
        ↓
AVAILABLE confirmed
        ↓
Slack recovery notification
        ↓
Resume same session by policy
```

## 32.5 Runner 掉线

```text
mac-neo heartbeat lost
        ↓
Runner OFFLINE
Runs RUNNER_UNAVAILABLE
Tasks not FAILED
        ↓
Slack alert if prolonged
        ↓
Runner reconnect
        ↓
Journal replay + reconcile
        ↓
resume states
```

---


# 32A. Web Dashboard：正式控制面

## 32A.1 定位

Web Dashboard 不是附加管理页，而是 Dispatcher 的正式人机控制面。Controller 是后台服务；用户对系统的配置、观察、LLM 交流、Fleet 管理、故障诊断和人工接管，默认都通过浏览器完成。

四个主要入口职责固定为：

```text
Web Dashboard  系统配置 / Fleet / LLM / Diagnostics / 高信息密度操作
Slack          移动端遥控 / 异常通知 / 快速决策
Linear         Project / Task / Milestone / Dependency / Task Contract
GitHub         Branch / Commit / PR / CI / Review
```

Linear 不承担 Dispatcher 自身配置；Slack 不保存长期系统状态；GitHub 不承担排产；Dashboard 不复制 Linear 的完整项目管理能力。

## 32A.2 Dashboard 页面结构

第一版信息架构固定为：

```text
Overview / Fleet
Tasks & Runs
Runners
Agents & Profiles
Internal LLM
Integrations
Policies
Logs & Diagnostics
Settings
```

右侧全局常驻但可收起的 `Configuration Assistant` Drawer 在所有页面可调用，并自动获得当前页面、选中对象、最近一次错误和当前配置草稿的结构化上下文。

## 32A.3 Overview / Fleet

Fleet 必须同时回答：

1. 哪些 Runner 在线、降级、排空或离线。
2. 每个 Runner 上有哪些 Provider/Profile。
3. 每个 Profile 当前资源状态、额度、reset、并发占用。
4. 每个 Agent 正在执行哪个 Project 的哪个 Task。
5. Run 当前是 RUNNING、VERIFYING、WAITING_USER、WAITING_RESOURCE、REVIEW、DONE 还是 FAILED。
6. 当前 activity summary、持续时间、最后有意义活动时间。
7. 哪些 Run 疑似 stall。
8. 哪些 PR 已创建并等待 review。
9. Internal LLM 当前实际 serving profile、是否发生 failover。
10. 哪些异常真正需要用户介入。

建议首屏构成：

```text
┌────────────────────────────────────────────────────────────┐
│ Fleet summary / Need attention / System impact             │
├───────────────────────┬────────────────────────────────────┤
│ Runners               │ Active runs                        │
│ mac-neo   online      │ RHZ-91  Orion  VERIFYING           │
│ win-main  online      │ KIS-44  Alice  RUNNING             │
│ linux-ci  offline     │ ...                                │
├───────────────────────┼────────────────────────────────────┤
│ Resource / Quota      │ Projects                           │
│ Atlas   reset 04:12   │ Rhiza  3 active / 1 review         │
│ Qoder   8.7k credits  │ Kisu   2 active / 1 blocked        │
├───────────────────────┴────────────────────────────────────┤
│ Recent events / failovers / stalls / PR ready              │
└────────────────────────────────────────────────────────────┘
```

Fleet 默认实时更新采用事件流，不做 1 秒级 HTTP 轮询。

## 32A.4 Dashboard 通信模式

推荐：

```text
普通查询 / 配置 / 命令   HTTP REST/RPC
Dashboard 实时状态       SSE
Runner 双向控制          WebSocket
大日志查看               分页/范围读取 + tail stream
```

Dashboard 关闭时不得为了 UI 保持额外高频计算。

## 32A.5 前端性能规则

- 使用静态 SPA，不要求 Next.js/SSR 常驻服务。
- 路由级 lazy-load。
- Fleet 表格使用虚拟化。
- 高频日志不进入全局 React state。
- 服务端只推送增量状态事件。
- 图表默认低频聚合；真正高频时间序列才使用轻量 Canvas 图表。
- 页面不可见时降低或暂停非关键刷新。
- Dashboard 的美观不能以后台常驻 CPU 为代价。

---

# 32B. AI-Assisted Configuration Framework

## 32B.1 目标

系统必须同时提供两种一等配置方式：

```text
GUI form / wizard
Natural-language Configuration Assistant
```

两者必须调用同一个 `Configuration Engine`，不能各自实现一套配置逻辑。

用户应该能够说：

```text
我的 Mac 里已经安装了 Qoder，把它加入 Dispatcher，代号 Alice。
```

系统执行固定工作流：

```text
USER_REQUEST
  ↓
PARSE_INTENT
  ↓
RESOLVE_TARGET
  ↓
DISCOVERY
  ↓
MISSING_INFO ? ── yes ─→ NEED_USER_INPUT ─→ resume
  ↓ no
BUILD_PLAN
  ↓
VALIDATE
  ↓
CONFIG_PREVIEW / AUTO-APPLY-SAFE
  ↓
APPLY TRANSACTION
  ↓
VERIFY
  ├─ success → COMMIT
  └─ failure → ROLLBACK
```

LLM 不允许跳过状态机。

## 32B.2 Adapter Manifest

每个 Agent Adapter 必须声明机器可读 manifest，而不仅是 `start/stop/send/status`：

```ts
interface AdapterManifest {
  id: string;
  displayName: string;
  supportedPlatforms: Platform[];
  configurationSchema: JsonSchema;
  uiSchema?: unknown;
  secretFields: string[];
  discovery: DiscoverySpec[];
  authentication: AuthSpec[];
  backends: BackendSpec[];
  capabilityProbes: ProbeSpec[];
  healthChecks: ProbeSpec[];
  usageProbe?: ProbeSpec;
  diagnostics: DiagnosticSpec[];
}
```

Configuration Assistant 只能调用 manifest 暴露的安全 discovery/validation 工具，不得自由扫描整台机器。

## 32B.3 发现示例：Qoder Alice

用户：

```text
我的 mac-neo 中安装了 qoder，将它加入 dispatcher，代号 Alice。
```

Semantic Controller 只能先产生：

```json
{
  "intent": "add_agent_profile",
  "provider": "qoder",
  "alias": "Alice",
  "runner": "mac-neo"
}
```

然后调用：

```text
agent.discover(provider=qoder, runner=mac-neo)
```

Runner 的 Qoder Adapter 执行已定义 probe，例如：

```text
command -v qoder
version probe
auth probe
SDK capability probe
daemon probe
```

返回规范化结果，LLM 生成配置计划，再由 Configuration Engine 应用。

## 32B.4 信息不足

以下情况不得猜测：

- 同一 Agent 在多台 Runner 被发现，但用户没指定。
- 多个 binary/installation 候选且优先级无法可靠判定。
- 需要 OAuth/API key 但尚未授权。
- 用户给出 workspace/team 名称但无法唯一解析。
- 现有配置会被覆盖。
- 操作会扩大宿主机权限。

必须进入 `NEED_USER_INPUT`，明确告诉用户缺什么。

## 32B.5 Secure Input

Secret 不能直接发送给第三方 LLM。

当用户需要提供 Linear API key、LLM API key 等敏感字段时，聊天区渲染 Secure Input Card：

```text
Linear API Key
[ ••••••••••••••••• ]
[ Continue ]
```

提交后直接进入 SecretStore。LLM 只获得：

```json
{
  "credential_available": true,
  "credential_ref": "secret://linear/main"
}
```

LLM 看不到原始 secret。

OAuth 能用时优先 OAuth；API key 作为显式备选路径。

## 32B.6 Config Plan 与事务

LLM 永远不能直接写 canonical config。

它只能提交 `ConfigPlan`：

```ts
interface ConfigPlan {
  id: string;
  intentId: string;
  changes: ConfigChange[];
  secretsRequired: SecretRequirement[];
  probesRequired: ProbeRequest[];
  risk: "safe" | "sensitive" | "privileged";
  requiresConfirmation: boolean;
  rollbackPlan: RollbackAction[];
}
```

Configuration Engine 完成：validate → apply → verify → commit/rollback。

低风险且用户已明确授权的唯一候选配置可以自动应用；覆盖现有连接、删除 profile、变更 trust policy、增加 shell 权限等必须预览并确认。

## 32B.7 GUI 与 Assistant 共用 Schema

Agent Profile、LLM Endpoint、Integration 表单尽量由 JSON Schema + UI Schema 生成。新增 Adapter 时，不再额外手写一套配置页面和一套 AI prompt。

---

# 32C. Internal LLM Runtime

## 32C.1 目标

内置 LLM 不再是单个 `provider/model/key`，而是独立 Runtime：

```text
Endpoint
  ↓
Profile
  ↓
Pool / Fallback Chain
  ↓
Semantic Role
```

支持 Web 页面手动配置、测试、切换；支持多 LLM fallback；支持 Configuration Assistant 使用工具请求切换；支持全部 LLM 不可用时系统降级而非整体停服。

## 32C.2 Endpoint

Endpoint 描述通信协议与凭据：

```yaml
id: alibaba-main
protocol: openai-chat-compatible
base_url: ...
credential_ref: secret://llm/alibaba-main
```

第一阶段协议目标：

```text
OpenAI Responses
OpenAI Chat Completions
OpenAI-compatible Chat Completions
Anthropic Messages
Azure OpenAI v1
Azure OpenAI Legacy（兼容既有部署）
```

协议与厂商标签分离。DeepSeek、Qwen、OpenRouter 或自建代理都可以落在同一个 OpenAI-compatible protocol adapter 上。

## 32C.3 Profile

Profile 表示具体模型和运行参数：

```yaml
id: alice-qwen
endpoint: alibaba-main
model: qwen3.8-flash
temperature: 0
roles: [command_parser, config_assistant]
```

允许同一 Endpoint 下配置多个模型 Profile。

## 32C.4 Role Router

不要只有一个“系统当前模型”。支持：

```text
command_parser      → semantic-primary-pool
config_assistant    → semantic-primary-pool
runtime_summarizer  → cheap-pool
error_classifier    → cheap-pool
```

未配置 override 时继承 global default。

## 32C.5 Safe Switch Workflow

用户或 LLM 请求切换模型时：

```text
REQUEST SWITCH
  ↓
resolve profile
  ↓
config validate
  ↓
health probe
  ↓
role capability probe
  ↓
atomic candidate switch
  ↓
real small request verify
  ├─ success → commit
  └─ failure → rollback to previous
```

LLM 可以调用：

```text
llm.list_profiles
llm.get_runtime_status
llm.test_profile
llm.switch_profile
llm.set_fallback_order
```

但真正状态切换由 `LLM Runtime Manager` 完成。

## 32C.6 Fallback

自动 fallback 不依赖当前 LLM 自己判断。

错误处理原则：

```text
timeout/network     → short retry → fallback
429/rate limit      → mark + retry_after → fallback
quota exhausted     → WAITING_RESET → fallback
401/403             → AUTH_ERROR → fallback + alert
5xx                 → retry → circuit breaker → fallback
schema/tool failure → DEGRADED → retry/fallback
model missing       → MODEL_UNAVAILABLE
```

资源状态：

```text
HEALTHY
DEGRADED
RATE_LIMITED
QUOTA_EXHAUSTED
AUTH_ERROR
MODEL_UNAVAILABLE
PROVIDER_DOWN
COOLDOWN
DISABLED
UNKNOWN
```

## 32C.7 Circuit Breaker 与 Failback

发生连续明显 provider failure 后进入 cooldown，期间直接跳过，避免每条命令先等待一个注定失败的模型。

恢复后不要第一次探测成功就马上 failback。默认策略：

```text
automatic fallback
conservative failback
```

Primary 连续通过稳定窗口后才自动恢复，或者保持当前 fallback 等待人工切回。

## 32C.8 DEGRADED_NO_LLM

全部 LLM 不可用时，系统进入：

```text
DEGRADED_NO_LLM
```

仍必须正常运行：

- Linear/Slack webhook 基础处理。
- Fleet monitoring。
- 已有 Agent Run。
- Resource Monitor。
- 确定性 Scheduler。
- Web Dashboard。
- 手动配置。
- 固定结构命令。

暂停：

- 自然语言解析。
- AI 配置助手。
- LLM activity summary。
- LLM error classification。

绝不能因为 Internal LLM 故障导致用户无法打开 Dashboard 修复 LLM。

## 32C.9 Protocol 自动发现

添加第三方 LLM Endpoint 时可提供 `protocol:auto` 设置流程，但只用于首次探测：

```text
probe OpenAI Responses
probe OpenAI Chat
probe Anthropic Messages
probe Azure v1
probe Azure legacy
```

探测成功后写入确定协议，运行期不应每次请求重新猜测。

## 32C.10 可选 LiteLLM Boundary

可以复用 LiteLLM 处理大量 provider/protocol 兼容，但不应把 Dispatcher 的核心 `Profile/Health/CircuitBreaker/Fallback/SafeSwitch/Failback/DegradedMode` 语义外包。

推荐：

```text
Dispatcher LLM Runtime Manager
        ↓
Native common protocol adapters
        ├─ OpenAI
        ├─ Anthropic
        └─ Azure
        ↓ optional
LiteLLM Gateway for long-tail providers / complex enterprise routing
```

LiteLLM 默认不是 Mac 单机部署的强制 sidecar，避免为了协议兼容常驻额外 Python 服务。

---

# 32D. SecretStore 与凭据边界

## 32D.1 基本原则

Canonical config 永不直接保存 API key/token 明文，只保存 `credential_ref`。

```text
secret://linear/main
secret://slack/main
secret://llm/alibaba-main
```

## 32D.2 Backend

第一阶段支持：

```text
macOS Keychain
Windows Credential Manager
Linux Secret Service（有桌面/keyring 时）
Encrypted Local Secret Store（无 keyring 的 Controller）
Environment reference（容器/CI）
```

外部 Vault/1Password 等作为后续 Adapter，不是 MVP 强依赖。

## 32D.3 Web 规则

Web 只支持：

```text
Create / Replace
Test
Delete
```

默认不提供“显示完整 secret”。

日志、错误、LLM prompt、事件流统一 redaction。

---

# 32E. 开源复用策略

## 32E.1 原则

项目价值在于 Coding Agent Operations 的领域语义，而不是重新实现通用 UI、表格、JSON Schema 表单、日志、PTY、telemetry、LLM provider protocol。

引入开源组件时同时检查：

1. 与真实需求是否高度重合。
2. 维护状态与成熟度。
3. 许可证与未来产品目标是否兼容。
4. 运行时常驻开销。
5. 依赖树与升级成本。
6. 是否能替换，不让第三方绑架核心状态模型。

## 32E.2 当前优先复用候选

当前设计优先评估：

| 能力 | 首选候选 | 许可证/定位 | 使用边界 |
|---|---|---|---|
| UI primitives | shadcn/ui | MIT | 复制/定制组件，不引入重后台 |
| Server state | TanStack Query | MIT | Dashboard API cache/sync |
| Data grid | TanStack Table + Virtual | MIT | Fleet/Task/Run 高密度表格 |
| Schema form | react-jsonschema-form | Apache-2.0 | Adapter/LLM/Integration schema-driven forms |
| Dashboard components | Tremor | Apache-2.0 | KPI/低频图表，按需使用 |
| 高频时间序列 | uPlot | MIT | 仅当真实需要高频曲线 |
| Logging | Pino | MIT | 结构化日志 |
| PTY fallback | node-pty | MIT | 仅用于无法 SDK/API/headless 的 CLI |
| Telemetry API | OpenTelemetry JS | Apache-2.0 | instrumentation 可内置，exporter 默认关闭 |
| LLM long-tail protocol | LiteLLM | 核心非 enterprise 部分 MIT；需遵守目录边界 | 可选 gateway，不接管核心 fallback 语义 |

具体版本在实现阶段锁定并执行 license/security review，不在架构文档里冻结长期版本号。

## 32E.3 不因“有轮子”而引入

第一阶段默认不引入：

```text
Kubernetes
Kafka
Temporal
Airflow
Redis（除非有实际跨进程需求）
PostgreSQL（单 Controller 默认 SQLite）
Prometheus/Grafana/Loki 全家桶
完整 ELK
重量级 service mesh
```

简单需求优先轻量实现。

---

# 32F. Performance & System Overhead Budget

## 32F.1 核心原则

Dispatcher 必须“常驻但近乎无感”。真正消耗机器资源的应该是 Coding Agent、构建、测试和浏览器，而不是控制平面。

任何新增常驻依赖必须回答：

> 为什么值得永久占用 CPU、RAM、文件句柄或网络连接？

回答不了则改为 lazy/on-demand 或删除。

## 32F.2 单机 Embedded Mode

代码保持 Controller/Runner/Protocol 分层，但 Mac 单机部署允许：

```text
dispatcher serve --with-runner
```

一个进程内：

```text
Controller
Embedded Runner
SQLite
Fleet Manager
Configuration Engine
Web API
Static Dashboard assets
```

本机 Controller ↔ Embedded Runner 使用 in-process transport；需要进程隔离时优先 Unix Domain Socket，而不是 localhost WebSocket。

多机时切换为真正 WebSocket Runner Protocol。

## 32F.3 Agent Lazy Runtime

配置 10 个 Profile 不等于运行 10 个 CLI。

默认：

```text
Profile idle
→ task arrives
→ lazy spawn
→ run/session
→ task finishes
→ process exits / idle timeout
```

只有确实需要 daemon 的 Adapter 才允许 `persistentRuntime=true`。

## 32F.4 LLM 调用预算

Internal LLM 是远程、事件驱动、按需调用。

禁止：

- 后台持续思考。
- 每几秒总结所有 terminal output。
- 为确定性状态判断调用 LLM。

只有发生语义事件时才调用，并做 debounce/batch。

## 32F.5 Monitor 策略

采用“事件优先，探测兜底”：

```text
active runner   → normal heartbeat
idle runner     → slower heartbeat
offline runner  → exponential backoff
known reset_at  → 接近 reset 再 probe
provider healthy→ 不做高频 health request
provider failed → circuit breaker/cooldown
```

## 32F.6 日志与数据库

默认：

```text
SQLite WAL → metadata / normalized events / state
rotating files → raw stdout/stderr
Pino → structured logs
OTel instrumentation → optional exporter
```

Raw CLI 输出不全部塞 SQLite。

必须有：

```text
per-file limit
total log budget
retention
compression（可选）
auto cleanup
```

## 32F.7 初始性能验收目标

以下是设计目标，不是尚未测量的事实；MVP 后必须在目标 MacBook Neo 上建立基线并据实调整：

| 场景 | 初始目标 |
|---|---|
| Controller + Embedded Runner 空闲 CPU | 稳态平均接近 0，目标 < 1% |
| 后台服务空闲 RSS | 目标 < 200–250 MB |
| Dashboard 未打开 | 无前端运行负担 |
| 无语义事件 | 0 LLM 调用 |
| 无 Agent Run | 0 活跃 PTY/CLI worker（持久 daemon 除外） |
| 默认数据库 | SQLite，无独立 DB daemon |
| 默认 observability | 不要求外部 collector |
| 默认部署 | 不要求 Docker |

## 32F.8 System Impact 面板

Dashboard 必须能观察 Dispatcher 自身开销：

```text
Controller RSS
Controller CPU
Runner count
Active local agent processes
DB size
Log storage
LLM calls last 1h
Event rate
Dashboard clients
```

支持 `Balanced / Low Resource / Maximum Responsiveness` 三种简单 profile，但底层仅改变 heartbeat、summary debounce、retention、UI event batching 等有限参数，不能发展成复杂 tuning framework。

---


# 33. 最新开发路线图总则

路线图采用“架构从第一天正确、功能逐步落地”的原则。核心路径必须始终可运行，不允许同时铺开所有 Provider、所有平台、所有图表和所有智能能力。

实施优先级：

```text
可运行骨架
→ Web 配置面
→ Controller/Runner 核心协议
→ Configuration Engine + SecretStore
→ Internal LLM Runtime
→ 第一个 Agent 闭环
→ Linear/GitHub 闭环
→ Fleet 实时控制面
→ AI 配置助手
→ Slack
→ Resource/Quota
→ Multi-runner / Multi-platform
→ 更多 Agent
→ 数据驱动优化
```

每个 Milestone 必须满足：

- 有明确输入与输出。
- 有自动化测试。
- 有 Dashboard 可观察状态（从相关 Milestone 开始）。
- 不依赖后续阶段才能验证核心结果。
- 新增后台常驻依赖必须做资源测量。

---

# 34. M0 — Architecture Freeze、Monorepo 与性能基线框架

## 目标

建立不会在中途被推翻的代码边界与工程规则。

## 工作项

```text
pnpm workspace / monorepo
TypeScript strict mode
shared domain types
protocol package
controller package
runner package
web package
adapters package
config package
llm-runtime package
observability package
```

确定六个一级实体：

```text
Project
Task
Run
Runner
Provider
Profile
```

确定四套独立状态机：

```text
TaskState
RunState
RunnerState
ResourceState
```

建立 benchmark harness：

```text
idle 10 min
Dashboard closed/open
1 local run
3 concurrent runs
log growth
DB growth
```

## 验收

- 所有 package 可独立 build/test。
- domain types 不依赖 UI/Agent SDK。
- Controller/Runner 可在 mock transport 上交换 typed message。
- 有 CI 检查 TypeScript、lint、unit test。
- 已建立性能基准脚本，即使此时功能很少。

---

# 35. M1 — Lightweight Controller + Embedded Runner + Web Shell

## 目标

在 MacBook Neo 上得到第一个低开销常驻服务与可打开的 Dashboard 外壳。

## 工作项

Controller：

```text
Fastify/轻量 HTTP server
SQLite WAL
migration framework
in-process event bus
static SPA hosting
health endpoint
shutdown/restart lifecycle
```

Embedded Runner：

```text
runner registry
in-process transport
process registry skeleton
heartbeat model
capability registration skeleton
```

Web：

```text
Vite + React static SPA
navigation shell
Overview placeholder
Runners placeholder
Agents & Profiles placeholder
Internal LLM placeholder
Integrations placeholder
Diagnostics placeholder
```

服务安装：

```text
macOS launchd dev/prototype installer
start / stop / status / doctor
```

## 验收

- `dispatcher serve --with-runner` 单进程启动。
- 浏览器打开 Dashboard。
- Dashboard 能实时看到本机 Runner ONLINE。
- 关闭 Dashboard 后前端不产生后台资源消耗。
- 服务 restart 后 SQLite 状态保持。
- 空闲性能被记录，未明显偏离初始预算；如偏离必须先解释/修复再进入下一阶段。

---

# 36. M2 — Canonical Configuration Engine + SecretStore + Schema UI

## 目标

让系统从一开始就不依赖用户手改 YAML/env。

## 工作项

Configuration Engine：

```text
canonical config tables
ConfigPlan
validation
transactional apply
verification hooks
rollback
config audit history
import/export (redacted)
```

SecretStore：

```text
macOS Keychain backend
encrypted local fallback
secret:// reference
redaction
secret field API
```

Schema UI：

```text
RJSF/JSON Schema forms
field descriptions
secret widgets
validation errors
test connection action
```

Setup Wizard 第一版：

```text
Controller identity
Admin local auth strategy
Runner name
Linear placeholder
Internal LLM placeholder
```

## 验收

- 可以仅通过 Web 创建/修改普通配置。
- Secret 不进入 canonical config 明文。
- export 不包含 Secret。
- 应用失败能 rollback。
- 每次配置变化有 audit record。
- CLI 仍可 `config export/validate/import`，但不是唯一配置方式。

---

# 37. M3 — Internal LLM Runtime v1

## 目标

建立可手动配置、切换、健康检查和 fallback 的内部 LLM 层，为后续自然语言配置/命令提供稳定基础。

## 工作项

协议：

```text
OpenAI Responses
OpenAI Chat / compatible
Anthropic Messages
Azure OpenAI v1
```

模型：

```text
Endpoint
Profile
Role binding
Pool
fallback order
```

Runtime：

```text
health probe
capability probe
safe switch
fallback
circuit breaker
cooldown
conservative failback
DEGRADED_NO_LLM
```

Web：

```text
Add Endpoint
Add Profile
Test Connection
Probe Capabilities
Set Global Default
Set Role Override
Drag/modify fallback order
Manual Switch
Runtime status
```

可选：LiteLLM gateway adapter，仅作为 long-tail provider 实验，不进入默认必须部署路径。

## 验收

- 配置至少两种协议的两个独立 Profile。
- 可在 Web 手动安全切换。
- 目标 Profile 不可用时 switch 自动 rollback。
- Primary 故障后自动 fallback。
- 所有 LLM 故障时 Dashboard/Controller 仍正常进入 DEGRADED_NO_LLM。
- Secret 不发送给 Semantic LLM。

---

# 38. M4 — Adapter Manifest + Discovery Framework + Generic Execution Harness

## 目标

建立以后接任何 Coding Agent 都复用的配置、发现与执行框架。

## 工作项

Adapter contract：

```text
manifest
discover
auth probe
start
send
status
cancel
result
usage probe optional
diagnostics
```

Execution backend 优先级：

```text
SDK/API
→ daemon/ACP
→ structured headless CLI
→ PTY/node-pty
```

Workspace Manager：

```text
repo registry
git fetch
worktree create/remove
branch naming
workspace path policy
verification command registry
```

进程管理：

```text
lazy spawn
stdout/stderr stream
exit classification
cancel/terminate
timeout
idle cleanup
```

## 验收

- Generic Mock Agent 能完整 start/send/status/cancel。
- Runner 能创建隔离 worktree。
- 两个 Run 并行不共用工作目录。
- Raw logs 有 rotation/budget。
- Adapter Manifest 能自动生成基础配置表单。

---

# 39. M5 — First Real Agent: Codex Profiles

## 目标

用一个真实 Provider 验证 Profile、代号、多登录态、Session、额度事件和交付链。

## 工作项

Codex：

```text
CODEX_HOME profile isolation
alias/display name
CLI/SDK discovery
auth probe
start/resume
structured events where available
error parser
usage/rate-limit signal normalization
```

Profile 示例：

```text
Orion
Atlas
Nova
```

Web：

```text
Scan Runner
Found Codex
Create Profile
Set alias
Select CODEX_HOME
Test login
View profile state
```

## 验收

- 同一 Mac 可配置至少两个独立 Codex Profile。
- Dashboard 始终显示代号而非敏感账号标识。
- 两个 profile 可并行 Run。
- Run 与 profile/session 映射可持久恢复。
- usage limit 事件能进入 ResourceState，而非被误判成 FAILED。

---

# 40. M6 — Linear Ingress + Task Contract + GitHub Delivery

## 目标

完成第一条真正有生产价值的任务闭环。

## 工作项

Linear：

```text
webhook verification
issue fetch
project/milestone metadata
task contract mapping
comment/status update
Dispatcher metadata
```

Task Contract：

```text
Goal
Scope
Acceptance Criteria
Verification
Constraints
Delivery
```

GitHub：

```text
branch/commit/push
PR creation/link
CI status retrieval
result evidence
```

状态：

```text
QUEUED
ROUTING
RUNNING
VERIFYING
PR_OPEN
REVIEW
DONE
```

## 验收

- Linear issue 可进入 Dispatcher。
- 创建 Codex Run。
- 隔离 worktree 完成修改。
- 验证后创建 PR。
- Linear 收到状态和 PR 链接。
- Controller restart 后任务状态可恢复。

---

# 41. M7 — Fleet Manager + Real-time Dashboard

## 目标

把 Controller 从“能执行”提升到“真正可管理”。

## 工作项

Fleet 三部分：

```text
Resource Registry
Workload Registry
Runtime Monitor
```

Dashboard：

```text
Runner cards
Agent/Profile list
Project → Task → Run table
Active Runs
Waiting/Blocked
Recently Completed
Need Attention
PR Ready
Internal LLM serving/failover
System Impact
```

事件：

```text
SSE incremental updates
server-side event coalescing
frontend virtualization
activity timestamp
```

Deterministic stall detector 初版。

## 验收

- Fleet 能从 Agent/Profile、Project、Task 三种视角查看同一状态。
- 任务状态变化在合理延迟内自动更新页面。
- 页面不通过高频 polling 实现实时性。
- Dashboard 关闭后 Controller CPU 不因 UI 逻辑持续上涨。
- 至少支持 1000 历史 Run 数据时表格仍流畅（虚拟化/分页）。

---

# 42. M8 — Configuration Assistant + Semantic Controller

## 目标

实现“说一句话完成配置”，但所有动作严格受 Config Workflow/Policy 约束。

## 工作项

Semantic Controller：

```text
fixed system workflow
JSON Schema / typed output
allowed tool registry
untrusted-data boundary
confidence handling
clarification state
```

Configuration tools：

```text
agent.discover
agent.test_profile
integration.test
llm.test_profile
config.build_plan
config.apply_plan
config.rollback
secret.request_input
```

Web Assistant：

```text
global drawer
config page context
structured cards
secure input card
plan preview
apply progress
verification result
```

典型场景：

```text
"mac-neo 里有 qoder，添加进来叫 Alice"
"连接我的 Linear team ..."
"给 Dispatcher 增加一个 Qwen endpoint"
"为什么 Alice 配置测试失败？"
```

## 验收

- Qoder Mock/真实安装可由一句自然语言触发 discovery → plan → apply → verify。
- 信息不足时明确询问，不擅自猜测。
- Secret 永不进入第三方 LLM payload。
- LLM 不能直接修改 DB/执行任意 shell。
- 高风险 config change 需要 confirm。
- Assistant 失效时 GUI 手工配置仍完整可用。

---

# 43. M9 — Qoder + Second Agent Adapter / Quota Normalization

## 目标

验证架构不是“只为 Codex 写的”。

优先第二 Provider：Qoder；如实际 SDK/CLI 状态发生变化，可替换为当时最适合验证多 Provider 的 Agent。

## 工作项

```text
Qoder discovery
SDK/CLI backend
profile alias Alice
session control
usage probe
credit normalization
quota exhausted mapping
```

建立统一 ResourceState 与 ResourceEvent。

## 验收

- Codex 和 Qoder 同时出现在 Fleet。
- Scheduler 可根据 task policy 选择不同 Provider/Profile。
- Qoder credit/usage 能进入统一状态模型。
- 某 Provider quota exhaustion 不影响另一个 Provider 继续接任务。

---

# 44. M10 — Slack Remote Control Plane

## 目标

让用户大部分日常介入可以只使用手机 Slack。

## 工作项

```text
Dispatcher Slack app
alerts channel
command channel/thread
button actions
structured command fallback
natural-language command via Internal LLM
secure link back to Dashboard
```

通知只发送需要人关注的状态：

```text
WAITING_USER
RESOURCE_BLOCKED long-running
FAILED
ESCALATED
REVIEW_READY
RUNNER_OFFLINE
INTERNAL_LLM_FAILOVER（可配置）
```

## 验收

- Slack 可查询 fleet/task/profile。
- 可回复 WAITING_USER 并继续同一 Session。
- 可 pause/resume/cancel/reroute。
- LLM 不可用时仍可使用固定 slash/structured commands。
- Slack 不接受 API key 等 secret；返回 Dashboard secure link。

---

# 45. M11 — Resource Monitor、Auto Resume 与 Agent Fleet Quota

## 目标

让系统真正理解“任务失败”和“资源暂时不可用”的区别。

## 工作项

```text
multi-signal quota monitor
reset_at
probe scheduler
RESOURCE_BLOCKED
WAITING_RESOURCE
RESOURCE_READY
auto resume same session
low-resource alert
provider outage
```

Codex、Qoder 等分别实现可用的一手/本地/错误解析信号。

## 验收

- Profile 达到 usage limit 后任务进入 WAITING_RESOURCE。
- Slack/Dashboard 提示原因和可信度。
- 到预计 reset 时间只做 probe，不直接宣布恢复。
- 确认恢复后可继续原 Session。
- Profile quota 与 TaskState 完全解耦。

---

# 46. M12 — Multi-Runner Protocol + Lease/Fencing + Journal

## 目标

将最初已经存在的逻辑边界真正扩展为一 Controller 多 Runner。

## 工作项

Protocol：

```text
TLS/authenticated WebSocket
runner registration
capabilities
heartbeat
RPC/event envelope
ack/sequence
reconnect
```

一致性：

```text
lease_id
generation
expires_at
fencing check
```

Runner journal：

```text
local SQLite journal
sequence replay
controller last_ack
reconciliation
```

状态：

```text
ONLINE
DEGRADED
DRAINING
OFFLINE
```

## 验收

- Controller 与 Mac Runner 可真正分机运行。
- 网络断开时正在运行的 Agent 不被杀死。
- 恢复后 events replay/reconcile。
- 旧 generation 的 Run 不能交付 PR/result。
- Runner offline 不被误判 Task FAILED。

---

# 47. M13 — Native macOS / Windows / Linux Runner Support

## 目标

把跨平台能力从协议层落到实际系统服务层。

## 工作项

```text
macOS launchd
Windows Service
Linux systemd
path/shell abstraction
process tree kill
PTY ConPTY/Unix PTY
credential store adapter
resource stats
sleep behavior
```

Runner capabilities/tags：

```text
os
arch
gui
browser
xcode
etw
android-adb
gpu
ci
isolated
```

## 验收

- 三平台至少各完成一个真实 command/run smoke test。
- `runner install/start/status/doctor` 体验一致。
- Windows/Linux platform code 不污染核心 scheduler/domain。
- Scheduler 能依据 OS/capability 选择 Runner。

---

# 48. M14 — Remaining Agent Adapters & Native Integrations

## 目标

按实际价值逐个增加，不追求“Logo 墙”。

推荐顺序根据届时真实使用量调整，候选：

```text
Cursor
Devin
Kiro
WorkBuddy/CodeBuddy
Generic CLI
```

每新增一个 Adapter 必须同时交付：

```text
Manifest
Discovery
Config UI
Health
Run control
Error normalization
Resource probe（可用时）
Contract tests
Documentation
```

不能只写一个 `spawn()` 就算支持。

---

# 49. M15 — Production Hardening

## 工作项

安全：

```text
local admin auth
CSRF/origin policy
secret redaction
path sandbox
command allow policy
runner identity
certificate rotation
webhook signature validation
```

稳定性：

```text
crash recovery
DB backup/migration
log retention
run orphan cleanup
worktree cleanup
provider outage tests
chaos network tests
```

性能：

```text
MacBook Neo baseline
idle
Dashboard open/closed
1/3/5 concurrent run
SSE fanout
1000/10000 run history
log/DB growth
memory leak soak
```

---

# 50. M16 — Data-Driven Routing（后续）

只有在真实 Run 数据足够后才做：

```text
first-pass success by Provider/Profile/Repo
human intervention rate
retry rate
median completion time
quota-block rate
cost/credits per accepted PR
failure category distribution
```

这些数据可以辅助 Scheduler，但第一阶段不要训练/构建复杂 AI Router。

LLM 可给 routing recommendation；Policy Engine 仍控制最终可执行集合。

---

# 51. MVP / Alpha / Beta 定义

## MVP

达到 M6：

```text
Web Dashboard shell
Web config
SecretStore
Internal LLM Runtime basic
Codex Profiles
Linear → Codex → GitHub PR → Linear
Embedded Runner
```

此时已经有真实价值。

## Alpha

达到 M10：

```text
Real-time Fleet
AI Configuration Assistant
至少两种 Agent Provider
Slack remote control
```

此时日常体验基本成型。

## Beta

达到 M13/M14：

```text
Multi-runner
macOS/Windows/Linux
quota monitor
reconcile/fencing
更多核心 Agent
production hardening underway
```

---

# 52. Release Gate

第一次正式生产使用前必须全部满足：

```text
[ ] Linear webhook 安全验证
[ ] Secret 不落普通配置/日志
[ ] Agent worktree 隔离
[ ] 高风险 shell policy
[ ] Run lease/generation（若启用 multi-runner）
[ ] Resource blocked != failed
[ ] Controller restart recover
[ ] Runner reconnect recover
[ ] LLM fallback/rollback
[ ] DEGRADED_NO_LLM 可恢复
[ ] Configuration transaction rollback
[ ] Slack secret 输入被拒绝
[ ] Dashboard 不依赖高频 polling
[ ] log retention 生效
[ ] MacBook Neo 性能基线通过
```

---

# 53. 测试矩阵

## 53.1 Configuration

- Schema validation。
- ConfigPlan dry-run。
- Transaction rollback。
- Duplicate alias。
- Ambiguous discovery。
- Secret redaction。
- OAuth interrupted/resume。

## 53.2 Internal LLM

- Primary healthy。
- Primary timeout。
- 429。
- quota exhausted。
- 401/403。
- malformed structured output。
- target switch fail → rollback。
- all profiles down → DEGRADED_NO_LLM。
- recovered primary → conservative failback。

## 53.3 Adapter

- discover none/one/multiple。
- auth missing。
- start/send/status/cancel/result。
- process crash。
- daemon unavailable。
- PTY ANSI noise。
- unknown CLI version。

## 53.4 Runner

- register/reconnect。
- duplicated event。
- stale generation。
- controller offline。
- runner offline。
- journal replay。
- process tree cleanup。

## 53.5 Fleet

- one task multiple run attempts。
- one profile multiple tasks。
- project view consistency。
- WAITING_USER。
- WAITING_RESOURCE。
- suspected stall。
- latest meaningful activity。
- PR ready。

## 53.6 Security

- prompt injection in terminal output。
- malicious repository text。
- attempt to access secret via LLM tool。
- raw shell outside worktree。
- `sudo` request。
- path traversal。
- webhook replay。
- Slack secret leakage。

## 53.7 Performance

- 10min idle CPU/RSS。
- Dashboard closed/open delta。
- 1000 row Fleet table。
- 10k history pagination。
- SSE event burst。
- log rotation。
- SQLite WAL growth/checkpoint。
- long-running memory soak。

---

# 54. 推荐 Monorepo（最新版）

```text
apps/
├── controller/
└── web/

packages/
├── domain/
├── protocol/
├── runner/
│   ├── core/
│   └── platform/
│       ├── macos/
│       ├── windows/
│       └── linux/
├── adapters/
│   ├── codex/
│   ├── qoder/
│   ├── cursor/
│   ├── devin/
│   ├── kiro/
│   ├── codebuddy/
│   └── generic-cli/
├── config/
│   ├── engine/
│   ├── manifest/
│   ├── secret-store/
│   └── schemas/
├── llm-runtime/
│   ├── protocols/
│   ├── profiles/
│   ├── router/
│   ├── health/
│   └── fallback/
├── semantic/
├── scheduler/
├── fleet/
├── workspace/
├── integrations/
│   ├── linear/
│   ├── slack/
│   └── github/
├── observability/
├── persistence/
└── shared/
```

依赖方向必须保持单向；domain/protocol 不依赖 Web 和具体 Adapter。

---

# 55. Dashboard 最终用户体验

系统首次启动：

```text
打开 http://dispatcher.local
        ↓
Setup Wizard
        ↓
配置第一个 Internal LLM
        ↓
连接 Linear/GitHub
        ↓
添加 Runner
        ↓
扫描已安装 Agent
        ↓
创建 Profile / alias
        ↓
测试
        ↓
Fleet
```

之后普通用户无需接触 YAML。

配置示例：

```text
用户：
“mac-neo 里有 Qoder，给我接进来，叫 Alice。”

Assistant：
检测到 /opt/.../qoder
已登录
推荐 SDK backend

[配置计划]
+ Qoder Profile: Alice
+ Runner: mac-neo
+ Backend: SDK

[Apply]

✓ 配置完成
✓ Test session passed
```

日常：

```text
Slack：快速说话
Linear：看项目/任务
Dashboard：看整个系统和处理复杂操作
GitHub：看代码与 Review
```

---

# 56. Fleet 输出规范

Fleet 中一个 Profile 至少展示：

```text
Alias
Provider
Plan/credential label（非敏感）
Runner
ResourceState
Usage/Quota（可获得时）
Concurrent slots
Current Tasks
Last meaningful activity
```

一个 Run 至少展示：

```text
Project
Task
Provider/Profile
Runner
RunState
Activity summary
Started at
Duration
Last meaningful activity
Waiting reason
PR/CI
Attempt number
```

Dashboard 不能只显示“Running”而没有 activity；也不能把原始 terminal flood 直接当 Fleet UI。

---

# 57. 默认安全与权限策略

```text
LLM            无任意 shell
Semantic tools allowlist
Raw repo/log    untrusted data
Runner          最小宿主权限
Agent workspace 仅 task worktree
sudo            default deny
secret          opaque reference
PR auto-create  allow
merge           default human/policy gate
system config   transactional
privileged config requires confirm
```

Mac 上强烈建议使用专用 `agent-runner` 用户，至少将自动执行环境与个人 Documents/Desktop/SSH 主密钥/浏览器个人资料分离。

---

# 58. 开源依赖采用 Gate

任何新依赖 PR 必须说明：

```text
解决的真实问题
不使用它的实现成本
license
maintenance signal
runtime footprint
transitive dependency cost
security surface
replacement strategy
```

尤其是常驻后台依赖必须额外提供 idle RSS/CPU 影响。

不接受仅因为“流行”而引入框架。

---

# 59. 关键设计决策摘要

1. Dashboard 是正式控制面，不是未来附属功能。
2. Controller 是后台服务；Runner 执行真实 Agent。
3. 单 Controller + 多 Runner；暂不做多 Controller 共识。
4. Controller/Runner 逻辑分离，但 Mac 单机允许 Embedded Mode 降低开销。
5. Linear 是任务事实源；Slack 是遥控器；GitHub 是交付证据。
6. Fleet 必须关联 Runner → Provider/Profile → Project → Task → Run → Resource。
7. LLM 只负责语义和模糊判断；程序负责事实、权限、状态和执行。
8. Configuration Assistant 必须走固定工作流和 typed tools。
9. GUI 与 AI 配置共用 Configuration Engine / Adapter Manifest。
10. Secret 永不进入第三方 LLM prompt。
11. Internal LLM 支持多 Endpoint/Profile、role routing、手动切换和 fallback。
12. LLM 切换失败必须回滚到原有效 Profile。
13. 所有 LLM 不可用时系统降级，不整体停服。
14. Coding Agent Profile 支持别名；Codex 多账号等复杂度由 Dispatcher 隐藏。
15. Resource unavailable != Task failed。
16. 多 Runner 从第一天协议上支持 lease/generation/fencing。
17. Agent 优先 SDK/API/daemon/headless CLI，PTY 兜底，GUI 模拟点击不作为主方案。
18. Agent Profile 默认 lazy spawn，不因配置存在而常驻进程。
19. Dashboard 采用事件驱动更新，避免高频 polling。
20. SQLite/Pino/rotating logs 为默认轻量持久化，不默认部署重型 telemetry stack。
21. 积极复用成熟开源实现，但核心领域状态机与策略自己掌握。
22. 每个新增常驻依赖都必须证明资源成本合理。

---

# 60. 最终完成定义

当系统达到成熟状态，用户应获得如下体验：

```text
我在 Linear 定义真实工作；
我在 Slack 随时下命令或处理异常；
我在 Dashboard 配置系统、和内置 LLM 对话，并实时看到所有 Agent Fleet；
Dispatcher 自动选择合适 Runner / Provider / Profile；
Runner 在隔离 worktree 中持续执行；
额度、掉线、等待输入、失败、PR、CI 都有明确状态；
某个 Internal LLM 下线时系统自动 fallback；
某个 Coding Agent 额度耗尽时任务等待资源或按策略转派；
MacBook Neo 空闲时 Dispatcher 几乎无感；
我不需要逐个打开六七个 Agent 管理任务。
```

项目的核心不是“支持多少 Agent Logo”，而是：

> **用最小的人力和最小的控制面开销，把多个异构 Coding Agent、账号/Profile、设备、额度和任务组织成一个可靠、可观察、可替换、可持续运行的工程执行系统。**

---

# Appendix A — Configuration Intent 示例

```json
{
  "intent": "add_agent_profile",
  "targetRunner": "mac-neo",
  "provider": "qoder",
  "alias": "Alice",
  "constraints": {
    "autoDiscover": true,
    "allowPrivilegedChanges": false
  }
}
```

# Appendix B — Internal LLM Profile 示例

```json
{
  "profileId": "alice-qwen",
  "endpointId": "alibaba-main",
  "model": "qwen3.8-flash",
  "roles": ["command_parser", "config_assistant"],
  "health": "healthy",
  "priority": 100
}
```

# Appendix C — Config Plan 示例

```json
{
  "planId": "cfg-0192",
  "risk": "safe",
  "changes": [
    {
      "op": "create_profile",
      "provider": "qoder",
      "alias": "Alice",
      "runner": "mac-neo",
      "backend": "sdk"
    }
  ],
  "requiresConfirmation": false,
  "verify": ["agent.auth", "agent.test_session"]
}
```

# Appendix D — Runner Event Envelope

```json
{
  "eventId": "evt-123",
  "runnerId": "mac-neo",
  "sequence": 731,
  "runId": "run-83",
  "leaseId": "lease-991",
  "generation": 3,
  "type": "run.state",
  "payload": {
    "state": "verifying",
    "activity": "Running project tests"
  }
}
```

# Appendix E — ResourceState 示例

```json
{
  "profileId": "codex.atlas",
  "availability": "waiting_reset",
  "reason": "five_hour_limit",
  "resetsAt": "2026-09-15T04:12:00+08:00",
  "source": "session_event",
  "confidence": "high"
}
```

# Appendix F — Internal LLM Fallback 伪代码

```text
for profile in rolePool.orderedProfiles:
    if circuitBreaker.isOpen(profile):
        continue

    result = call(profile, request)

    if result.success:
        recordSuccess(profile)
        return result

    failure = normalizeFailure(result)
    updateHealth(profile, failure)

    if failure.retryable and retryBudget.available:
        retry once according to policy

    if failure.opensCircuit:
        circuitBreaker.open(profile)

enter DEGRADED_NO_LLM if no profile succeeds
```

# Appendix G — 性能基线场景

```text
P0: controller+embedded runner idle 10min
P1: Dashboard open, no active run
P2: 1 Codex run
P3: 3 parallel runs
P4: 1000 historical runs visible/queryable
P5: SSE burst 100 events/s synthetic
P6: 8h soak idle
P7: 8h soak mixed activity
```

记录：CPU、RSS、event loop lag、DB writes、disk growth、open handles、network requests、LLM calls。

# Appendix H — 当前明确延后

```text
multi-controller HA
consensus/leader election
Kubernetes deployment requirement
heavy message broker
generic workflow language
full observability stack by default
arbitrary LLM shell
GUI-coordinate terminal automation
agent marketplace
plugin marketplace
self-hosted local foundation model requirement
automatic PR merge without policy/human gate
```
