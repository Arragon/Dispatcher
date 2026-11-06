import {useEffect,useRef,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import type {DirectorySelection} from "@dispatcher/domain";
import {api} from "./api.js";
export default function LocalDirectoryPicker({runners,onSelect}:{runners:Array<{id:string;mode:string}>;onSelect:(candidate:{root:string;runnerId:string})=>void}):React.JSX.Element{
  const local=runners.filter(runner=>runner.mode==="embedded"),[runnerId,setRunnerId]=useState(local[0]?.id??"");
  const [operation,setOperation]=useState<DirectorySelection>(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const active=useRef<DirectorySelection|undefined>(undefined);
  const query=useQuery({queryKey:["local-directory-selection",operation?.id],queryFn:()=>api<{selection:DirectorySelection}>(`/api/local/directory-selections/${encodeURIComponent(operation!.id)}`),enabled:Boolean(operation&&["pending","cancelling"].includes(operation.state)),retry:false,refetchInterval:query=>query.state.data&&!["pending","cancelling"].includes(query.state.data.selection.state)?false:800});
  const selection=query.data?.selection.id===operation?.id?query.data?.selection:operation;
  useEffect(()=>{active.current=selection;},[selection]);
  useEffect(()=>()=>{const current=active.current;if(current&&["pending","cancelling"].includes(current.state))void api(`/api/local/directory-selections/${encodeURIComponent(current.id)}`,{method:"DELETE"}).catch(()=>undefined);},[]);
  async function choose():Promise<void>{
    if(busy)return;setBusy(true);setMessage("");
    try{const result=await api<{selection:DirectorySelection}>("/api/local/directory-selections",{method:"POST",body:JSON.stringify({purpose:"repository",runnerId})});setOperation(result.selection);}
    catch(error){setMessage(error instanceof Error?error.message:"本机目录选择不可用，请手动填写所属设备路径。");}finally{setBusy(false);}
  }
  async function cancel():Promise<void>{
    if(busy||!selection)return;setBusy(true);
    try{const result=await api<{selection:DirectorySelection}>(`/api/local/directory-selections/${encodeURIComponent(selection.id)}`,{method:"DELETE"});setOperation(result.selection);await query.refetch();}
    catch{setMessage("取消结果尚未确认，请在系统对话框取消后重新查询。");}finally{setBusy(false);}
  }
  const pending=Boolean(selection&&["pending","cancelling"].includes(selection.state));
  return <div className="workflow-card"><h3>从本机选择目录</h3><p>需要 Controller 所在 macOS 的交互桌面。远程或移动端请登记目标设备的路径；选择结果只进入草稿。</p><label>目录所属设备<select value={runnerId} onChange={event=>setRunnerId(event.target.value)} disabled={busy||pending}>{!local.length&&<option value="">没有本机执行设备</option>}{local.map(runner=><option key={runner.id} value={runner.id}>{runner.id}</option>)}</select></label><div className="secure-actions"><button type="button" disabled={busy||pending||!runnerId} onClick={()=>void choose()}>打开本机目录对话框</button>{pending&&<button type="button" disabled={busy} onClick={()=>void cancel()}>取消目录选择</button>}</div>{pending&&<p role="status">请在系统目录对话框选择或取消；尚未登记仓库。</p>}{query.error&&<p role="alert">选择状态读取失败。<button type="button" onClick={()=>void query.refetch()}>重新查询</button></p>}{selection?.state==="selected"&&selection.path&&<><p>候选目录：<code>{selection.path}</code></p><button type="button" onClick={()=>{onSelect({root:selection.path!,runnerId:selection.runnerId});setOperation(undefined);setMessage("候选目录已填入新仓库草稿，请填写标识、范围和验证要求后审阅配置计划。");}}>填入新仓库草稿</button></>}{selection?.state==="cancelled"&&<p role="status">已取消，配置没有变更。</p>}{selection?.state==="unavailable"&&<p role="alert">NATIVE_PICKER_UNAVAILABLE：本机目录对话框不可用。可手动填写所属设备路径并审阅登记计划。</p>}<p role="status">{message}</p></div>;
}
