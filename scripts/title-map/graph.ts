/**
 * Pure assembly of the job title neighbour map (src/lib/jobs/title-map.ts) from parsed sources.
 * No I/O: build-title-map.ts reads the files and calls `assembleTitleMap`.
 *
 * One rule for every role in every industry: a link is either published by a source
 * (O*NET's expert-reviewed related occupations, the ESCO to O*NET crosswalk) or computed
 * the same way for every pair (shared ESCO skills, shared posting terms, a shared title).
 * Thresholds are set here, before any output was seen, and printed by the build.
 */
import { normalizeTitleNames, type TitleSourceMeta } from "../../src/lib/jobs/title-aliases";
import type { TitleMap, TitleMapLinkKind, TitleMapRole } from "../../src/lib/jobs/title-map";

export interface EscoOccupation {
  uri: string;
  label: string;
  altLabels: string[];
  /** ISCO-08 unit group code, four digits ("1223"). */
  iscoUnit?: string;
  iscoUnitLabel?: string;
  essential: string[];
  optional: string[];
}

export interface OnetOccupation {
  code: string;
  title: string;
  /** Alternate titles and sample of reported titles. */
  titles: string[];
}

export interface OnetRelated {
  code: string;
  related: string;
  tier: string;
  index: number;
}

export interface CrosswalkPair {
  escoUri: string;
  onetCode: string;
}

/** Output of scripts/title-map/learn-from-postings.ts: titles seen in Velai's index and their links. */
export interface PostingLinks {
  generatedAt: string;
  titles: Array<{ key: string; label: string; postings: number; companies: number }>;
  /** [key a, key b, cosine 0-1]. */
  links: Array<[string, string, number]>;
}

export const THRESHOLDS = {
  /** Skill links: keep up to this many per occupation, at or above this IDF-weighted cosine. */
  skillLinksPerRole: 10,
  skillMinCosine: 0.2,
  /** An optional skill counts half an essential one. */
  optionalSkillWeight: 0.5,
  /** O*NET Related Occupations tiers (5 Primary-Short, 5 Primary-Long, 10 Supplemental per occupation). */
  onetTierWeight: { "Primary-Short": 0.9, "Primary-Long": 0.7, Supplemental: 0.5 } as Record<string, number>,
  /** The two classifications describing the same work. */
  crosswalkWeight: 0.95,
  /** One role's display title is a listed name of another role. */
  sharedTitleWeight: 0.8,
  /** Posting links below this cosine are dropped (the learner keeps its own top-k). */
  postingsMinCosine: 0.25,
} as const;

export const ISCO_MAJOR: Record<string, string> = {
  "0": "Armed forces occupations",
  "1": "Managers",
  "2": "Professionals",
  "3": "Technicians and associate professionals",
  "4": "Clerical support workers",
  "5": "Service and sales workers",
  "6": "Skilled agricultural, forestry and fishery workers",
  "7": "Craft and related trades workers",
  "8": "Plant and machine operators, and assemblers",
  "9": "Elementary occupations",
};

export const SOC_MAJOR: Record<string, string> = {
  "11": "Management Occupations",
  "13": "Business and Financial Operations Occupations",
  "15": "Computer and Mathematical Occupations",
  "17": "Architecture and Engineering Occupations",
  "19": "Life, Physical, and Social Science Occupations",
  "21": "Community and Social Service Occupations",
  "23": "Legal Occupations",
  "25": "Educational Instruction and Library Occupations",
  "27": "Arts, Design, Entertainment, Sports, and Media Occupations",
  "29": "Healthcare Practitioners and Technical Occupations",
  "31": "Healthcare Support Occupations",
  "33": "Protective Service Occupations",
  "35": "Food Preparation and Serving Related Occupations",
  "37": "Building and Grounds Cleaning and Maintenance Occupations",
  "39": "Personal Care and Service Occupations",
  "41": "Sales and Related Occupations",
  "43": "Office and Administrative Support Occupations",
  "45": "Farming, Fishing, and Forestry Occupations",
  "47": "Construction and Extraction Occupations",
  "49": "Installation, Maintenance, and Repair Occupations",
  "51": "Production Occupations",
  "53": "Transportation and Material Moving Occupations",
  "55": "Military Specific Occupations",
};

type Link = [string, string, number, TitleMapLinkKind];

/**
 * Occupations that ask for the same skills. Each skill weighs its IDF (ln N/df: a skill every
 * occupation lists says little), an optional skill half an essential one; cosine over those
 * vectors, through an inverted index so only pairs sharing a skill are scored.
 */
export function skillLinks(
  occs: EscoOccupation[],
  opts: { perRole?: number; minCosine?: number; optionalWeight?: number } = {},
): Array<[string, string, number]> {
  const { perRole = THRESHOLDS.skillLinksPerRole, minCosine = THRESHOLDS.skillMinCosine, optionalWeight = THRESHOLDS.optionalSkillWeight } = opts;
  const df = new Map<string, number>();
  const vectors = occs.map((o) => {
    const v = new Map<string, number>();
    for (const s of o.optional) v.set(s, optionalWeight);
    for (const s of o.essential) v.set(s, 1);
    for (const s of v.keys()) df.set(s, (df.get(s) ?? 0) + 1);
    return v;
  });
  const n = occs.length;
  const postings = new Map<string, Array<[number, number]>>();
  const norms = vectors.map((v, i) => {
    let sq = 0;
    for (const [s, w] of v) {
      const weight = w * Math.log(n / df.get(s)!);
      v.set(s, weight);
      sq += weight * weight;
      if (weight > 0) {
        const list = postings.get(s);
        if (list) list.push([i, weight]);
        else postings.set(s, [[i, weight]]);
      }
    }
    return Math.sqrt(sq);
  });
  const out: Array<[string, string, number]> = [];
  vectors.forEach((v, i) => {
    if (norms[i] === 0) return;
    const dots = new Map<number, number>();
    for (const [s, w] of v) {
      for (const [j, wj] of postings.get(s) ?? []) if (j !== i) dots.set(j, (dots.get(j) ?? 0) + w * wj);
    }
    const ranked = [...dots]
      .map(([j, dot]) => [j, dot / (norms[i] * norms[j])] as const)
      .filter(([, c]) => c >= minCosine)
      .sort((a, b) => b[1] - a[1] || occs[a[0]].uri.localeCompare(occs[b[0]].uri))
      .slice(0, perRole);
    for (const [j, c] of ranked) out.push([occs[i].uri, occs[j].uri, c]);
  });
  return out;
}

const escoId = (uri: string) => `esco:${uri.split("/").pop()}`;
const onetId = (code: string) => `onet:${code}`;
const postingsId = (key: string) => `postings:${key}`;

function names(raw: string[]): string[] {
  return [...new Set(raw.flatMap(normalizeTitleNames))];
}

export function assembleTitleMap(input: {
  sources: TitleSourceMeta[];
  esco?: EscoOccupation[];
  onet?: { occupations: OnetOccupation[]; related: OnetRelated[] };
  crosswalk?: CrosswalkPair[];
  postings?: PostingLinks;
}): TitleMap {
  const roles: TitleMapRole[] = [];
  const groups: Record<string, string> = {};
  const links: Link[] = [];
  const esco = input.esco ?? [];

  for (const [code, label] of Object.entries(ISCO_MAJOR)) groups[`isco:${code}`] = label;
  for (const o of esco) {
    if (o.iscoUnit && o.iscoUnitLabel) groups[`isco:${o.iscoUnit}`] = o.iscoUnitLabel;
    roles.push({ id: escoId(o.uri), label: o.label, ...(o.iscoUnit ? { group: `isco:${o.iscoUnit}` } : {}), names: names([o.label, ...o.altLabels]) });
  }
  for (const [a, b, c] of skillLinks(esco)) links.push([escoId(a), escoId(b), c, "s"]);

  // O*NET occupations sit in the ISCO unit group most of their crosswalked ESCO occupations sit in; else in their SOC major group.
  const unitOf = new Map(esco.map((o) => [escoId(o.uri), o.iscoUnit] as const));
  const unitVotes = new Map<string, Map<string, number>>();
  for (const { escoUri, onetCode } of input.crosswalk ?? []) {
    const unit = unitOf.get(escoId(escoUri));
    if (!unit) continue;
    const votes = unitVotes.get(onetCode) ?? new Map<string, number>();
    votes.set(unit, (votes.get(unit) ?? 0) + 1);
    unitVotes.set(onetCode, votes);
    links.push([escoId(escoUri), onetId(onetCode), THRESHOLDS.crosswalkWeight, "x"]);
  }
  for (const o of input.onet?.occupations ?? []) {
    const votes = [...(unitVotes.get(o.code) ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const soc = o.code.slice(0, 2);
    if (!votes.length && SOC_MAJOR[soc]) groups[`soc:${soc}`] = SOC_MAJOR[soc];
    const group = votes.length ? `isco:${votes[0][0]}` : SOC_MAJOR[soc] ? `soc:${soc}` : undefined;
    roles.push({ id: onetId(o.code), label: o.title, ...(group ? { group } : {}), names: names([o.title, ...o.titles]) });
  }
  for (const r of input.onet?.related ?? []) {
    const w = THRESHOLDS.onetTierWeight[r.tier];
    if (w) links.push([onetId(r.code), onetId(r.related), w, "e"]);
  }

  for (const t of input.postings?.titles ?? []) roles.push({ id: postingsId(t.key), label: t.label, names: names([t.label, t.key]) });
  for (const [a, b, c] of input.postings?.links ?? []) if (c >= THRESHOLDS.postingsMinCosine) links.push([postingsId(a), postingsId(b), c, "p"]);

  // Shared titles, across sources only (within one source a shared name is that source's own call):
  // a role's display title that another role lists among its names.
  const sourceOf = (id: string) => id.slice(0, id.indexOf(":"));
  const holders = new Map<string, string[]>();
  for (const r of roles) {
    for (const n of r.names) {
      const list = holders.get(n);
      if (list) list.push(r.id);
      else holders.set(n, [r.id]);
    }
  }
  for (const r of roles) {
    for (const label of names([r.label]).slice(0, 1)) {
      for (const other of holders.get(label) ?? []) {
        if (other !== r.id && sourceOf(other) !== sourceOf(r.id)) links.push([r.id, other, THRESHOLDS.sharedTitleWeight, "n"]);
      }
    }
  }

  roles.sort((a, b) => a.id.localeCompare(b.id));
  const at = new Map(roles.map((r, i) => [r.id, i]));
  const best = new Map<string, [number, number, number, TitleMapLinkKind]>();
  for (const [a, b, w, kind] of links) {
    const ia = at.get(a);
    const ib = at.get(b);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    const key = `${lo} ${hi} ${kind}`;
    const weight = Math.max(1, Math.min(100, Math.round(w * 100)));
    if ((best.get(key)?.[2] ?? 0) < weight) best.set(key, [lo, hi, weight, kind]);
  }
  return {
    sources: input.sources,
    groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))),
    roles,
    links: [...best.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[3].localeCompare(b[3])),
  };
}
