import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import type {RepositoryConsoleContext,RepositoryRefs} from "@dispatcher/domain";
import {api} from "./api.js";
import {Notice} from "./ui.js";

export function RepositoryRefPicker({id,value,onChange,disabled=false}:{id:string;value:string;onChange:(value:string)=>void;disabled?:boolean}):React.JSX.Element{
  const [read,setRead]=useState(false),[offset,setOffset]=useState(0);
  const query=useQuery({queryKey:["repository-refs",id,offset],queryFn:()=>api<RepositoryRefs>(`/api/repositories/${encodeURIComponent(id)}/refs?offset=${offset}&limit=50`),enabled:read&&Boolean(id),retry:false});
  return <div className="field-stack"><label>基准引用<input disabled={disabled} value={value} maxLength={200} placeholder="沿用已登记基准分支" onChange={event=>onChange(event.target.value)}/></label><button type="button" disabled={!id||disabled||query.isFetching} onClick={()=>{if(read)void query.refetch();else setRead(true);}}>读取仓库引用</button><p>仅读取所属设备现有分支、标签和远端跟踪引用，不拉取远端。</p>{query.isError?<p role="alert">引用读取失败。可重试，或填写已知引用后通过预检核验。</p>:query.isFetching?<p role="status">正在读取引用…</p>:query.data?<><label>选择已读取引用<select disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}><option value="">沿用已登记基准</option>{value&&!query.data.refs.some(ref=>ref.name===value)&&<option value={value}>{value}</option>}{query.data.refs.map(ref=><option value={ref.name} key={ref.name}>{ref.name} · {ref.commit.slice(0,10)}</option>)}</select></label>{query.data.truncated&&<p role="status">已达到引用读取上限；其他引用可手动填写并通过预检核验。</p>}{!query.data.refs.length&&<p>本页没有可解析为 commit 的引用。</p>}<div className="secure-actions"><button type="button" disabled={offset===0||query.isFetching} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页引用</button><button type="button" disabled={query.data.nextOffset===undefined||query.isFetching} onClick={()=>setOffset(query.data!.nextOffset!)}>下一页引用</button></div></>:null}</div>;
}

export default function RepositoryContext({id}:{id:string}):React.JSX.Element{
  const query=useQuery({queryKey:["repository-context",id],queryFn:()=>api<RepositoryConsoleContext>(`/api/repositories/${encodeURIComponent(id)}/context`),retry:false});
  const [base,setBase]=useState("");
  if(query.isLoading)return <p role="status">正在读取所属设备的仓库上下文…</p>;
  if(query.error||!query.data)return <div role="alert">仓库上下文读取失败。<button onClick={()=>void query.refetch()}>重试</button></div>;
  const context=query.data;
  return <><Notice>读取不会创建工作区、切换分支、运行验证或拉取远端。</Notice><dl><dt>仓库登记 ID</dt><dd>{context.repositoryId}</dd><dt>本地 Project ID</dt><dd>{context.projectId}</dd><dt>所属设备</dt><dd>{context.runnerId} · {context.runnerBindingSource==="explicit"?"显式绑定":"旧登记默认本机"}</dd><dt>配置版本</dt><dd>{context.configRevision}</dd><dt>Git 状态</dt><dd>{context.git.state==="valid"?"已验证":context.git.state==="invalid"?"仓库或基准无效":"所属设备尚不可用"}</dd><dt>基准引用</dt><dd>{context.git.baseRef}</dd><dt>当前基准 commit</dt><dd><code>{context.git.baseCommit??"尚未确认"}</code></dd></dl>{context.git.reasonCode&&<p role="status">阻塞原因：{context.git.reasonCode}</p>}<button onClick={()=>void query.refetch()} disabled={query.isFetching}>重新读取仓库上下文</button><RepositoryRefPicker id={id} value={base} onChange={setBase} disabled={!context.actions.refs.allowed}/></>;
}
