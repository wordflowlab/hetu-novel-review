import { requireValue as need, canonical } from "../../vendor/project-store.ts";
export const depthWrites: Record<string, [string, string]> = {
  put_state_event: ["state_events", "state_event"],
  put_rule_run: ["runs", "run"],
};
export const newDepth = () => ({ version: 1, state_events: [], runs: [] });
export function validateDepth(p: any) {
  if (!p.depth) return;
  const d = p.depth;
  for (const key of ["state_events", "runs"])
    need(
      new Set(d[key].map((x: any) => x.id)).size === d[key].length,
      "深化记录ID重复。",
    );
  for (const e of d.state_events) {
    const actions: Record<string, string[]> = {
      balance: ["set", "add"],
      item: ["acquire", "transfer", "destroy"],
      condition: ["set", "assert"],
      knowledge: ["learn", "believe", "forget", "use"],
    };
    need(actions[e.kind]?.includes(e.action), "状态事件种类与动作不一致。");
    need(
      e.basis !== "observed" || e.evidence.length > 0,
      "已发生状态需要固定证据。",
    );
    if (e.kind === "balance")
      need(
        Number.isSafeInteger(e.number) &&
          e.unit !== null &&
          (e.action !== "set" || e.number >= 0),
        "余额事件需要安全整数与明确最小单位，不能混用小数精度。",
      );
    if (e.kind === "item")
      need(e.action === "destroy" || e.to !== null, "持有或转移需要明确目标。");
    if (e.kind === "condition") need(e.value !== null, "状态需要明确值。");
  }
  for (const r of d.runs) validateRun(p, r);
}
export function validateRun(p: any, r: any) {
  need(
    r.source_indices.length > 0 &&
      new Set(r.source_indices).size === r.source_indices.length &&
      r.source_indices.every((x: number) => p.scope_indices.includes(x)),
    "规则运行需要不重复的已声明范围。",
  );
  need(
    new Set(r.state_event_ids).size === r.state_event_ids.length &&
      r.state_event_ids.every((id: string) =>
        p.depth?.state_events.some((e: any) => e.id === id),
      ),
    "状态事件引用不存在或重复。",
  );
  for (const id of r.state_event_ids) {
    const e = p.depth.state_events.find((e: any) => e.id === id);
    need(
      e.evidence.every((q: any) => r.source_indices.includes(q.source_index)),
      "状态事件超出本次运行范围。",
    );
  }
  need(
    new Set(r.ruleset.dictionary.map((x: any) => x.id)).size ===
      r.ruleset.dictionary.length,
    "词表规则ID重复。",
  );
}
function cite(text: string, start: number, end: number, source_index: number) {
  return {
    source_index,
    byte_start: new TextEncoder().encode(text.slice(0, start)).length,
    byte_end: new TextEncoder().encode(text.slice(0, end)).length,
    quote: text.slice(start, end),
  };
}
export function runRules(p: any, run: any, sources: any[]) {
  validateRun(p, run);
  const diagnostics: any[] = [],
    results: any[] = [],
    all = new Map<string, any[]>();
  let chars = 0;
  const finding = (
    rule: string,
    message: string,
    evidence: any[],
    details: any = {},
  ) =>
    diagnostics.push({
      rule,
      message,
      status: "finding",
      severity: "suggestion",
      evidence,
      ...details,
    });
  for (const index of run.source_indices) {
    const text = sources[index]?.content;
    need(typeof text === "string", "规则运行需要可回读的固定文本。");
    chars += [...text].length;
    need(
      chars <= run.ruleset.max_chars,
      "规则运行超出显式字符预算。",
      "hetu.budget_exceeded",
    );
    // 精确句段口径只修剪边缘空白，不归一化作者文本。
    for (const m of text.matchAll(/[^。！？!?\r\n]+[。！？!?]?/gu)) {
      const raw = m[0],
        value = raw.trim();
      if ([...value].length < run.ruleset.duplicate_min_chars) continue;
      const start = m.index! + raw.indexOf(value),
        ev = cite(text, start, start + value.length, index),
        list = all.get(value) ?? [];
      list.push(ev);
      all.set(value, list);
    }
    for (const term of run.ruleset.dictionary) {
      let at = 0;
      while ((at = text.indexOf(term.term, at)) >= 0) {
        const start = at;
        at += term.term.length;
        const except = term.exceptions.some((x: string) => {
          let j = 0;
          while ((j = text.indexOf(x, j)) >= 0) {
            if (j <= start && j + x.length >= at) return true;
            j += Math.max(1, x.length);
          }
          return false;
        });
        if (!except)
          finding(
            "dictionary:" + term.id,
            "核对作者词表，建议使用“" + term.replacement + "”",
            [cite(text, start, at, index)],
            { dictionary_source: term.source },
          );
      }
    }
    if (run.ruleset.punctuation)
      for (const m of text.matchAll(/[;；]|—{2,}|…{3,}/gu))
        finding("punctuation-1", "核对明确启用的标点偏好", [
          cite(text, m.index!, m.index! + m[0].length, index),
        ]);
  }
  for (const occurrences of all.values())
    if (occurrences.length > 1)
      finding(
        "exact-sentence-1",
        "固定范围中出现相同句段；是否保留由作者决定",
        occurrences,
      );
  const localRules = [
    "exact-sentence-1",
    ...run.ruleset.dictionary.map((t: any) => "dictionary:" + t.id),
    ...(run.ruleset.punctuation ? ["punctuation-1"] : []),
  ];
  for (const rule of localRules)
    results.push({
      rule,
      status: diagnostics.some((x) => x.rule === rule) ? "finding" : "pass",
      checked_source_indices: run.source_indices,
    });
  const events = run.state_event_ids.map((id: string) =>
    p.depth.state_events.find((e: any) => e.id === id),
  );
  const state = new Map<string, any>();
  const ties = new Map<string, number>();
  for (const e of events.filter(
    (v: any) => v.basis === "observed" && !v.exception,
  )) {
    const k = canonical([
      e.layer,
      e.branch,
      e.entity_ref,
      e.kind,
      e.key,
      e.unit,
      e.order,
    ]);
    ties.set(k, (ties.get(k) ?? 0) + 1);
  }
  for (const e of [...events].sort((a, b) => a.order - b.order)) {
    const key = canonical([
        e.layer,
        e.branch,
        e.entity_ref,
        e.kind,
        e.key,
        e.unit,
      ]),
      tie = canonical([
        e.layer,
        e.branch,
        e.entity_ref,
        e.kind,
        e.key,
        e.unit,
        e.order,
      ]);
    let status = "pass",
      message = "已建立前提内一致",
      value = state.get(key);
    if (e.basis !== "observed") {
      results.push({
        rule: "state:" + e.id,
        status: "not_applicable",
        message: "计划和假设不作为已发生事实",
      });
      continue;
    }
    if (e.exception) {
      results.push({
        rule: "state:" + e.id,
        status: "not_applicable",
        message: "明确例外：" + e.exception,
        evidence: e.evidence,
      });
      state.delete(key);
      continue;
    }
    if ((ties.get(tie) ?? 0) > 1) {
      state.delete(key);
      results.push({
        rule: "state:" + e.id,
        status: "inconclusive",
        message: "相同顺序的状态变化不可擅自排序",
      });
      continue;
    }
    if (e.kind === "balance") {
      if (e.action === "set") value = e.number;
      else if (typeof value !== "number") {
        status = "inconclusive";
        message = "起始余额未知，不能当作零";
      } else {
        value += e.number;
        if (value < 0) {
          status = "finding";
          message = "已知同单位余额不足";
        }
      }
      if (typeof value === "number") state.set(key, value);
    } else if (e.kind === "item") {
      if (e.action === "acquire") {
        if (value !== undefined && value !== null && value !== e.to) {
          status = "finding";
          message = "已有持有人，需核对取得依据";
        }
        state.set(key, e.to);
      } else {
        if (value === undefined) {
          status = "inconclusive";
          message = "原持有人未知";
        } else if (value !== e.from) {
          status = "finding";
          message = "转出方与已知持有人不符";
        }
        state.set(key, e.action === "destroy" ? null : e.to);
      }
    } else if (e.kind === "condition") {
      if (e.action === "assert") {
        if (value === undefined) {
          status = "inconclusive";
          message = "此前状态未知";
        } else if (value !== e.value) {
          status = "finding";
          message = "断言与已知状态不一致";
        }
      } else {
        if (value === "dead" && e.value === "alive") {
          status = "finding";
          message = "死亡后恢复活动，需要复生、假死或其他明确依据";
        }
        state.set(key, e.value);
      }
    } else {
      if (e.action === "use") {
        if (value === "forgotten") {
          status = "finding";
          message = "明确遗忘后使用信息，需交代重新获知";
        } else if (value !== "known") {
          status = "inconclusive";
          message =
            value === "belief" ? "误信不等于已核实知情" : "缺少人物获知前提";
        }
      } else
        state.set(
          key,
          e.action === "learn"
            ? "known"
            : e.action === "believe"
              ? "belief"
              : "forgotten",
        );
    }
    const result = {
      rule: "state:" + e.id,
      status,
      message,
      evidence: e.evidence,
      entity_ref: e.entity_ref,
    };
    results.push(result);
    if (status === "finding")
      diagnostics.push({ ...result, severity: "suggestion" });
  }
  return {
    run,
    diagnostics,
    results,
    actual_chars: chars,
    measurement_version: "exact-sentence-1;utf8-1;state-1",
    checked_source_indices: run.source_indices,
    complete: !results.some((x) => x.status === "inconclusive"),
    semantic_review_required: true,
    scope_note: "仅覆盖本次固定文本与明确事件，不证明全书无误",
  };
}
export function readDepth(p: any, action: string, i: any, sources: any[]): any {
  if (action === "preview_rule_run") return runRules(p, i.run, sources);
  if (action === "get_rule_run") {
    const r = p.depth?.runs.find((r: any) => r.id === i.run_id);
    need(r, "固定运行不存在。");
    return runRules(p, r, sources);
  }
  if (action === "preview_recheck") {
    const old = p.depth?.runs.find((r: any) => r.id === i.old_run_id);
    need(old, "旧固定运行不存在。");
    const before = runRules(p, old, sources),
      after = runRules(p, i.run, sources);
    const signature = (d: any) =>
      canonical([d.rule, d.evidence?.map((e: any) => e.quote)]);
    return {
      before,
      after,
      findings: before.diagnostics.map((d) => ({
        rule: d.rule,
        old_evidence: d.evidence,
        status: after.diagnostics.some((x) => signature(x) === signature(d))
          ? "persists"
          : "not_reproduced",
        requires_author_disposition: true,
      })),
      new_findings: after.diagnostics.filter(
        (x) => !before.diagnostics.some((d) => signature(x) === signature(d)),
      ),
      issues_unchanged: true,
    };
  }
  return undefined;
}
