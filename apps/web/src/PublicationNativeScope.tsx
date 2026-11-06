import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import type {ProfileConsoleView,InteractionMode,NativeSurface} from "@dispatcher/domain";
import {api} from "./api.js";
import {ProfileInteractionPanel} from "./ProfileInteractionPanel.js";

export function interactionRequirementLabel(mode:InteractionMode|""="compatible",surface:NativeSurface|""=""):string {
 const labels={"":"沿用账号策略",compatible:"兼容执行","native-session":"原生历史与人工接管","native-gui":"指定原生界面接管"},surfaces={desktop:"桌面",ide:"IDE",web:"网页",mobile:"移动端",tui:"终端"};
 return labels[mode]+(mode==="native-gui"&&surface?` · ${surfaces[surface]}`:"");
}
export function PublicationNativeScope({profileId,configRevision,backendId,contextReady=true,mode,surface,onChange}:{profileId:string;configRevision:number;backendId?:string;contextReady?:boolean;mode?:InteractionMode|"";surface?:NativeSurface|"";onChange?:(value:{mode:InteractionMode|"";surface:NativeSurface|""})=>void}):React.JSX.Element {
 const [opened,setOpened]=useState(false);
 const query=useQuery({queryKey:["agent-profile",profileId,configRevision],queryFn:({signal})=>api<{profile?:Partial<ProfileConsoleView>}>(`/api/agents/profiles/${encodeURIComponent(profileId)}`,{signal}),enabled:opened&&Boolean(profileId)&&contextReady&&Number.isSafeInteger(configRevision)&&configRevision>0,retry:false});
 const profile=query.data?.profile,matching=profile?.id===profileId&&profile?.configRevision===configRevision;
 const headerReady=contextReady&&matching&&query.isSuccess&&!query.isFetching&&!query.error;
 const view=profile?.id===profileId?profile.interaction:undefined;
 const scopedView=backendId&&view&&Array.isArray(view.rows)?{...view,rows:view.rows.filter(row=>row?.backendId===backendId)}:view;
 return <section className="publish-setting" aria-label="发布前原生交互说明">
  {onChange&&<><label>原生交互要求<select aria-label="原生交互要求" disabled={!profileId} value={mode??""} onChange={event=>{const mode=event.target.value as InteractionMode|"";onChange({mode,surface:mode==="native-gui"?surface||"desktop":""});}}><option value="">沿用账号策略</option><option value="compatible">兼容执行</option><option value="native-session">原生历史与人工接管</option><option value="native-gui">必须可在指定原生界面接管</option></select></label>{mode==="native-gui"&&<label>必须可用的原生界面<select aria-label="必须可用的原生界面" value={surface??""} onChange={event=>onChange({mode,surface:event.target.value as NativeSurface})}><option value="">选择原生界面</option><option value="desktop">桌面</option><option value="ide">IDE</option><option value="web">网页</option><option value="mobile">移动端</option><option value="tui">终端</option></select></label>}<p>严格要求未通过当前能力验证时会阻止发布。执行位置仍为受管工作区；模型调用的数据外发与费用按所选工具和账号核对。</p></>}
  <p><strong>交互方式：{interactionRequirementLabel(mode??"compatible",surface??"")}</strong></p>
  <p className="muted">兼容执行不保证原生历史、同会话接管或指定原生界面。原生能力需按账号、后端和地区分别核验。</p>
  {profileId?<details onToggle={event=>setOpened(event.currentTarget.open)}><summary>原生交互能力与限制</summary>
   {opened&&<>
    {query.isFetching&&<p role="status">正在读取当前账号的能力说明…</p>}
    {query.error&&<p role="alert">能力说明读取失败，当前能力未确认。请重新读取。</p>}
    {query.isSuccess&&!matching&&<p role="alert">账号配置或详情已变化，当前能力未确认。请重新读取配置与能力说明。</p>}
    {backendId&&<p>服务端预检后端：{backendId}</p>}
    <ProfileInteractionPanel key={`${profileId}:${configRevision}:${backendId??"all"}`} view={scopedView} headerReady={Boolean(headerReady)}/>
    <div className="secure-actions"><button type="button" disabled={query.isFetching||!contextReady} onClick={()=>void query.refetch()}>重新读取能力说明</button><Link to={`/agents?profile=${encodeURIComponent(profileId)}`}>查看账号与原生能力</Link></div>
   </>}
  </details>:<p className="muted">选择账号后可查看原生能力；自动路由的账号在检查并审阅后确定。</p>}
 </section>;
}
