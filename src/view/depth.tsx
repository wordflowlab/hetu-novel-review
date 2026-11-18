import React, { useState } from "react";
const labels: Record<string, string> = {
 finding: "发现问题", pass: "前提内通过", inconclusive: "无法判断", not_applicable: "不适用",
 balance: "余额", item: "器物", condition: "人物状态", knowledge: "人物知情", observed: "已发生", planned: "规划", hypothesis: "假设",
 set:"记录状态",add:"收支变化",acquire:"取得",transfer:"转移",destroy:"销毁",assert:"核对状态",learn:"获知",believe:"相信",forget:"遗忘",use:"使用信息"
};
export function DepthView({p,invoke,onError}:{p:any;invoke:(a:string,i:any)=>Promise<any>;onError:(e:any)=>void}) {
 const [result,setResult]=useState<any>();
 const quote=(e:any,i:number)=><blockquote key={i}>{e.quote}<small>固定来源 {e.source_index+1}</small></blockquote>;
 const ruleName=(id:string)=>id==="exact-sentence-1"?"精确句段重复":id==="punctuation-1"?"标点偏好":id.startsWith("dictionary:")?"作者词表":id.startsWith("state:")?"状态一致性":"专业规则";
 return <section aria-label="规则执行与状态"><h3>固定规则运行</h3>{!p.depth?.runs.length&&<p>尚无专业运行。让Agent选择固定范围、词表和状态事件后执行。</p>}
 {p.depth?.runs.map((r:any)=><article key={r.id}><div className="row"><h3>规则组 {r.ruleset.version}</h3><span>{r.source_indices.length} 份固定文本</span><button onClick={()=>void invoke("get_rule_run",{run_id:r.id}).then(setResult).catch(onError)}>查看运行结果</button></div><p>精确重复最短 {r.ruleset.duplicate_min_chars} 字符，作者词表 {r.ruleset.dictionary.length} 项。</p><details><summary>规则依据</summary><p>{r.ruleset.id}，版本 {r.ruleset.version}</p></details></article>)}
 {result&&<section aria-label="规则运行结果"><div className="row"><h3>检查结果</h3><span>读取 {result.actual_chars} 字符，{result.diagnostics.length} 项建议</span></div><p className="muted">{result.scope_note}</p>
 {result.diagnostics.map((d:any,i:number)=><article key={i}><h3>{ruleName(d.rule)}</h3><p>{d.message}</p>{d.evidence?.map(quote)}</article>)}
 {result.results.filter((r:any)=>r.status==="inconclusive").map((r:any)=><article key={r.rule}><h3>需要补充依据</h3><p>{r.message}</p>{r.evidence?.map(quote)}</article>)}
 <details><summary>全部规则执行明细</summary>{result.results.map((r:any)=><p key={r.rule}>{ruleName(r.rule)}：{labels[r.status]} {r.message??""}</p>)}</details></section>}
 <details><summary>有据状态事件（{p.depth?.state_events.length??0}）</summary>{p.depth?.state_events.map((e:any)=><article key={e.id}><div className="row"><h3>{labels[e.kind]}：{e.key}</h3><span>{labels[e.basis]}，顺序 {e.order}</span></div><p>{labels[e.action]} {e.number??e.value??""} {e.unit??""}</p>{e.evidence.map(quote)}{e.exception&&<p>明确例外：{e.exception}</p>}<details><summary>对象与叙事范围</summary><p>{e.entity_ref}，{e.layer}，{e.branch}</p></details></article>)}</details></section>;
}
