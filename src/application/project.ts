import { inspectBasis } from "./basis.ts";
import { depthWrites, newDepth, readDepth, runRules } from "../domain/depth.ts";
import { createHash } from "node:crypto";
import type { BackendContext, ObjectResult } from "../../vendor/hetu-sdk.ts";
import {
  failure,
  fixed,
  requireValue as need,
  ProjectError,
  ProjectStore,
  success,
} from "../../vendor/project-store.ts";
import {
  canonical,
  clone,
  coverage,
  effects,
  KIND,
  PLUGIN_ID,
  sourceIndices,
  validate,
  validateAction,
} from "../domain/model.ts";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const bytes = (v: string) => Buffer.from(v, "utf8");
function boundary(b: Buffer, i: number) {
  return i === b.length || (i >= 0 && i < b.length && (b[i] & 0xc0) !== 0x80);
}
function span(text: string, start: number, end: number) {
  const b = bytes(text);
  need(
    start <= end && boundary(b, start) && boundary(b, end),
    "选区越界或不是UTF-8边界。",
  );
  return b.subarray(start, end);
}
function textOf(source: any) {
  need(typeof source?.content === "string", "此来源不是可读取的文稿。");
  return source.content as string;
}
export class Project {
  readonly store: ProjectStore;
  readonly context: BackendContext;
  constructor(context: BackendContext) {
    this.context = context;
    this.store = new ProjectStore(context, PLUGIN_ID, KIND, validate);
  }
  async sources(record: any) {
    return this.store.sources(record.object.source_refs ?? []);
  }
  async check(p: any, refs: any[]) {
    validate(p);
    for (const ref of p.depth?.basis_refs ?? [])
      await inspectBasis(this.store, ref);
    need(
      sourceIndices(p).every(
        (i) => Number.isInteger(i) && i >= 0 && i < refs.length,
      ),
      "固定来源索引越界。",
    );
    const sources = await this.store.sources(refs);
    const inspect = (v: any) => {
      if (!v || typeof v !== "object") return;
      if ("quote" in v) {
        const text = textOf(sources[v.source_index]);
        need(
          span(text, v.byte_start, v.byte_end).toString("utf8") === v.quote,
          "证据引文与固定来源不一致。",
        );
      }
      for (const x of Object.values(v)) inspect(x);
    };
    inspect(p);
    for (const i of p.issues)
      if (i.disposition === "resolved")
        need(
          i.resolution_source_indices.some(
            (n: number) => !i.evidence.some((e: any) => e.source_index === n),
          ),
          "复核必须提供区别于旧问题的新固定来源。",
        );
  }
  async save(input: any, p: any, old?: ObjectResult) {
    need(
      !(old?.object.content as any)?.depth || p.depth,
      "不能丢弃已有深化结构；请读取当前完整对象。",
      "hetu.stale_schema",
    );
    const previous: any = old?.object.content;
    if (previous?.depth?.runs.length) {
      for (const run of previous.depth.runs) {
        need(
          p.depth?.runs.some(
            (r: any) => r.id === run.id && canonical(r) === canonical(run),
          ),
          "固定运行不可改写；请另建运行。",
        );
        for (const id of run.state_event_ids)
          need(
            p.depth.state_events.some(
              (e: any) =>
                e.id === id &&
                canonical(e) ===
                  canonical(
                    previous.depth.state_events.find((v: any) => v.id === id),
                  ),
            ),
            "已被运行引用的状态不可改写；请另建事件。",
          );
      }
    }
    const refs = input.source_refs ?? old?.object.source_refs ?? [];
    await this.check(p, refs);
    return this.store.save(input, p, old);
  }
  async invoke(action: string, raw: unknown) {
    try {
      validateAction(action, raw);
      const i: any = clone(raw);
      if (effects.has(action)) {
        const recovered = await this.store.recover(i.operation_key);
        if (recovered) return recovered;
      }
      if (action === "get_operation")
        return this.store.call("hetu.extensions.operations.get", i);
      if (action === "list_projects")
        return this.store.call(
          i.query
            ? "hetu.extensions.objects.search"
            : "hetu.extensions.objects.list",
          { ...i, kind: KIND },
        );
      if (action === "save_project") {
        need(
          i.object_id
            ? i.expected_revision > 0 && i.expected_sha256.length === 64
            : i.expected_revision === 0 && i.expected_sha256 === "",
          "新建或更新基线无效。",
        );
        const old = i.object_id ? await this.store.baseline(i) : undefined;
        return await this.save(i, i.content, old);
      }
      if (action === "compare_versions") {
        const a = await this.store.get(i.object_id, i.from_revision),
          b = await this.store.get(i.object_id, i.to_revision);
        return success({
          from_ref: fixed(a),
          to_ref: fixed(b),
          changes: Object.keys(b.object.content as any).filter(
            (k) =>
              canonical((a.object.content as any)[k]) !==
              canonical((b.object.content as any)[k]),
          ),
        });
      }
      const r = effects.has(action)
          ? await this.store.baseline(i)
          : await this.store.get(i.object_id, i.revision),
        p: any = clone(r.object.content);
      if (effects.has(action)) {
        if (action === "save_depth" || depthWrites[action]) {
          if (action === "save_depth") p.depth = i.depth;
          else {
            p.depth ??= newDepth();
            const [field, key] = depthWrites[action];
            const at = p.depth[field].findIndex((v: any) => v.id === i[key].id);
            if (at < 0) p.depth[field].push(i[key]);
            else p.depth[field][at] = i[key];
          }
          if (action === "put_rule_run")
            runRules(p, i.run, await this.sources(r));
          return await this.save(i, p, r);
        }
        if (action === "set_disposition") {
          const issue = p.issues.find((x: any) => x.id === i.issue_id);
          need(issue, "问题不存在。");
          Object.assign(issue, {
            disposition: i.disposition,
            resolution: i.resolution,
            resolution_source_indices: i.resolution_source_indices,
          });
        } else {
          const [verb, item] = action.split("_");
          const fields: Record<string, string> = {
            check: "checks",
            issue: "issues",
          };
          const field = fields[item];
          need(field && ["put", "remove"].includes(verb), "未知写动作。");
          const list = p[field];
          if (verb === "put") {
            const at = list.findIndex((x: any) => x.id === i[item].id);
            if (at < 0) list.push(i[item]);
            else list[at] = i[item];
          } else {
            need(
              list.some((x: any) => x.id === i[item + "_id"]),
              "记录不存在。",
            );
            p[field] = list.filter((x: any) => x.id !== i[item + "_id"]);
          }
        }
        return await this.save(i, p, r);
      }
      if (action === "get_project") return success(r);
      if (action === "inspect_basis") {
        const ref = p.depth?.basis_refs?.[i.basis_index];
        need(ref, "专业依据索引不存在。");
        return success({
          project_ref: fixed(r),
          basis_ref: ref,
          record: await inspectBasis(this.store, ref),
        });
      }
      if (action === "get_coverage")
        return success({ project_ref: fixed(r), ...coverage(p) });
      if (action === "export_project") {
        const report = {
          format: "hetu." + KIND,
          version: 1,
          project_ref: fixed(r),
          work_ref: this.context.work_ref,
          source_refs: r.object.source_refs ?? [],
          project: p,
        };
        const json = JSON.stringify(report, null, 2);
        const markdown =
          "# " +
          p.title +
          "\n\n固定专业报告；采纳与定稿独立决定。\n\n```json\n" +
          json +
          "\n```\n";
        const content = i.format === "json" ? json : markdown,
          b = bytes(content),
          offset = i.offset ?? 0;
        need(boundary(b, offset), "导出偏移不是UTF-8边界。");
        let end = Math.min(b.length, offset + (i.max_bytes ?? 32768));
        while (!boundary(b, end)) end--;
        const chunk = b.subarray(offset, end).toString("utf8");
        return success({
          project_ref: fixed(r),
          content: chunk,
          offset,
          next_offset: end === b.length ? null : end,
          total_bytes: b.length,
          content_sha256: hash(chunk),
          media_type:
            i.format === "json" ? "application/json" : "text/markdown",
        });
      }
      const sources = await this.sources(r);
      const source = (index: number) => {
        need(index < sources.length, "来源索引越界。");
        return sources[index];
      };
      const depthResult = readDepth(p, action, i, sources);
      if (depthResult !== undefined)
        return success({ project_ref: fixed(r), ...depthResult });
      if (action === "get_source")
        return success({ project_ref: fixed(r), ...source(i.source_index) });
      if (action === "build_review_context") {
        const content = canonical({
          goal: i.goal,
          scope_indices: p.scope_indices,
          coverage: coverage(p),
          open_issues: p.issues.filter((x: any) => x.disposition === "open"),
          source_refs: r.object.source_refs ?? [],
        });
        need(
          [...content].length <= i.max_chars,
          "审校上下文超出预算，请缩小范围。",
          "hetu.budget_exceeded",
        );
        return success({
          project_ref: fixed(r),
          content,
          chars: [...content].length,
          bytes: bytes(content).length,
          token_count: null,
        });
      }
      if (action === "run_local_checks") {
        const text = textOf(source(i.source_index)),
          diagnostics: any[] = [];
        const report = (
          start: number,
          end: number,
          rule: string,
          message: string,
        ) =>
          diagnostics.push({
            rule,
            message,
            severity: "suggestion",
            source_index: i.source_index,
            byte_start: bytes(text.slice(0, start)).length,
            byte_end: bytes(text.slice(0, end)).length,
            quote: text.slice(start, end),
          });
        for (const term of p.rules.forbidden_terms) {
          let pos = 0;
          while ((pos = text.indexOf(term, pos)) >= 0) {
            report(
              pos,
              pos + term.length,
              "configured_term",
              "核对明确配置的词项",
            );
            pos += term.length;
          }
        }
        if (p.rules.punctuation)
          for (const m of text.matchAll(/[;；]|—{2,}|…{3,}/gu))
            report(
              m.index!,
              m.index! + m[0].length,
              "punctuation_preference",
              "标点偏好建议，由作者决定",
            );
        return success({
          project_ref: fixed(r),
          diagnostics,
          basis: "确定性配置规则，不能检测AI来源或替代语义审校",
        });
      }
      throw new ProjectError("未知动作。", "not_found");
    } catch (e) {
      return failure(e);
    }
  }
}
