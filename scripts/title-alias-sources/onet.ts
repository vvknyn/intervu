import { parseCsvRecords } from "./csv";
import type { RawConcept, TitleSourceLoader } from "./types";

const BASE = "https://www.onetcenter.org/dl_files/database/db_31_0_csv";

/** O*NET 31.0 (CC BY 4.0): one concept per O*NET-SOC code; names = its title, then reported job titles (shown in My Next Move first), then the Job Titles file (formerly Alternate Titles). */
export const onetLoader: TitleSourceLoader = {
  id: "onet",
  label: "O*NET 31.0 Database",
  version: "31.0",
  license: "CC BY 4.0",
  files: [
    { name: "occupation_data.csv", url: `${BASE}/occupation_data.csv` },
    { name: "sample_of_reported_titles.csv", url: `${BASE}/sample_of_reported_titles.csv` },
    { name: "job_titles.csv", url: `${BASE}/job_titles.csv` },
  ],
  parse(files) {
    const concepts = new Map<string, RawConcept>();
    for (const row of parseCsvRecords(files["occupation_data.csv"])) {
      const code = row["O*NET-SOC Code"];
      concepts.set(code, { id: `onet:${code}`, lang: "en", group: code.slice(0, 2), matchLevel: "concept", onetSoc: code, soc2018: code.slice(0, 7), names: [row["Title"]] });
    }
    const reported = parseCsvRecords(files["sample_of_reported_titles.csv"]);
    for (const shown of ["Y", "N"]) {
      for (const row of reported) {
        if (row["Shown in My Next Move"] !== shown) continue;
        const concept = concepts.get(row["O*NET-SOC Code"]);
        if (!concept) throw new Error(`reported title for unknown O*NET-SOC code ${row["O*NET-SOC Code"]}`);
        concept.names.push(row["Reported Job Title"]);
      }
    }
    for (const row of parseCsvRecords(files["job_titles.csv"])) {
      const concept = concepts.get(row["O*NET-SOC Code"]);
      if (!concept) throw new Error(`job title for unknown O*NET-SOC code ${row["O*NET-SOC Code"]}`);
      concept.names.push(row["Job Title"]);
    }
    return [...concepts.values()];
  },
};
