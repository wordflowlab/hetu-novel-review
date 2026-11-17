import { canonical } from "../vendor/project-store.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import manifest from "../contracts/plugin-manifest.json" with { type: "json" };
import { newProject, validate } from "../src/domain/model.ts";
import { memoryCore } from "./support/memory-core.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const before = "雨港。\r\n林溪说：“等一等。” 🌧️\n雨港。\n";
const evidence = {
  source_index: 0,
  byte_start: 0,
  byte_end: 9,
  quote: "雨港。",
};
export function fixture() {
  const c = memoryCore();
  const ref: any = {
    kind: "document",
    work_ref: c.work,
    document_id: "document_original",
    revision_id: "revision_original",
    sha256: sha(before),
  };
  c.sources.set(canonical(ref), { source_ref: ref, content: before });
  return { c, ref, before };
}
const base = (r: any, key: string) => ({
  object_id: r.object.object_id,
  expected_revision: r.object.revision,
  expected_sha256: r.sha256,
  operation_key: key,
});
async function create(c: any, refs: any[] = []) {
  const r = await c.invoke("save_project", {
    content: newProject("雨港来信"),
    source_refs: refs,
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "create",
  });
  assert.equal(r.status, "succeeded", JSON.stringify(r));
  return r.data;
}
function value(r: any) {
  assert.equal(r.status, "succeeded", JSON.stringify(r));
  return r.data;
}
const bad = (r: any, code?: string) => {
  assert.equal(r.status, "failed", JSON.stringify(r));
  if (code) assert.equal(r.error.code, code);
};
test("默认数据与闭合Schema", () => {
  validate(newProject());
  const p = newProject();
  p.extra = true;
  assert.throws(() => validate(p));
});
test("未知动作与多余参数拒绝", async () => {
  const { c } = fixture();
  bad(await c.invoke("not_a_tool", {}), "not_found");
  bad(await c.invoke("list_projects", { secret: "x" }));
});
test("CAS、历史读取、同键重放与异输入冲突", async () => {
  const { c } = fixture();
  let r = await create(c);
  const input = {
    ...base(r, "update"),
    content: { ...r.object.content, title: "第二版" },
  };
  r = value(await c.invoke("save_project", input));
  assert.equal(r.object.revision, 2);
  assert.equal(value(await c.invoke("save_project", input)).sha256, r.sha256);
  bad(
    await c.invoke("save_project", {
      ...input,
      content: { ...input.content, title: "换输入" },
    }),
    "idempotency_conflict",
  );
  bad(
    await c.invoke("save_project", { ...input, operation_key: "old" }),
    "revision_conflict",
  );
  assert.equal(
    value(
      await c.invoke("get_project", {
        object_id: r.object.object_id,
        revision: 1,
      }),
    ).object.content.title,
    "雨港来信",
  );
});
test("响应丢失沿原键恢复，未重复写入", async () => {
  const { c } = fixture();
  const r = await create(c),
    i = {
      ...base(r, "lost"),
      content: { ...r.object.content, title: "丢失响应" },
    };
  c.failAfterWrite = true;
  bad(await c.invoke("save_project", i));
  const op = value(await c.invoke("get_operation", { operation_key: "lost" }));
  assert.equal(op.object.revision, 2);
  assert.equal(value(await c.invoke("save_project", i)).sha256, op.sha256);
  assert.equal(c.writes, 2);
});
test("未知原操作不能继续写", async () => {
  const { c } = fixture();
  c.unknown = true;
  bad(
    await c.invoke("save_project", {
      content: newProject(),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "unknown",
    }),
    "unknown",
  );
  assert.equal(c.writes, 0);
});
test("固定来源不存在失败", async () => {
  const { c, ref } = fixture();
  const badRef = { ...ref, sha256: "f".repeat(64) };
  bad(
    await c.invoke("save_project", {
      content: newProject(),
      source_refs: [badRef],
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "bad-source",
    }),
    "not_found",
  );
});
test("来源只追加，不重定向旧索引", async () => {
  const { c, ref } = fixture();
  const r = await create(c, [ref]);
  bad(
    await c.invoke("save_project", {
      ...base(r, "replace"),
      source_refs: [],
      content: r.object.content,
    }),
    "hetu.stale_evidence",
  );
});
test("列表、搜索、比较和固定导出分块", async () => {
  const { c } = fixture();
  let r = await create(c);
  assert.equal(
    value(await c.invoke("list_projects", { query: "雨港" })).objects.length,
    1,
  );
  r = value(
    await c.invoke("save_project", {
      ...base(r, "second"),
      content: { ...r.object.content, title: "雨港新版" },
    }),
  );
  assert.deepEqual(
    value(
      await c.invoke("compare_versions", {
        object_id: r.object.object_id,
        from_revision: 1,
        to_revision: 2,
      }),
    ).changes,
    ["title"],
  );
  let out = "",
    offset = 0;
  do {
    const x = value(
      await c.invoke("export_project", {
        object_id: r.object.object_id,
        revision: 2,
        format: "json",
        offset,
        max_bytes: 71,
      }),
    );
    assert.equal(sha(x.content), x.content_sha256);
    out += x.content;
    if (x.next_offset === null) break;
    offset = x.next_offset;
  } while (true);
  assert.equal(JSON.parse(out).project.title, "雨港新版");
  bad(
    await c.invoke("export_project", {
      object_id: r.object.object_id,
      format: "json",
      offset: 999999,
    }),
  );
});
test("专业对象大小与标题字节预算", async () => {
  const { c } = fixture();
  const p = newProject("雨".repeat(180));
  bad(
    await c.invoke("save_project", {
      content: p,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "long",
    }),
  );
});
{
  test("六域覆盖保留未检查与无法判断", async () => {
    const { c, ref } = fixture();
    let r = await create(c, [ref]);
    const p: any = r.object.content;
    p.scope_indices = [0];
    r = value(
      await c.invoke("save_project", { ...base(r, "scope"), content: p }),
    );
    const a = {
      id: "ch1",
      domain: "continuity",
      status: "inconclusive",
      source_indices: [0],
      summary: "缺少前章",
    };
    r = value(await c.invoke("put_check", { ...base(r, "check"), check: a }));
    const cov = value(
      await c.invoke("get_coverage", { object_id: r.object.object_id }),
    );
    assert.equal(cov.domains[0].sources[0].status, "inconclusive");
    assert.equal(cov.domains[1].sources[0].status, "unchecked");
    bad(
      await c.invoke("put_check", {
        ...base(r, "out"),
        check: { ...a, id: "c2", source_indices: [1] },
      }),
    );
  });
  test("问题必须有据；候选存在不表示解决；忽略有说明", async () => {
    const { c, ref } = fixture();
    let r = await create(c, [ref]);
    r = value(
      await c.invoke("save_project", {
        ...base(r, "scope"),
        content: { ...r.object.content, scope_indices: [0] },
      }),
    );
    const issue = {
      id: "i1",
      title: "人物动机不清",
      domain: "characters",
      severity: "major",
      description: "等待原因尚缺交代",
      evidence: [evidence],
      disposition: "open",
      candidate_source_index: null,
      resolution: "",
      resolution_source_indices: [],
    };
    r = value(await c.invoke("put_issue", { ...base(r, "issue"), issue }));
    bad(
      await c.invoke("set_disposition", {
        ...base(r, "resolve"),
        issue_id: "i1",
        disposition: "resolved",
        resolution: "完成",
        resolution_source_indices: [0],
      }),
    );
    bad(
      await c.invoke("set_disposition", {
        ...base(r, "dismiss-empty"),
        issue_id: "i1",
        disposition: "dismissed",
        resolution: "",
        resolution_source_indices: [],
      }),
    );
    r = value(
      await c.invoke("set_disposition", {
        ...base(r, "dismiss"),
        issue_id: "i1",
        disposition: "dismissed",
        resolution: "作者有意保留悬念",
        resolution_source_indices: [],
      }),
    );
    assert.equal(r.object.content.issues[0].disposition, "dismissed");
  });
  test("规则检查给UTF-8位置且不改正文", async () => {
    const { c, ref } = fixture();
    let r = await create(c, [ref]);
    r = value(
      await c.invoke("save_project", {
        ...base(r, "rules"),
        content: {
          ...r.object.content,
          rules: { punctuation: true, forbidden_terms: ["林溪"] },
        },
      }),
    );
    const checked = value(
      await c.invoke("run_local_checks", {
        object_id: r.object.object_id,
        source_index: 0,
      }),
    );
    assert.equal(checked.diagnostics.length, 1);
    const d = checked.diagnostics[0];
    assert.equal(
      Buffer.from(before).subarray(d.byte_start, d.byte_end).toString(),
      d.quote,
    );
    assert.equal(c.writes, 2);
  });
}
test("同包Skill与动作Schema齐全", async () => {
  const { readFile } = await import("node:fs/promises");
  const skill = manifest.contributions.skills[0];
  for (const file of [
    skill.entry,
    "skills/" + skill.name + "/references/workflow.md",
    "skills/" + skill.name + "/references/operations.md",
  ])
    assert.ok((await readFile(file, "utf8")).length > 100);
  for (const action of manifest.contributions.actions) {
    assert.ok(action.input_schema.required);
    assert.ok(
      action.effect === "read" || action.input_schema.properties.operation_key,
    );
  }
});

test("同一来源与审校域拒绝互相矛盾的重复覆盖", () => {
  const p = newProject();
  p.scope_indices = [0];
  p.checks = [
    {
      id: "a",
      domain: "continuity",
      status: "pass",
      source_indices: [0],
      summary: "核对无误",
    },
    {
      id: "b",
      domain: "continuity",
      status: "finding",
      source_indices: [0],
      summary: "发现问题",
    },
  ];
  assert.throws(() => validate(p));
});
