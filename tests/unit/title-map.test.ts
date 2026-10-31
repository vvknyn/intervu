import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { combineWeights, neighbourTitles, neighbourTree, ownRoles, roleNeighbours, rolesForTitle } from "../../src/lib/jobs/title-map";
import { assembleTitleMap, skillLinks, type EscoOccupation } from "../../scripts/title-map/graph";
import { parseCrosswalk, parseEscoOccupation, parseOnet, parseTsv, parseXlsxSheet } from "../../scripts/title-map/sources";
import { postingLinks, seedTerms, titleKey, titleKeys } from "../../scripts/title-map/learn-from-postings";

const occ = (id: string, label: string, essential: string[], optional: string[] = [], unit = "2511"): EscoOccupation => ({
  uri: `http://data.europa.eu/esco/occupation/${id}`,
  label,
  altLabels: [],
  iscoUnit: unit,
  iscoUnitLabel: `Unit ${unit}`,
  essential,
  optional,
});

describe("O*NET and crosswalk readers", () => {
  it("reads tab-separated text by its header", () => {
    assert.deepEqual(parseTsv("A\tB\n1\t2\n3\t\n"), [{ A: "1", B: "2" }, { A: "3", B: "" }]);
  });

  it("joins alternate and reported titles to their occupation and keeps related tiers", () => {
    const onet = parseOnet({
      occupations: "O*NET-SOC Code\tTitle\tDescription\n11-2021.00\tMarketing Managers\tPlan\n",
      jobTitles: "O*NET-SOC Code\tJob Title\tShort Title\tSource(s)\n11-2021.00\tBrand Manager\tn/a\t08\n",
      reportedTitles: "O*NET-SOC Code\tReported Job Title\tShown in My Next Move\n11-2021.00\tProduct Manager\tY\n",
      related: "O*NET-SOC Code\tRelated O*NET-SOC Code\tRelatedness Tier\tIndex\n11-2021.00\t11-2022.00\tPrimary-Short\t1\n",
    });
    assert.deepEqual(onet.occupations, [{ code: "11-2021.00", title: "Marketing Managers", titles: ["Brand Manager", "Product Manager"] }]);
    assert.deepEqual(onet.related, [{ code: "11-2021.00", related: "11-2022.00", tier: "Primary-Short", index: 1 }]);
  });

  it("reads an xlsx sheet and finds the crosswalk columns by their header", () => {
    const shared =
      "<sst><si><t>ESCO/ISCO Code</t></si><si><t>O*NET-SOC 2019 Code</t></si><si><t>2512.4</t></si><si><t>Note &amp; more</t></si></sst>";
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row><row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c></row>' +
      '<row r="3"><c r="B3" t="s"><v>2</v></c><c r="C3" t="inlineStr"><is><t>15-1299.09</t></is></c></row>' +
      '<row r="4"><c r="C4" t="inlineStr"><is><t>15-1252.00</t></is></c></row></sheetData></worksheet>';
    const rows = parseXlsxSheet(shared, sheet);
    assert.equal(rows[0][0], "Note & more");
    assert.deepEqual(parseCrosswalk(rows), [
      { esco: "2512.4", onetCode: "15-1299.09" },
      { esco: "2512.4", onetCode: "15-1252.00" },
    ]);
    assert.throws(() => parseCrosswalk([["a", "b"]]));
  });

  it("reads an ESCO API occupation record", () => {
    const o = parseEscoOccupation({
      uri: "http://data.europa.eu/esco/occupation/a79170ad",
      preferredLabel: { en: "ICT product manager" },
      alternativeLabel: { en: ["IT product manager"] },
      code: "1330.3",
      broaderIscoGroup: [{ uri: "http://data.europa.eu/esco/isco/C1330", title: "Information and communications technology service managers" }],
      hasEssentialSkill: [{ uri: "s:plan" }],
      hasOptionalSkill: [{ uri: "s:agile" }],
    });
    assert.deepEqual(o, {
      uri: "http://data.europa.eu/esco/occupation/a79170ad",
      code: "1330.3",
      label: "ICT product manager",
      altLabels: ["IT product manager"],
      iscoUnit: "1330",
      iscoUnitLabel: "Information and communications technology service managers",
      essential: ["s:plan"],
      optional: ["s:agile"],
    });
    assert.equal(parseEscoOccupation({ uri: "x" }), null);
  });
});

describe("skill links", () => {
  const common = "s:communicate";
  const occs = [
    occ("pm", "ICT product manager", ["s:roadmap", "s:requirements", common], ["s:agile"]),
    occ("po", "agile product owner", ["s:roadmap", "s:requirements", "s:backlog", common]),
    occ("chef", "chef", ["s:cook", "s:menu", common], [], "3434"),
  ];

  it("links occupations that ask for the same rare skills and not ones that share only a common one", () => {
    const links = skillLinks(occs, { minCosine: 0.2 });
    const pairs = links.map(([a, b]) => `${a.split("/").pop()}>${b.split("/").pop()}`);
    assert.ok(pairs.includes("pm>po") && pairs.includes("po>pm"), pairs.join(","));
    assert.ok(!pairs.some((p) => p.includes("chef")), pairs.join(","));
  });

  it("weighs a skill every occupation lists at zero", () => {
    const links = skillLinks([occ("a", "a", [common]), occ("b", "b", [common])], { minCosine: 0 });
    assert.deepEqual(links, []);
  });
});

describe("title map", () => {
  const map = assembleTitleMap({
    sources: [],
    esco: [
      occ("pm", "ICT product manager", ["s:roadmap", "s:requirements"]),
      occ("po", "product owner", ["s:roadmap", "s:requirements", "s:backlog"]),
      occ("chef", "chef", ["s:cook"], [], "3434"),
    ],
    onet: {
      occupations: [
        { code: "11-2021.00", title: "Marketing Managers", titles: ["Product Manager"] },
        { code: "11-2022.00", title: "Sales Managers", titles: [] },
        { code: "35-1011.00", title: "Chefs and Head Cooks", titles: [] },
      ],
      related: [{ code: "11-2021.00", related: "11-2022.00", tier: "Primary-Short", index: 1 }],
    },
    crosswalk: [{ esco: "http://data.europa.eu/esco/occupation/chef", onetCode: "35-1011.00" }],
    postings: {
      generatedAt: "2026-10-31",
      titles: [
        { key: "product manager", label: "Product Manager", postings: 40, companies: 20 },
        { key: "product owner", label: "Product Owner", postings: 30, companies: 15 },
        { key: "technical account manager", label: "Technical Account Manager", postings: 25, companies: 12 },
        { key: "customer success manager", label: "Customer Success Manager", postings: 60, companies: 30 },
      ],
      links: [
        ["product manager", "product owner", 0.62],
        ["product manager", "technical account manager", 0.31],
        ["technical account manager", "customer success manager", 0.58],
        ["product manager", "customer success manager", 0.1],
      ],
    },
  });

  it("finds a title's roles in every source that names it", () => {
    assert.deepEqual(rolesForTitle(map, "Product Manager").map((r) => r.id).sort(), ["onet:11-2021.00", "postings:product manager"]);
  });

  it("places an O*NET occupation in the ISCO group of the ESCO occupation it crosswalks to, else its SOC group", () => {
    const group = (id: string) => map.roles.find((r) => r.id === id)?.group;
    assert.equal(group("onet:35-1011.00"), "isco:3434");
    assert.equal(group("onet:11-2021.00"), "soc:11");
    assert.equal(map.groups["soc:11"], "Management Occupations");
  });

  it("links the same title across sources and drops posting links under the bar", () => {
    const pm = roleNeighbours(map, "postings:product manager", 10);
    assert.ok(pm.some((n) => n.role.id === "onet:11-2021.00" && n.kinds.includes("n")));
    assert.ok(!pm.some((n) => n.role.id === "postings:customer success manager"), "0.10 is under the 0.25 bar");
  });

  it("reads a tree from a title: product manager -> product owner, TAM; TAM -> CSM; no role twice", () => {
    const tree = neighbourTree(map, "technical account manager", { depth: 3, breadth: 5, minWeight: 0.2 });
    assert.equal(tree.length, 1);
    const flat: string[] = [];
    const walk = (nodes: typeof tree, depth: number) => nodes.forEach((n) => (flat.push(`${depth}:${n.role.label}`), walk(n.children, depth + 1)));
    walk(tree, 0);
    assert.ok(flat.includes("1:Customer Success Manager") && flat.includes("1:Product Manager"), flat.join(" | "));
    assert.ok(flat.includes("2:Product Owner"), flat.join(" | "));
    assert.equal(new Set(flat.map((f) => f.slice(2))).size, flat.length);
  });

  it("roots a title on the roles it is the title of; a role that only lists it is one step away", () => {
    assert.deepEqual(ownRoles(map, "Product Manager").map((r) => r.id), ["postings:product manager"]);
    assert.deepEqual(ownRoles(map, "Brand Manager").map((r) => r.id), []);
    const tree = neighbourTree(map, "Product Manager", { depth: 2 });
    const marketing = tree[0].children.find((c) => c.role.id === "onet:11-2021.00");
    assert.deepEqual(marketing?.kinds, ["n"]);
    assert.ok(marketing?.children.some((c) => c.role.label === "Sales Managers"));
  });

  it("lists neighbour titles strongest first, without the same job in another classification", () => {
    const titles = neighbourTitles(map, "Product Manager", 5, 0.3);
    assert.deepEqual(titles, ["Product Owner", "Technical Account Manager"]);
    assert.ok(titles.includes("Product Owner") && titles.includes("Technical Account Manager"), titles.join(", "));
    assert.ok(!titles.some((t) => t.toLowerCase() === "product manager"));
  });

  it("combines agreeing sources as a noisy-or", () => {
    assert.equal(combineWeights([0.5, 0.5]), 0.75);
    assert.equal(combineWeights([]), 0);
  });
});

describe("posting titles", () => {
  it("keys a posting title without its rank, team, place or contract words", () => {
    assert.equal(titleKey("Senior Technical Account Manager - EMEA (Remote)"), "technical account manager");
    assert.equal(titleKey("Product Owner II"), "product owner");
    assert.equal(titleKey("UI/UX Designer"), "ui ux designer");
    assert.equal(titleKey("Customer Success Manager, Enterprise"), "customer success manager");
    assert.equal(titleKey("Lead"), "");
  });

  it("seeds title searches with the commonest word pairs and words of the map's names, alternating", () => {
    assert.deepEqual(seedTerms(["Product Manager", "Sales Manager", "Senior Product Owner"], 4), ["product manager", "manager", "product owner", "product"]);
    assert.ok(!seedTerms(["Chefs and Head Cooks"], 10).some((t) => /\band\b/.test(t)));
  });

  it("sums facet counts per title key and labels it with its commonest plain spelling", () => {
    const keys = titleKeys(new Map([["Senior Product Owner", 9], ["Product Owner", 6], ["product owner", 2], ["Lead", 3]]));
    assert.deepEqual([...keys], [["product owner", { postings: 17, label: "Product Owner" }]]);
  });

  it("links titles whose postings use the same distinctive terms", () => {
    const v = (terms: Record<string, number>) => new Map(Object.entries(terms));
    const links = postingLinks(
      new Map([
        ["product manager", v({ roadmap: 0.8, backlog: 0.5, stakeholder: 0.6, communication: 0.9 })],
        ["product owner", v({ roadmap: 0.6, backlog: 0.9, stakeholder: 0.5, communication: 0.9 })],
        ["line cook", v({ kitchen: 0.9, food: 0.8, communication: 0.9 })],
      ]),
      5,
      0.25,
    );
    const pairs = links.map(([a, b]) => `${a}>${b}`);
    assert.ok(pairs.includes("product manager>product owner"), pairs.join(","));
    assert.ok(!pairs.some((p) => p.includes("line cook")), pairs.join(","));
  });
});
