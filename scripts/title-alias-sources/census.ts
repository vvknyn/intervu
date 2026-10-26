import type { RawConcept, TitleSourceLoader } from "./types";

const BASE = "https://www2.census.gov/programs-surveys/demo/guidance/industry-occupation";
const HEADER = "2022 Occupation Title";

/**
 * US Census 2022 Alphabetical Index of Occupations (US federal work). One concept
 * per detailed SOC 2018 code; the builder keeps it only when that code maps to
 * exactly one O*NET-SOC code. Broad codes ("51-9120", "51-91XX") never resolve.
 */
export const censusLoader: TitleSourceLoader = {
  id: "census",
  label: "US Census 2022 Occupation Index",
  version: "2022 (9/12/2024)",
  license: "US federal government work",
  files: [{ name: "Census-2022-Occupation-Index_Final.xlsx", url: `${BASE}/Census-2022-Occupation-Index_Final.xlsx` }],
  parse(files) {
    const rows = JSON.parse(files["Census-2022-Occupation-Index_Final.xlsx"]) as string[][];
    const start = rows.findIndex((r) => r[0] === HEADER);
    if (start < 0) throw new Error(`census index: header row "${HEADER}" not found`);
    const bySoc = new Map<string, RawConcept>();
    for (const [title, , , soc] of rows.slice(start + 1)) {
      if (!title || !/^\d\d-\d{4}$/.test(soc ?? "")) continue;
      const c = bySoc.get(soc) ?? { id: `census:${soc}`, lang: "en", group: soc.slice(0, 2), matchLevel: "concept" as const, soc2018: soc, names: [] };
      c.names.push(title);
      bySoc.set(soc, c);
    }
    return [...bySoc.values()];
  },
};
