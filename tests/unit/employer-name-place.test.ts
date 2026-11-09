/**
 * Release 74's live check, 2026-11-08: "bank of america" was searched as the word "of" in the place "Bank" (a
 * village in the UK), and "product manager bank of america" found nothing. Class: a place word inside an employer's
 * whole name ("bank of AMERICA", "air CANADA", "royal bank of CANADA", "AgriSompo NORTH AMERICA"). Before, only a CITY
 * next to ONE word was checked against employer names, and a function word ("of") ended the check: 1,098 of 31,815
 * role + employer test queries lost employer words to a place. The guard asks the corpus whether a run of words
 * around the place IS an employer's whole name, for any kind of place, and only for runs that hold a word that can
 * carry a name. The gazetteer and the corpus here are fixtures; the employers are fictional or public names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQueryUnderstanding,
  employerNameCandidates,
  type CompanyProbe,
  type LocationVocabulary,
} from "../../src/lib/jobs/query-understanding";
import { isEmployerWord } from "../../src/lib/jobs/company-intent";
import { isWholeEmployerName } from "../../src/lib/jobs/meilisearch";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import type { PlaceFilter } from "../../src/lib/jobs/types";

const DATA: GazetteerData = {
  countries: [
    ["CA", "CAN", "Canada"],
    ["GB", "GBR", "United Kingdom"],
  ],
  admin1: [],
  cities: [
    ["Bank", null, 51.513, -0.089, "GB", null, 1000],
    ["Toronto", null, 43.70011, -79.4163, "CA", null, 2794356],
  ],
};
const GAZETTEER = buildGazetteerIndex(DATA);
const REAL: PlaceFilter[] = [
  { field: "location_city", value: "Bank" },
  { field: "location_city", value: "Toronto" },
  { field: "location_country", value: "Canada" },
];

const corpus: CorpusValueChecker = async (groups) =>
  groups.map((candidates) => {
    const out: PlaceFilter[] = [];
    for (const c of candidates) {
      const hit = REAL.find((v) => v.field === c.field && v.value.toLowerCase() === c.value.toLowerCase());
      if (hit && !out.includes(hit)) out.push(hit);
    }
    return out;
  });

/** The corpus's employers, by whole name. `asked` records every phrase the guard asked about. */
function vocabWith(employers: string[], asked: string[] = []): LocationVocabulary {
  const names = new Set(employers.map((e) => e.toLowerCase()));
  const employerNameProbe: CompanyProbe = async (phrase) => {
    asked.push(phrase.toLowerCase());
    return names.has(phrase.toLowerCase());
  };
  return { gazetteer: GAZETTEER, corpusChecker: corpus, companyProbe: async () => false, employerNameProbe };
}

test("a place word inside an employer's whole name stays part of the name, whatever kind of place it is", async () => {
  const vocab = vocabWith(["Bank of America", "Air Canada", "Royal Bank of Canada"]);
  for (const q of ["bank of america", "product manager bank of america", "air canada", "royal bank of canada product manager"]) {
    const p = await applyQueryUnderstanding({ q }, vocab);
    assert.equal(p.q, q, q);
    assert.equal(p.places, undefined, q);
  }
});

test("the same words with no employer of that name are still a place: the corpus decides, not a list", async () => {
  const p = await applyQueryUnderstanding({ q: "air canada" }, vocabWith([]));
  assert.equal(p.q, "air");
  assert.equal(p.places?.length, 1);
});

test("a place next to role or job-search words asks the corpus nothing and stays a place", async () => {
  for (const q of ["product manager canada", "jobs in toronto", "senior data scientist toronto", "remote jobs canada", "nurse canada"]) {
    const asked: string[] = [];
    const p = await applyQueryUnderstanding({ q }, vocabWith(["Jobs Canada", "Nurse Canada"], asked));
    assert.deepEqual(asked, [], `${q} asked ${asked.join(", ")}`);
    assert.ok(p.places?.length, q);
  }
});

test("the runs asked about hold the place, start and end on a content word, and hold a word that can carry a name", () => {
  const tokens = ["royal", "bank", "of", "canada", "product", "manager"];
  const canada = { startIndex: 3, wordsConsumed: 1 } as Parameters<typeof employerNameCandidates>[0];
  const runs = employerNameCandidates(canada, tokens);
  assert.ok(runs.includes("royal bank of canada"));
  assert.ok(runs.includes("bank of canada"));
  assert.ok(!runs.includes("of canada"), "never starts on a function word");
  assert.ok(!runs.includes("canada product manager"), "role words alone carry no name");
  assert.ok(runs.every((r) => r.split(" ").length <= 5));
  assert.ok(runs.every((r) => r.includes("canada")));
  assert.deepEqual(runs, [...runs].sort((a, b) => b.split(" ").length - a.split(" ").length), "longest first");
});

test("a word that can carry an employer's name is not a role, connector, function or job-search word", () => {
  for (const w of ["bank", "air", "royal", "agrisompo", "integral"]) assert.equal(isEmployerWord(w), true, w);
  for (const w of ["manager", "product", "of", "the", "jobs", "careers", "remote", "senior", "x"]) assert.equal(isEmployerWord(w), false, w);
});

test("the whole text names an employer when a sampled employer's whole name is it, legal suffix aside, however few its roles", () => {
  assert.equal(isWholeEmployerName("bank of america", { companies: ["Bank of America, Inc."] }), true);
  assert.equal(isWholeEmployerName("Bank of America", { companies: ["Merrill Lynch", "bank of america corp"] }), true);
  assert.equal(isWholeEmployerName("bank of america", { companies: ["Bank of America Fork Lifts"] }), false, "part of a longer name");
  assert.equal(isWholeEmployerName("data analyst", { companies: ["Data Analyst"] }), false, "role words carry no name");
  assert.equal(isWholeEmployerName("", { companies: [""] }), false);
});
