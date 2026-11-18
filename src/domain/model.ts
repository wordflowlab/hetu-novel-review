import { validateDepth } from "./depth.ts";
import manifest from "../../contracts/plugin-manifest.json" with { type: "json" };
import {
  canonical,
  clone,
  requireValue as need,
} from "../../vendor/project-store.ts";
import * as validators from "./validators.ts";
export { canonical, clone };
export const PLUGIN_ID = manifest.id,
  KIND = manifest.contributions.data[0].kind,
  WORK_KIND = "novel";
export const effects = new Set(
  manifest.contributions.actions
    .filter((a) => a.effect === "managed_write")
    .map((a) => a.id),
);
export const domains = [
  "continuity",
  "characters",
  "promises",
  "pacing",
  "prose",
  "canon",
];
export function validateAction(action: string, input: unknown) {
  const f = (validators as any)[action];
  need(f, "未知专业动作。", "not_found");
  need(f(input), "动作参数不符合Schema：" + JSON.stringify(f.errors));
}
export function validate(p: any) {
  const f = (validators as any).project;
  need(f(p), "专业数据不符合Schema：" + JSON.stringify(f.errors));
  validateDepth(p);
  for (const [k, list] of Object.entries(p))
    if (
      Array.isArray(list) &&
      list.some((v) => v && typeof v === "object" && "id" in v)
    ) {
      const ids = list.map((v) => v.id);
      need(new Set(ids).size === ids.length, "重复专业ID：" + k);
    }
  {
    need(
      new Set(p.scope_indices).size === p.scope_indices.length,
      "审校范围重复。",
    );
    const covered = new Set<string>();
    for (const c of p.checks)
      for (const index of c.source_indices) {
        const key = c.domain + ":" + index;
        need(
          !covered.has(key),
          "同一来源与审校域只能有一份当前结论，请更新原检查。",
        );
        covered.add(key);
      }
    for (const c of p.checks) {
      need(
        new Set(c.source_indices).size === c.source_indices.length &&
          c.source_indices.every((i: number) => p.scope_indices.includes(i)),
        "检查超出声明范围。",
      );
      need(c.status === "unchecked" || c.summary.trim(), "检查结论需要说明。");
    }
    for (const i of p.issues) {
      need(i.evidence.length > 0, "问题需要固定证据。");
      need(
        i.evidence.every((e: any) => p.scope_indices.includes(e.source_index)),
        "问题超出审校范围。",
      );
      if (i.disposition === "resolved")
        need(
          i.resolution.trim() && i.resolution_source_indices.length,
          "解决需要复核说明与新来源。",
        );
      if (i.disposition === "dismissed")
        need(i.resolution.trim(), "忽略需要说明。");
    }
  }
}
export function newProject(title = "未命名方案"): any {
  return {
    format_version: 1,
    title,
    framework_version: "1",
    scope_indices: [],
    checks: [],
    issues: [],
    rules: { punctuation: false, forbidden_terms: [] },
  };
}
export function sourceIndices(p: any): number[] {
  const out: number[] = [];
  function visit(v: any) {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if ((k === "source_index" || k.endsWith("_source_index")) && x !== null)
        out.push(x as number);
      else if (
        [
          "source_indices",
          "scope_indices",
          "resolution_source_indices",
        ].includes(k)
      )
        out.push(...(x as number[]));
      else visit(x);
    }
  }
  visit(p);
  return out;
}
export function coverage(p: any) {
  return {
    domains: domains.map((domain) => ({
      domain,
      sources: p.scope_indices.map((source_index: number) => {
        const c = p.checks.filter(
          (c: any) =>
            c.domain === domain && c.source_indices.includes(source_index),
        );
        return {
          source_index,
          status: c.length ? c.at(-1).status : "unchecked",
          checks: c.map((x: any) => x.id),
        };
      }),
    })),
    open_issues: p.issues.filter((x: any) => x.disposition === "open").length,
  };
}
