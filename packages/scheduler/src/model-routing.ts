import type { KeywordEvidence, ModelRoutingRule, RoutingRuleResult, TaskClassification, TaskModelRoutingConfig, TaskTypeDefinition } from "@dispatcher/domain";

/** Normalize for matching only; offsets refer to the untouched UTF-16 input. */
function normalize(text:string):{text:string;spans:Array<{start:number;end:number}>} {
  let output="";const spans:Array<{start:number;end:number}>=[];
  for(const segment of new Intl.Segmenter("und",{granularity:"grapheme"}).segment(text)) {
    const normalized=segment.segment.normalize("NFKC").toLowerCase();
    for(const character of normalized){
      if(/\s/u.test(character)){
        if(output.endsWith(" ")){spans[spans.length-1]!.end=segment.index+segment.segment.length;continue;}
        output+=" ";spans.push({start:segment.index,end:segment.index+segment.segment.length});
      }else{output+=character;for(let i=0;i<character.length;i++)spans.push({start:segment.index,end:segment.index+segment.segment.length});}
    }
  }
  return {text:output,spans};
}
export function classifyKeywords(input:{title:string;description:string},types:TaskTypeDefinition[]):TaskClassification {
  const fields=(["title","description"] as const).map(field=>({field,original:input[field],normalized:normalize(input[field])}));
  const candidates:string[]=[],evidence:KeywordEvidence[]=[];
  for(const type of [...types].filter(entry=>entry.enabled).sort((a,b)=>a.id.localeCompare(b.id))){
    const match=(keyword:string):KeywordEvidence|undefined=>{
      const needle=normalize(keyword).text.trim();if(!needle)return undefined;
      const english=/[a-z]/i.test(needle)&&Array.from(needle).every(character=>character.codePointAt(0)!<=0x7f);
      for(const {field,original,normalized} of fields){
        let position=normalized.text.indexOf(needle);
        while(position>=0){
          const before=normalized.text[position-1]??"",after=normalized.text[position+needle.length]??"";
          if(!english||!/[a-z0-9_]/i.test(before)&&!/[a-z0-9_]/i.test(after)){
            const start=normalized.spans[position]!.start,end=normalized.spans[position+needle.length-1]!.end;
            return {taskTypeId:type.id,keyword,field,quote:original.slice(start,end),start,end};
          }
          position=normalized.text.indexOf(needle,position+1);
        }
      }
      return undefined;
    };
    const hits:KeywordEvidence[]=[];
    for(const group of type.keywordGroups){
      if(!group.any.length&&!group.all.length)continue;
      const any=group.any.map(match).filter((hit):hit is KeywordEvidence=>Boolean(hit)),all=group.all.map(match);
      if((!group.any.length||any.length>0)&&all.every(Boolean)&&!group.exclude.some(keyword=>Boolean(match(keyword))))hits.push(...any,...all.filter((hit):hit is KeywordEvidence=>Boolean(hit)));
    }
    if(hits.length){candidates.push(type.id);evidence.push(...hits);}
  }
  return {status:candidates.length===1?"matched":candidates.length?"ambiguous":"unclassified",primaryType:candidates.length===1?candidates[0]!:null,candidates,evidence};
}
function targetKey(rule:ModelRoutingRule):string{return JSON.stringify([rule.target.modelSelectionId,rule.target.reasoning.mode,rule.target.reasoning.mode==="explicit"?rule.target.reasoning.value:null]);}
export function selectModelRoutingRule(config:TaskModelRoutingConfig,context:{repositoryId:string;profileId:string;taskTypeId:string}):RoutingRuleResult {
  const excluded:RoutingRuleResult["excluded"]=[],eligible:ModelRoutingRule[]=[];
  for(const rule of [...config.rules].sort((a,b)=>a.id.localeCompare(b.id))){
    const reason=!rule.enabled?"disabled":rule.profileId!==context.profileId?"profile-mismatch":rule.taskTypeId!==context.taskTypeId?"task-type-mismatch":rule.repositoryId&&rule.repositoryId!==context.repositoryId?"repository-mismatch":undefined;
    if(reason)excluded.push({ruleId:rule.id,reason});else eligible.push(rule);
  }
  if(!eligible.length)return {status:"NO_MATCHING_RULE",ruleIds:[],excluded};
  const project=eligible.filter(rule=>rule.repositoryId===context.repositoryId),scope=project.length?"project":"global",scoped=project.length?project:eligible;
  for(const rule of eligible.filter(rule=>!scoped.includes(rule)))excluded.push({ruleId:rule.id,reason:"project-rule-preferred"});
  const priority=Math.max(...scoped.map(rule=>rule.priority)),winners=scoped.filter(rule=>rule.priority===priority);
  for(const rule of scoped.filter(rule=>rule.priority!==priority))excluded.push({ruleId:rule.id,reason:"lower-priority"});
  const ruleIds=winners.map(rule=>rule.id);
  return new Set(winners.map(targetKey)).size>1?{status:"RULE_CONFLICT",ruleIds,excluded,scope,priority}:{status:"matched",ruleIds,excluded,scope,priority,target:structuredClone(winners[0]!.target)};
}
