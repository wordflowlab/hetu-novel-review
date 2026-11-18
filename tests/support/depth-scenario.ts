import assert from "node:assert/strict";
import { newProject } from "../../src/domain/model.ts";
import { newDepth } from "../../src/domain/depth.ts";
export function state(
  id: string,
  kind = "balance",
  action = "set",
  ev: any = null,
): any {
  return {
    id,
    entity_ref: "lin",
    order: 1,
    layer: "reality",
    branch: "main",
    basis: "observed",
    kind,
    action,
    key: "cash",
    number: 10,
    value: null,
    unit: "coin",
    from: null,
    to: null,
    exception: null,
    evidence: ev ? [ev] : [],
  };
}
export function fixtureContent(ev: any) {
  const p = newProject("雨港审校深化");
  p.scope_indices = [0];
  p.depth = {
    ...newDepth(),
    state_events: [
      state("initial", "balance", "set", ev),
      { ...state("spend", "balance", "add", ev), order: 2, number: -12 },
    ],
  };
  return p;
}
export const ruleset = () => ({
  id: "author-dictionary",
  version: "1",
  duplicate_min_chars: 2,
  max_chars: 100000,
  dictionary: [
    {
      id: "name",
      term: "雨港",
      replacement: "雨港",
      source: "作者专名词表",
      exceptions: ["雨港。"],
    },
  ],
  punctuation: true,
});
export async function runDepthScenario(c: any, refs: any[], ev: any) {
  let r = await c.invoke("save_project", {
      content: fixtureContent(ev),
      source_refs: refs,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "depth-create",
    }),
    serial = 0;
  const write = async (a: string, i: any) =>
    (r = await c.invoke(a, {
      object_id: r.object.object_id,
      expected_revision: r.object.revision,
      expected_sha256: r.sha256,
      operation_key: "depth-" + ++serial,
      ...i,
    }));
  const read = (a: string, i: any) =>
    c.invoke(a, {
      object_id: r.object.object_id,
      revision: r.object.revision,
      ...i,
    });
  await write("save_depth", { depth: r.object.content.depth });
  await write("put_state_event", {
    state_event: {
      ...state("unknown", "balance", "add", ev),
      entity_ref: "chen",
      number: -5,
    },
  });
  const run = {
    id: "run",
    source_indices: [0],
    state_event_ids: ["initial", "spend", "unknown"],
    ruleset: ruleset(),
  };
  const out = await read("preview_rule_run", { run });
  assert.equal(
    out.results.find((x: any) => x.rule === "state:spend").status,
    "finding",
  );
  assert.equal(
    out.results.find((x: any) => x.rule === "state:unknown").status,
    "inconclusive",
  );
  await write("put_rule_run", { run });
  const fixed = await read("get_rule_run", { run_id: "run" });
  assert.deepEqual(fixed.results, out.results);
  const recheck = await read("preview_recheck", {
    old_run_id: "run",
    run: { ...run, id: "recheck" },
  });
  assert.equal(recheck.issues_unchanged, true);
  const previous = {
    owner_plugin_id: "org.wordflowlab.novel-review",
    object_id: r.object.object_id,
    revision: r.object.revision,
    sha256: r.sha256,
  };
  await write("save_depth", {
    depth: { ...r.object.content.depth, basis_refs: [previous] },
  });
  const basis = await read("inspect_basis", { basis_index: 0 });
  assert.equal(basis.record.sha256, previous.sha256);
  return r;
}
