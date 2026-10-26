import assert from "node:assert/strict";
import { test } from "node:test";
import { placeNamed } from "../../src/lib/jobs/resume-location";
import graphJson from "../../src/lib/jobs/data/title-aliases.json";
import { TITLE_SOURCE_LOADERS } from "../../scripts/title-alias-sources";
import { parseCsvRecords } from "../../scripts/title-alias-sources/csv";
import { wikidataLoader } from "../../scripts/title-alias-sources/wikidata";
import { buildGraph, dropAmbiguousNames } from "../../scripts/build-title-aliases";
import {
  expandTitleQuery,
  normalizeTitleName,
  normalizeTitleNames,
  type TitleAliasGraph,
  type TitleConcept,
} from "../../src/lib/jobs/title-aliases";

const graph = graphJson as TitleAliasGraph;

const concept = (id: string, ...names: string[]): TitleConcept => ({ id, source: "test", names });
const synthetic = (...concepts: TitleConcept[]): TitleAliasGraph => ({ sources: [], concepts });

// ---- logic, on synthetic fixtures ----

test("the typed query leads; matching is case, punctuation and plural tolerant", () => {
  const g = synthetic(concept("a", "speech language pathologists", "speech and language therapist", "slp"));
  assert.deepEqual(expandTitleQuery("Speech-Language Pathologist", g), [
    "speech language pathologist",
    "speech language pathologists",
    "speech and language therapist",
  ]);
  assert.deepEqual(expandTitleQuery("SLP", g)[0], "slp");
  assert.ok(expandTitleQuery("SLP", g).includes("speech and language therapist"));
  assert.deepEqual(expandTitleQuery("  ", g), []);
});

test("only the WHOLE query is matched, never a part of it", () => {
  const g = synthetic(concept("a", "nurse", "nursing sister"));
  assert.deepEqual(expandTitleQuery("nurse", g), ["nurse", "nursing sister"]);
  assert.deepEqual(expandTitleQuery("nurse practitioner", g), ["nurse practitioner"]);
  assert.deepEqual(expandTitleQuery("senior nurse", g), ["senior nurse"]);
  assert.deepEqual(expandTitleQuery("zyxwv quux", g), ["zyxwv quux"]);
});

test("a name owned by two concepts never expands, including through a plural form", () => {
  const shared = synthetic(concept("a", "model", "fashion model"), concept("b", "model", "scale model"));
  assert.deepEqual(expandTitleQuery("model", shared), ["model"]);
  const viaPlural = synthetic(concept("a", "nurse", "nursing sister"), concept("b", "nurses", "nursing staff"));
  assert.deepEqual(expandTitleQuery("nurse", viaPlural), ["nurse"]);
});

test("rule a: a single token of 3 chars or fewer is never emitted, but still works as the typed key", () => {
  const g = synthetic(concept("a", "physical therapist", "pt", "physiotherapist"), concept("b", "chief financial officer", "cfo", "finance chief"));
  assert.deepEqual(expandTitleQuery("physical therapist", g), ["physical therapist", "physiotherapist"]);
  assert.deepEqual(expandTitleQuery("chief financial officer", g), ["chief financial officer", "finance chief"]);
  assert.deepEqual(expandTitleQuery("pt", g), ["pt", "physical therapist", "physiotherapist"]);
  assert.ok(expandTitleQuery("cfo", g).includes("chief financial officer"));
});

test("rule b: an alias the place recognizer names is never emitted, in either direction", () => {
  const g = synthetic(concept("a", "paralegal", "portugal", "legal aide"), concept("b", "bartender", "ontario", "barkeeper"));
  assert.deepEqual(expandTitleQuery("paralegal", g), ["paralegal", "legal aide"]);
  assert.deepEqual(expandTitleQuery("bartender", g), ["bartender", "barkeeper"]);
  assert.ok(!expandTitleQuery("legal aide", g).includes("portugal"));
});

test("rule c: a same-head sibling is not a synonym unless it carries every typed word; symmetric", () => {
  const g = synthetic(
    concept("a", "product manager", "technical program manager", "senior product managers", "product owner"),
    concept("b", "data analyst", "business analyst", "data analysts"),
  );
  assert.deepEqual(expandTitleQuery("product manager", g), ["product manager", "senior product managers", "product owner"]);
  assert.deepEqual(expandTitleQuery("technical program manager", g), ["technical program manager", "product owner"]);
  assert.deepEqual(expandTitleQuery("data analyst", g), ["data analyst", "data analysts"]);
  assert.deepEqual(expandTitleQuery("business analyst", g), ["business analyst"]);
});

test("dropAmbiguousNames: a name held by two concepts is dropped from both; a concept left empty goes", () => {
  const out = dropAmbiguousNames([concept("a", "model", "fashion model"), concept("b", "model"), concept("c", "welder")]);
  assert.deepEqual(out.map((c) => [c.id, c.names]), [["a", ["fashion model"]], ["c", ["welder"]]]);
});

test("csv reader handles quotes, doubled quotes and CRLF", () => {
  assert.deepEqual(parseCsvRecords('a,b\r\n"x, ""y""",z\r\n'), [{ a: 'x, "y"', b: "z" }]);
});

test("wikidata loader: label first, then aliases; property ids are not occupations", () => {
  const rows = [
    { item: "Q1", label: "Speech-Language Pathologist", aliases: "Speech Therapist|SLP" },
    { item: "Q2", label: "Welder", aliases: "" },
    { item: "P2679", label: "foreword by", aliases: "preface by" },
  ];
  const concepts = wikidataLoader.parse({ "wikidata-occupations.json": JSON.stringify(rows) });
  assert.deepEqual(concepts, [
    { id: "wikidata:Q1", names: ["Speech-Language Pathologist", "Speech Therapist", "SLP"] },
    { id: "wikidata:Q2", names: ["Welder"] },
  ]);
});

test("buildGraph is deterministic, normalises names and records the file hash", () => {
  const rows = [{ item: "Q1", label: "Bilingual Speech-Language Pathologist (Bilingual SLP)", aliases: "Speech Therapist" }];
  const loaded = [{ loader: wikidataLoader, sha256: { "wikidata-occupations.json": "a".repeat(64) }, contents: { "wikidata-occupations.json": JSON.stringify(rows) } }];
  const built = buildGraph(loaded);
  assert.deepEqual(built, buildGraph(loaded));
  assert.deepEqual(built.concepts[0].names, ["bilingual speech language pathologist", "bilingual slp", "speech therapist"]);
  assert.equal(built.sources[0].files[0].sha256, "a".repeat(64));
});

test("normaliser: lower-case, folds diacritics, & -> and; parenthesised acronym is a second spelling", () => {
  assert.deepEqual(normalizeTitleNames("Bilingual Speech-Language Pathologist (Bilingual SLP)"), [
    "bilingual speech language pathologist",
    "bilingual slp",
  ]);
  assert.equal(normalizeTitleName("Café  Manager & Owner"), "cafe manager and owner");
});

// ---- the shipped artifact, real data ----

/** [typed title, another name of the same occupation], one per family. Checked in BOTH directions; read off the built file, never added by hand. */
const PAIRS: Array<[string, string]> = [
  ["physical therapist", "physiotherapist"], // therapy
  ["speech therapist", "speech language pathologist"],
  ["lawyer", "attorney"], // legal
  ["doctor", "doctor of medicine"], // medicine
  ["flight attendant", "cabin crew member"], // aviation
  ["fireman", "fire fighter"], // emergency services
  ["bartender", "barkeeper"], // hospitality
  ["waiter", "waitress"],
  ["tailor", "tailoress"], // textile trades
  ["hairdresser", "hair stylist"], // beauty
  ["sales assistant", "retail clerk"], // retail
  ["recruiter", "headhunter"], // human resources
  ["truck driver", "trucker"], // transport
  ["mechanic", "grease monkey"], // trades
  ["pharmacist", "head dispenser"], // pharmacy
  ["accountant", "accountant technician"], // finance
  ["fishmonger", "fish seller"], // food trades
  ["forklift operator", "forklift driver"], // warehousing
  ["air traffic controller", "atco"],
];

test(">=15 occupation families: each real pair expands in both directions", () => {
  assert.ok(PAIRS.length >= 15);
  for (const [a, b] of PAIRS) {
    assert.ok(expandTitleQuery(a).includes(b), `${a} -> ${b}`);
    assert.ok(expandTitleQuery(b).includes(a), `${b} -> ${a}`);
    assert.equal(expandTitleQuery(a)[0], a);
  }
});

const HIGH_TRAFFIC = ["software developer","software engineer","developer","engineer","nurse","registered nurse","data analyst","data scientist","product manager","project manager","teacher","driver","truck driver","accountant","sales","marketing manager","designer","electrician","pharmacist","physical therapist","speech therapist","cashier","manager","consultant","analyst","lawyer","doctor","chef","cook","plumber","forklift operator","welder","recruiter","barista","mechanic","carpenter","architect","dentist","paralegal","web developer"];

test("built artifact: no emitted alias of 40 high-traffic queries is a short token, a place or a same-head sibling", () => {
  const head = (n: string) => n.split(" ").at(-1)!.replace(/(ies|es|s)$/, "");
  for (const q of HIGH_TRAFFIC) {
    const [typed, ...aliases] = expandTitleQuery(q);
    for (const a of aliases) {
      assert.ok(a.includes(" ") || a.length > 3, `${q} -> ${a}: short token`);
      assert.equal(placeNamed(a), null, `${q} -> ${a}: place`);
      const carriesAll = typed.split(" ").every((w) => a.includes(w.replace(/(ies|es|s)$/, "")));
      assert.ok(head(a) !== head(typed) || carriesAll, `${q} -> ${a}: sibling`);
    }
  }
  assert.ok(!expandTitleQuery("physical therapist").includes("pt"));
  assert.ok(!expandTitleQuery("paralegal").includes("portugal"));
  assert.ok(!expandTitleQuery("product manager").includes("technical program manager"));
});

test("a different occupation is not a synonym: speech therapist does not expand to audiologist", () => {
  assert.ok(!expandTitleQuery("speech therapist").includes("audiologist"));
  assert.ok(!expandTitleQuery("audiologist").includes("speech therapist"));
});

test("whole-query only on the real artifact too: a longer title does not expand", () => {
  assert.deepEqual(expandTitleQuery("senior speech therapist"), ["senior speech therapist"]);
  assert.deepEqual(expandTitleQuery("zyxwv quux"), ["zyxwv quux"]);
});

test("class-wide: no name in the artifact is owned by two concepts", () => {
  const owner = new Map<string, string>();
  for (const c of graph.concepts) {
    for (const n of c.names) {
      assert.ok(!owner.has(n) || owner.get(n) === c.id, `${n} owned by ${owner.get(n)} and ${c.id}`);
      owner.set(n, c.id);
    }
  }
});

test("normaliser parity: every committed name is a fixed point of the shared normaliser", () => {
  for (const c of graph.concepts) {
    for (const n of c.names) assert.deepEqual(normalizeTitleNames(n), [n], n);
  }
});

test("artifact records source URL, version, licence and sha256 for every file", () => {
  assert.deepEqual(graph.sources.map((s) => s.id), TITLE_SOURCE_LOADERS.map((l) => l.id));
  for (const s of graph.sources) {
    assert.ok(s.version && s.license);
    for (const f of s.files) {
      assert.match(f.url, /^https:\/\//);
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

// ---- wiring into the federated multi-search ----

test("wiring: aliases become title-only federated queries, capped at 8", async () => {
  const { titleAliasSpecs } = await import("../../src/lib/jobs/meilisearch");
  for (const [q] of [PAIRS[1], PAIRS[3]]) {
    const specs = titleAliasSpecs({ q });
    assert.ok(specs.length >= 1 && specs.length <= 8, `${q}: ${specs.length}`);
    for (const s of specs) {
      assert.deepEqual(s.query.attributesToSearchOn, ["title"]);
      assert.notEqual(s.query.q, q);
      assert.ok(s.query.federationOptions.weight > 1 && s.query.federationOptions.weight < 100); // under the typed hits, over the whole-document ones
      assert.equal(s.tier, 1); // another name for the job is a title match, above the divider
    }
  }
  // a typed name with more than 8 aliases is cut to 8 (found in the artifact, not chosen by hand)
  const big = graph.concepts.find((c) => c.names.length > 10)!;
  assert.ok(expandTitleQuery(big.names[0]).length > 9);
  assert.equal(titleAliasSpecs({ q: big.names[0] }).length, 8);
  assert.deepEqual(titleAliasSpecs({ q: "zyxwv quux" }), []);
  // a filter that admits un-derived rows adds the half-weight inclusive variant per alias
  const plain = titleAliasSpecs({ q: "speech therapist" }).length;
  const withFilter = titleAliasSpecs({ q: "speech therapist", salaryMin: 50 }).length;
  assert.ok(withFilter >= plain);
});
