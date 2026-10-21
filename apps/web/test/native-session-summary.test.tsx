// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import type {RunNativeSessionView} from "@dispatcher/domain";
import {NativeSessionSummary} from "../src/NativeSessionSummary.js";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const view:RunNativeSessionView={version:1,mutationAvailable:false,runId:"r",sessionId:"s",profileId:"p",generation:1,attempt:2,identity:"bound",binding:{product:"codex",region:"global",profileId:"p",backendId:"exec",runnerId:"local",nativeSessionId:"native-thread"},control:{state:"HUMAN",epoch:4,revision:8,exclusion:"cooperative"},execution:{kind:"managed-worktree",worktree:"/managed/worktree",runnerId:"local"},state:"unknown",freshness:"stale",observedAt:"2026-10-20T12:00:00Z",completeness:"unknown",requestedModel:{id:"requested-model",reasoning:"high"},reportedModel:{id:"reported-model"},capabilities:[{name:"sameSessionContinue",support:"unknown"}],access:[]};
it("shows separate requested and last reported facts while keeping stale state unresolved and avoiding native actions",()=>{
 const fetch=vi.spyOn(globalThis,"fetch");const {container}=render(<NativeSessionSummary view={view}/>);expect(screen.getByText('请求模型：requested-model')).toBeTruthy();expect(screen.getByText('上次原生报告模型：reported-model')).toBeTruthy();expect(screen.getByText('控制权：人工')).toBeTruthy();expect(screen.getByText('原生状态：待核对')).toBeTruthy();expect(screen.getByText('观测：已过期')).toBeTruthy();expect(container.querySelectorAll('button,a').length).toBe(0);expect(fetch).not.toHaveBeenCalled();
});
it("keeps missing and conflicting identity explicit without inventing a native session",()=>{
 const {rerender}=render(<NativeSessionSummary/>);expect(screen.getByText('尚无已保存的原生会话摘要。')).toBeTruthy();const conflict:RunNativeSessionView={...view,identity:"conflict",binding:null,control:null};delete conflict.requestedModel;delete conflict.reportedModel;rerender(<NativeSessionSummary view={conflict}/>);expect(screen.getByText('身份：冲突，待核对')).toBeTruthy();expect(screen.getByText('控制权：未知')).toBeTruthy();expect(screen.queryByText('native-thread')).toBeNull();expect(screen.getByText('上次原生报告模型：未知')).toBeTruthy();
});
it("renders only the allowlisted identity fields and treats deleted sessions as unavailable",()=>{
 const binding={...view.binding!,nativeStoreRef:"private-native-storage"};const {container}=render(<NativeSessionSummary view={{...view,binding,identity:"deleted",state:"deleted",freshness:"unknown"}}/>);expect(screen.getByText('身份：已删除')).toBeTruthy();expect(screen.getByText('原生状态：已删除')).toBeTruthy();expect(container.textContent).not.toContain('private-native-storage');expect(container.textContent).toContain('原生接管与交还暂不可用');
});
