import assert from "node:assert/strict";
import { test } from "node:test";
import graphJson from "../../src/lib/jobs/data/title-aliases.json";
import { TITLE_SOURCE_LOADERS } from "../../scripts/title-alias-sources";
import { onetLoader } from "../../scripts/title-alias-sources/onet";
import { parseCsvRecords } from "../../scripts/title-alias-sources/csv";
import { buildGraph, dropAmbiguousNames, mergeAcrossSources, resolveSocCodes } from "../../scripts/build-title-aliases";
import { censusLoader } from "../../scripts/title-alias-sources/census";
import { readXlsxRows } from "../../scripts/title-alias-sources/xlsx";
import {
  expandTitleQuery,
  normalizeTitleName,
  normalizeTitleNames,
  type TitleAliasGraph,
  type TitleConcept,
} from "../../src/lib/jobs/title-aliases";

const graph = graphJson as TitleAliasGraph;

/** A zip with stored (uncompressed) entries: enough to exercise the xlsx reader without a binary fixture. */
function storedZip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(text);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, data);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBuf, end]);
}

/** [typed title, another name of the same occupation], one or more per SOC major group. Checked in BOTH directions. */
const PAIRS: Array<[string, string]> = [
  ["ceo", "chief executive officer"], // 11 management
  ["operations gm", "operations general manager"],
  ["claims adjuster", "claims examiner"], // 13 business and finance
  ["information security officer", "isso"], // 15 computer
  ["software engineer", "application developer"],
  ["surveyor", "county surveyor"], // 17 engineering
  ["food scientist", "food technologist"], // 19 science
  ["family therapist", "lmft"], // 21 community and social service
  ["career counselor", "academic advisor"],
  ["mathematics professor", "mathematics lecturer"], // 25 education
  ["art director", "art supervisor"], // 27 arts and media
  ["fiber artist", "textile artist"],
  ["fine artist", "sculptor"],
  ["speech therapist", "slp"], // 29 healthcare
  ["speech therapist", "speech language pathologist"],
  ["slp", "speech and language therapist"],
  ["registered nurses", "staff nurse"], // O*NET titles are plural; a typed singular is covered below
  ["oral surgeon", "maxillofacial surgeon"],
  ["chiropractic doctor", "dc"],
  ["certified nursing assistant", "nursing assistant"], // 31 healthcare support
  ["personal care aide", "personal care attendant"],
  ["certified home health aide", "chha"],
  ["fire captain", "fire battalion chief"], // 33 public safety
  ["patrol sergeant", "police sergeant"],
  ["chef", "executive chef"], // 35 food service
  ["fast food cook", "fast food fry cook"],
  ["custodian", "custodial worker"], // 37 cleaning and grounds
  ["janitor", "building custodian"],
  ["salon manager", "hair salon manager"], // 39 personal care
  ["cashiers", "toll collector"], // 41 sales
  ["billing clerk", "billing coordinator"], // 43 office
  ["telephone operators", "directory assistance operator"],
  ["animal breeders", "dog breeder"], // 45 farming
  ["bricklayer", "block layer"], // 47 construction
  ["electricians", "industrial electrician"],
  ["boilermaker", "boiler mechanic"],
  ["copier technician", "copier tech"], // 49 maintenance and repair
  ["tower technician", "two way radio technician"],
  ["coil winder", "coil finisher"], // 51 production
  ["loadmaster", "ramp supervisor"], // 53 transportation
  ["slot supervisor", "pit boss"],
];

test(">=60 directional alias pairs across >=15 major groups all expand", () => {
  const groupOf = (name: string) => graph.concepts.find((c) => c.names.includes(name))?.group;
  const groups = new Set<string | undefined>();
  let directional = 0;
  for (const [a, b] of PAIRS) {
    for (const [from, to] of [[a, b], [b, a]]) {
      assert.ok(expandTitleQuery(from).includes(normalizeTitleName(to)), `${from} -> ${to}`);
      directional++;
    }
    groups.add(groupOf(normalizeTitleName(a)));
  }
  assert.ok(directional >= 60, `${directional} directional pairs`);
  assert.ok(groups.size >= 15, `${groups.size} groups`);
});

test("the typed query leads, matching is case/punctuation/plural tolerant", () => {
  assert.equal(expandTitleQuery("Speech-Language Pathologist")[0], "speech language pathologist");
  assert.ok(expandTitleQuery("Registered Nurses").includes("staff nurse"));
  assert.ok(expandTitleQuery("  SLP ").includes("speech pathologist"));
});

test("ambiguous single words do not expand", () => {
  for (const w of ["therapist", "consultant", "manager", "associate"]) {
    assert.deepEqual(expandTitleQuery(w), [w]);
  }
});

test("ambiguity guard is class-wide: no name spanning major groups ever expands", () => {
  const groupsByName = new Map<string, Set<string>>();
  for (const c of graph.concepts) for (const n of c.names) groupsByName.set(n, (groupsByName.get(n) ?? new Set()).add(c.group));
  const ambiguous = [...groupsByName].filter(([, g]) => g.size > 1).map(([n]) => n);
  for (const n of ambiguous) assert.deepEqual(expandTitleQuery(n), [n], n);
  const bySoc = new Map<string, Set<string>>();
  for (const c of graph.concepts) for (const n of c.names) bySoc.set(n, (bySoc.get(n) ?? new Set()).add(c.soc2018 ?? c.id));
  assert.deepEqual([...bySoc].filter(([, h]) => h.size > 1).map(([n]) => n), [], "the generator keeps only names owned by one detailed occupation");
  const synthetic: TitleAliasGraph = {
    sources: [],
    concepts: [
      { id: "a", source: "x", lang: "en", group: "29", matchLevel: "concept", names: ["lead", "nurse lead"] },
      { id: "b", source: "x", lang: "en", group: "11", matchLevel: "concept", names: ["lead", "team lead"] },
    ],
  };
  assert.deepEqual(expandTitleQuery("lead", synthetic), ["lead"]);
});

test("an unknown title returns just itself; empty returns nothing", () => {
  assert.deepEqual(expandTitleQuery("Zyxwv Quux"), ["zyxwv quux"]);
  assert.deepEqual(expandTitleQuery("   "), []);
});

test("only the WHOLE query is matched, never a part of it", () => {
  assert.deepEqual(expandTitleQuery("senior speech therapist"), ["senior speech therapist"]);
});

test("a group-level concept is never a synonym: speech therapist does not expand to audiologist", () => {
  const coarse: TitleAliasGraph = {
    sources: [],
    concepts: [
      { id: "isco:2266", source: "isco", lang: "en", group: "29", matchLevel: "group", names: ["audiologist", "speech therapist"] },
      { id: "onet:29-1127.00", source: "onet", lang: "en", group: "29", matchLevel: "concept", names: ["speech pathologist", "speech therapist"] },
      { id: "onet:29-1181.00", source: "onet", lang: "en", group: "29", matchLevel: "concept", names: ["audiologist", "hearing specialist"] },
    ],
  };
  assert.ok(!expandTitleQuery("speech therapist", coarse).includes("audiologist"));
  assert.ok(expandTitleQuery("speech therapist", coarse).includes("speech pathologist"));
  assert.ok(!expandTitleQuery("speech therapist").includes("audiologist"));
});

test("normaliser parity: every committed name is a fixed point of the shared normaliser", () => {
  for (const c of graph.concepts) {
    for (const n of c.names) assert.deepEqual(normalizeTitleNames(n), [n], n);
  }
  assert.deepEqual(normalizeTitleNames("Bilingual Speech-Language Pathologist (Bilingual SLP)"), [
    "bilingual speech language pathologist",
    "bilingual slp",
  ]);
  assert.equal(normalizeTitleName("Café  Manager & Owner"), "cafe manager and owner");
});

test("artifact records source URL, version and sha256 for every file", () => {
  assert.deepEqual(graph.sources.map((s) => s.id), TITLE_SOURCE_LOADERS.map((l) => l.id));
  for (const s of graph.sources) {
    assert.ok(s.version && s.license);
    for (const f of s.files) {
      assert.match(f.url, /^https:\/\//);
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test("O*NET loader: title first, reported titles shown in My Next Move before the rest", () => {
  const concepts = onetLoader.parse({
    "occupation_data.csv": 'O*NET-SOC Code,Title,Description\n29-1127.00,Speech-Language Pathologists,"Assess, and treat"\n',
    "sample_of_reported_titles.csv":
      "O*NET-SOC Code,Title,Reported Job Title,Shown in My Next Move\n29-1127.00,X,Speech Clinician,N\n29-1127.00,X,Speech Pathologist,Y\n",
    "job_titles.csv": "O*NET-SOC Code,Title,Job Title,Short Title,Source(s)\n29-1127.00,X,Voice Therapist,,08\n",
  });
  assert.deepEqual(concepts, [
    { id: "onet:29-1127.00", lang: "en", group: "29", matchLevel: "concept", onetSoc: "29-1127.00", soc2018: "29-1127", names: ["Speech-Language Pathologists", "Speech Pathologist", "Speech Clinician", "Voice Therapist"] },
  ]);
  assert.throws(() =>
    onetLoader.parse({
      "occupation_data.csv": "O*NET-SOC Code,Title,Description\n",
      "sample_of_reported_titles.csv": "O*NET-SOC Code,Title,Reported Job Title,Shown in My Next Move\n99-0000.00,X,Y,Y\n",
      "job_titles.csv": "",
    }),
  );
});

test("csv reader handles quotes, doubled quotes and CRLF", () => {
  assert.deepEqual(parseCsvRecords('a,b\r\n"x, ""y""",z\r\n'), [{ a: 'x, "y"', b: "z" }]);
});

const concept = (over: Partial<TitleConcept> & Pick<TitleConcept, "id" | "source" | "names">): TitleConcept => ({
  lang: "en",
  group: "29",
  matchLevel: "concept",
  ...over,
});

test("merge: a shared official code joins sources (crosswalk); same-source and group-level never merge", () => {
  const merged = mergeAcrossSources([
    concept({ id: "onet:a", source: "onet", onetSoc: "29-1127.00", names: ["speech pathologist"] }),
    concept({ id: "esco:1", source: "esco", onetSoc: "29-1127.00", escoUri: "uri1", names: ["speech and language therapist"] }),
    concept({ id: "onet:b", source: "onet", onetSoc: "29-9999.00", names: ["unrelated"] }),
    concept({ id: "isco:2266", source: "isco", matchLevel: "group", names: ["speech pathologist", "audiologist"] }),
  ]);
  const joined = merged.find((c) => c.id === "onet:a")!;
  assert.equal(joined.source, "esco+onet");
  assert.equal(joined.joinedBy, "crosswalk");
  assert.deepEqual(joined.names.sort(), ["speech and language therapist", "speech pathologist"]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((c) => c.id === "isco:2266")!.names.length, 2);
});

test("merge: a shared name is never a join, so generic titles cannot chain concepts", () => {
  const merged = mergeAcrossSources([
    concept({ id: "a", source: "onet", onetSoc: "29-1141.00", names: ["nurse", "rn"] }),
    concept({ id: "b", source: "census", onetSoc: "29-9999.00", names: ["rn", "registered nurse"] }),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged.every((c) => c.joinedBy === undefined), true);
});

test("a SOC-coded concept joins O*NET only when its code maps to exactly one O*NET-SOC code; else it is dropped", () => {
  const resolved = resolveSocCodes([
    concept({ id: "onet:29-1141.00", source: "onet", onetSoc: "29-1141.00", soc2018: "29-1141", names: ["registered nurses"] }),
    concept({ id: "onet:11-9199.01", source: "onet", onetSoc: "11-9199.01", soc2018: "11-9199", names: ["a"] }),
    concept({ id: "onet:11-9199.02", source: "onet", onetSoc: "11-9199.02", soc2018: "11-9199", names: ["b"] }),
    concept({ id: "census:29-1141", source: "census", soc2018: "29-1141", names: ["nurse"] }),
    concept({ id: "census:11-9199", source: "census", soc2018: "11-9199", names: ["manager all other"] }),
    concept({ id: "census:13-1030", source: "census", soc2018: "13-1030", names: ["broad"] }),
    concept({ id: "census:group", source: "census", matchLevel: "group", soc2018: "29-1141", names: ["grouped"] }),
  ]);
  assert.deepEqual(resolved.map((c) => [c.id, c.onetSoc]), [
    ["onet:29-1141.00", "29-1141.00"], ["onet:11-9199.01", "11-9199.01"], ["onet:11-9199.02", "11-9199.02"], ["census:29-1141", "29-1141.00"],
  ]);
});

test("dropAmbiguousNames: a name owned by two detailed occupations is dropped from both; O*NET specialties of one SOC keep it", () => {
  const out = dropAmbiguousNames([
    concept({ id: "a", source: "onet", soc2018: "29-1141", names: ["nurse", "staff nurse"] }),
    concept({ id: "a2", source: "onet", soc2018: "29-1141", names: ["staff nurse", "acute care nurse"] }),
    concept({ id: "b", source: "onet", soc2018: "31-1131", names: ["nurse", "nursing assistant"] }),
  ]);
  assert.deepEqual(out.map((c) => c.names), [["staff nurse"], ["staff nurse", "acute care nurse"], ["nursing assistant"]]);
});

test("census loader: one concept per detailed SOC code, broad and X codes skipped; xlsx reader decodes shared strings", () => {
  const rows = [["2022 Census Alphabetical Index of Occupations"], ["2022 Occupation Title", "Industry Code", "Census Code", "SOC"], ["3rd grade reading teacher", "", "2310", "25-2021"], ["Registered nurse", "", "3255", "29-1141"], ["A mill operator", "", "8990", "51-91XX"], ["Broad", "", "1", "13-1030"]];
  const concepts = censusLoader.parse({ "Census-2022-Occupation-Index_Final.xlsx": JSON.stringify(rows) });
  assert.deepEqual(concepts.map((c) => [c.id, c.soc2018, c.names]), [["census:25-2021", "25-2021", ["3rd grade reading teacher"]], ["census:29-1141", "29-1141", ["Registered nurse"]], ["census:13-1030", "13-1030", ["Broad"]]]);
  assert.throws(() => censusLoader.parse({ "Census-2022-Occupation-Index_Final.xlsx": "[]" }));
  assert.deepEqual(readXlsxRows(storedZip({
    "xl/sharedStrings.xml": "<sst><si><t>A &amp; B</t></si><si><t>x</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>7</v></c></row><row r="2"><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>',
  })), [["A & B", "", "7"], ["", "x"]]);
});

test("buildGraph is deterministic and records hashes", () => {
  const loaded = [{ loader: onetLoader, sha256: { "occupation_data.csv": "a".repeat(64), "sample_of_reported_titles.csv": "b".repeat(64), "job_titles.csv": "c".repeat(64) }, contents: {
    "occupation_data.csv": "O*NET-SOC Code,Title,Description\n29-1127.00,Speech-Language Pathologists,x\n",
    "sample_of_reported_titles.csv": "O*NET-SOC Code,Title,Reported Job Title,Shown in My Next Move\n29-1127.00,X,SLP,Y\n",
    "job_titles.csv": "O*NET-SOC Code,Title,Job Title,Short Title,Source(s)\n",
  } }];
  const built = buildGraph(loaded);
  assert.deepEqual(built, buildGraph(loaded));
  assert.deepEqual(built.concepts[0].names, ["speech language pathologists", "slp"]);
  assert.equal(built.sources[0].files[0].sha256, "a".repeat(64));
});

test("wiring: aliases become title-only federated queries between tier 1 and tier 2", async () => {
  const { titleAliasSpecs } = await import("../../src/lib/jobs/meilisearch");
  for (const q of ["speech therapist", "electrician"]) {
    const specs = titleAliasSpecs({ q });
    assert.ok(specs.length >= 1 && specs.length <= 8, `${q}: ${specs.length}`);
    for (const s of specs) {
      assert.deepEqual(s.query.attributesToSearchOn, ["title"]);
      assert.equal(s.query.q === q, false);
      assert.ok(s.query.federationOptions.weight > 1 && s.query.federationOptions.weight < 100);
      assert.equal(s.tier, 2);
    }
  }
  assert.deepEqual(titleAliasSpecs({ q: "manager" }), []);
  assert.deepEqual(titleAliasSpecs({ q: "zyxwv quux" }), []);
  // a filter that admits un-derived rows adds the half-weight inclusive variant per alias
  const plain = titleAliasSpecs({ q: "speech therapist" }).length;
  const withFilter = titleAliasSpecs({ q: "speech therapist", salaryMin: 50 }).length;
  assert.ok(withFilter >= plain);
});
