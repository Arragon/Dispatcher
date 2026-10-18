import type { FleetRunInput, FleetTaskInput } from "@dispatcher/fleet";
export const terminalStates = new Set(["COMPLETE", "FAILED", "CANCELLED", "SUPERSEDED"]);
const labels: Record<string, string> = { COMPLETED:"会话完成", ONLINE: "在线", OFFLINE: "离线", UNKNOWN: "未知", AVAILABLE: "可用", LOW: "资源偏低", RATE_LIMITED: "受到限流", QUOTA_EXHAUSTED: "额度耗尽", AUTH_ERROR: "需要认证", PROVIDER_DOWN: "提供方不可用", WAITING_RESET: "等待重置", ACTIVE: "正常运行", RUNNING: "正常运行", STARTING: "启动中", CREATED: "待启动", WAITING_USER: "需要决策", RESOURCE_BLOCKED: "等待资源", WAITING_RESOURCE: "等待资源", RUNNER_UNAVAILABLE: "设备不可用", SUSPECTED_STALL: "疑似停止响应", VERIFYING: "验证中", DELIVERING: "交付中", REVIEW: "待验收", FAILED: "出现错误", CANCELLED: "已停止", SUPERSEDED: "已替换", COMPLETE: "运行完成", DONE: "任务完成", READY: "待派发", QUEUED: "排队中", NEEDS_SPEC: "需补充说明", BACKLOG: "待规划", CONFIGURED: "已启用", DISABLED: "已停用", UNAVAILABLE: "不可用" };
export function stateLabel(state: string): string { return labels[state] ?? state; }
export function currentRun(task: FleetTaskInput, runs: readonly FleetRunInput[]): FleetRunInput | undefined {
  // A missing authoritative run is missing evidence; do not substitute a newer attempt.
  return task.currentRunId ? runs.find((run) => run.id === task.currentRunId) : runs.find((run) => run.taskId === task.id);
}
export function tokensLabel(run?: FleetRunInput): string {
  return run?.tokens ? `${(run.tokens.input + run.tokens.output).toLocaleString()} token` : "用量未提供";
}
export function safeLink(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
