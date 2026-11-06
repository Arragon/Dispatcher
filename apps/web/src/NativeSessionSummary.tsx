import type {RunNativeSessionView} from "@dispatcher/domain";
import {Notice} from "./ui.js";
const identities={legacy:"未绑定",unbound:"未绑定",bound:"已绑定",deleted:"已删除",unreachable:"暂不可达",conflict:"冲突，待核对"};
const states={idle:"空闲",running:"运行中",waiting:"等待输入",deleted:"已删除",unreachable:"暂不可达",unknown:"待核对"};
const controls={AUTOMATED:"后台",HANDOFF_REQUESTED:"正在申请接管",HUMAN:"人工",RECONCILING:"正在核对",CONFLICT:"冲突，待核对"};
const freshness={fresh:"近期观测",stale:"已过期",unknown:"未知"};
const capabilities:Record<string,string>={durableIdentity:"持久身份",historyRead:"读取历史",sameSessionContinue:"原会话续接",liveSteer:"运行中输入",interruptTurn:"中断当前回合",nativeApproval:"原生审批",observeExternalChanges:"观察外部修改",releaseControl:"交出控制",reclaimControl:"收回控制",restartReattach:"重启后重连"};
const support={supported:"已验证",unsupported:"不支持",unknown:"未知"};
/** Read-only saved facts. It owns no native command, URL or launch operation. */
export function NativeSessionSummary({view}:{view?:RunNativeSessionView|undefined}):React.JSX.Element {
 return <section className="detail-section" aria-label="原生会话"><h3>原生会话</h3>{!view?<p>尚无已保存的原生会话摘要。</p>:<>
 <p>身份：{identities[view.identity]??"未知"}</p><p>控制权：{view.control?controls[view.control.state]??"未知":"未知"}</p><p>原生状态：{states[view.state]??"待核对"}</p><p>观测：{freshness[view.freshness]??"未知"}</p>
 <p>请求模型：{view.requestedModel?.id??"未知"}</p>{view.requestedModel?.reasoning&&<p>思考强度：{view.requestedModel.reasoning}</p>}<p>上次原生报告模型：{view.reportedModel?.id??"未知"}</p>
 {view.binding&&<p>原生会话 ID：<code>{view.binding.nativeSessionId}</code></p>}
 <details><summary>能力与诊断</summary><p>Runner：{view.execution.runnerId??"未知"} · 执行目录：{view.execution.worktree??"未知"}</p><p>运行代次：{view.generation} · 尝试：{view.attempt}</p>{view.control&&<p>控制版本：{view.control.epoch}/{view.control.revision}</p>}<p>观测时间：{view.observedAt&&Number.isFinite(Date.parse(view.observedAt))?new Date(view.observedAt).toLocaleString():"未知"}</p><ul className="detail-list">{view.capabilities.map(c=><li key={c.name}>{capabilities[c.name]??c.name}：{support[c.support]??"未知"}</li>)}</ul></details>
 <Notice>原生接管与交还暂不可用。状态待核对时，请先检查原生客户端中的原会话。</Notice>
 </>}</section>;
}
