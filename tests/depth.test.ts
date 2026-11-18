import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical } from "../vendor/project-store.ts";
import { memoryCore } from "./support/memory-core.ts";
import {
  fixtureContent,
  state,
  ruleset,
  runDepthScenario,
} from "./support/depth-scenario.ts";
import { newProject, validate } from "../src/domain/model.ts";
import { runRules, readDepth } from "../src/domain/depth.ts";
const text = "雨港。🌧️林溪还在等待。\r\n雨港。\n",
  ev = { source_index: 0, byte_start: 0, byte_end: 9, quote: "雨港。" };
const p = () => fixtureContent(ev),
  run = (ids: string[] = []) => ({
    id: "run",
    source_indices: [0],
    state_event_ids: ids,
    ruleset: ruleset(),
  });
test("NRD-01/02 exact repeated Chinese sentence and original UTF8 coordinates", () => {
  const r = runRules(p(), run(), [{ content: text }]),
    d = r.diagnostics.find((x) => x.rule === "exact-sentence-1")!;
  assert.equal(d.evidence.length, 2);
  for (const q of d.evidence)
    assert.equal(
      Buffer.from(text).subarray(q.byte_start, q.byte_end).toString(),
      q.quote,
    );
  assert.equal(r.measurement_version.includes("utf8"), true);
});
test("NRD-03 author proper-name exceptions suppress dictionary finding", () => {
  const r = runRules(p(), run(), [{ content: text }]);
  assert.equal(
    r.diagnostics.some((x) => x.rule === "dictionary:name"),
    false,
  );
});
test("NRD-04 unknown initial balance remains inconclusive and units do not mix", () => {
  const a = p();
  a.depth.state_events = [
    { ...state("unknown", "balance", "add", ev), number: -5 },
    { ...state("initial", "balance", "set", ev), unit: "gold", order: 0 },
  ];
  const r = runRules(a, run(["initial", "unknown"]), [{ content: text }]);
  assert.equal(
    r.results.find((x) => x.rule === "state:unknown").status,
    "inconclusive",
  );
});
test("NRD-05 repeated spending catches known shortfall", () => {
  const r = runRules(p(), run(["initial", "spend"]), [{ content: text }]);
  assert.equal(
    r.results.find((x) => x.rule === "state:spend").status,
    "finding",
  );
});
test("NRD-06 planned, dream and explicit exception are separate", () => {
  const a = p();
  a.depth.state_events = [
    { ...state("plan", "balance", "add", ev), basis: "planned", number: -100 },
    { ...state("dream", "balance", "add", ev), layer: "dream", number: -100 },
    {
      ...state("exception", "balance", "add", ev),
      exception: "向同伴借款",
      number: -100,
    },
  ];
  const r = runRules(a, run(["plan", "dream", "exception"]), [
    { content: text },
  ]);
  assert.equal(
    r.results.find((x) => x.rule === "state:plan").status,
    "not_applicable",
  );
  assert.equal(
    r.results.find((x) => x.rule === "state:dream").status,
    "inconclusive",
  );
  assert.equal(
    r.results.find((x) => x.rule === "state:exception").status,
    "not_applicable",
  );
});
test("NRD-07 knowledge belief is not verified knowledge", () => {
  const a = p();
  a.depth.state_events = [
    {
      ...state("believe", "knowledge", "believe", ev),
      number: null,
      unit: null,
      key: "sender",
    },
    {
      ...state("use", "knowledge", "use", ev),
      number: null,
      unit: null,
      key: "sender",
      order: 2,
    },
  ];
  const r = runRules(a, run(["believe", "use"]), [{ content: text }]);
  assert.equal(
    r.results.find((x) => x.rule === "state:use").status,
    "inconclusive",
  );
});
test("NRD-08 partial scope and budget do not claim full book", () => {
  const a = p();
  assert.throws(() =>
    runRules(a, { ...run(), source_indices: [1] }, [{ content: text }]),
  );
  assert.throws(() =>
    runRules(a, { ...run(), ruleset: { ...ruleset(), max_chars: 1 } }, [
      { content: text },
    ]),
  );
});
test("NRD-09 same-order changes are inconclusive", () => {
  const a = p();
  a.depth.state_events[1].order = 1;
  const r = runRules(a, run(["initial", "spend"]), [{ content: text }]);
  assert.equal(
    r.results
      .filter((x) => x.rule.startsWith("state:"))
      .every((x) => x.status === "inconclusive"),
    true,
  );
});
test("NRD-10 recheck does not resolve manuscript issues automatically", () => {
  const a = p();
  a.depth.runs = [run()];
  const out = readDepth(
    a,
    "preview_recheck",
    { old_run_id: "run", run: { ...run(), id: "new" } },
    [{ content: text }],
  );
  assert.equal(out.issues_unchanged, true);
  assert.equal(out.findings[0].status, "persists");
});
test("NRD-11 invalid state action and unsupported schema are rejected", () => {
  const a = p();
  a.depth.state_events[0].action = "learn";
  assert.throws(() => validate(a));
  const old = newProject();
  validate(old);
  assert.equal("depth" in old, false);
});
test("NRD-12 complete new actions preserve fixed records", async () => {
  const c = memoryCore(),
    ref = {
      kind: "document",
      work_ref: c.work,
      document_id: "document_d",
      revision_id: "revision_d",
      sha256: createHash("sha256").update(text).digest("hex"),
    };
  c.sources.set(canonical(ref), { source_ref: ref, content: text });
  await runDepthScenario(
    {
      invoke: async (a: string, i: any) => {
        const r = await c.invoke(a, i);
        assert.equal(r.status, "succeeded", JSON.stringify(r));
        return r.data;
      },
    },
    [ref],
    ev,
  );
});

test("器物借还和销毁后再流转分别检查",()=>{
 const a=p(),event=(id:string,order:number,action:string,from:string|null,to:string|null)=>({...state(id,"item",action,ev),entity_ref:"letter",key:"holder",number:null,unit:null,order,from,to});
 a.depth.state_events=[event("get",0,"acquire",null,"lin"),event("borrow",1,"transfer","lin","chen"),event("return",2,"transfer","chen","lin"),event("destroy",3,"destroy","lin",null),event("again",4,"transfer",null,"chen")];
 const r=runRules(a,run(a.depth.state_events.map((e:any)=>e.id)),[{content:text}]);assert.equal(r.results.find(x=>x.rule==="state:return").status,"pass");assert.equal(r.results.find(x=>x.rule==="state:again").status,"finding");
});
test("人物死亡复生与遗忘后使用均需具体依据",()=>{
 const a=p();a.depth.state_events=[{...state("dead","condition","set",ev),key:"life",number:null,unit:null,value:"dead",order:0},{...state("alive","condition","set",ev),key:"life",number:null,unit:null,value:"alive",order:1},{...state("forget","knowledge","forget",ev),key:"code",number:null,unit:null,order:2},{...state("use","knowledge","use",ev),key:"code",number:null,unit:null,order:3}];
 const r=runRules(a,run(a.depth.state_events.map((e:any)=>e.id)),[{content:text}]);assert.equal(r.results.find(x=>x.rule==="state:alive").status,"finding");assert.equal(r.results.find(x=>x.rule==="state:use").status,"finding");
});
