/** A name source for the title alias graph. Add one by exporting a loader from ./index.ts; the generator and the query side need no change. */
export interface RawConcept {
  id: string;
  lang: string;
  /** Comparable major-group key (SOC major group for O*NET); see TitleConcept.group. */
  group: string;
  /**
   * "concept" = the names are one fine occupation (an O*NET-SOC code, an ESCO URI): only these expand.
   * "group" = a coarse unit group (ISCO 2266 "Audiologists and speech therapists"): never a synonym.
   */
  matchLevel: "concept" | "group";
  /** Hub and join keys, when the source carries them. */
  isco08?: string;
  soc2018?: string;
  escoUri?: string;
  onetSoc?: string;
  /** As published, preferred name first; the generator normalises them. */
  names: string[];
}

export interface TitleSourceLoader {
  id: string;
  label: string;
  version: string;
  license: string;
  /** Official, no-sign-up downloads, fetched into the work dir when absent. */
  files: Array<{ name: string; url: string; /** A source with no plain-GET download (a paged query) builds its file here. */ fetchBody?: () => Promise<string> }>;
  /** Pure: file contents by `files[].name` in, concepts out. */
  parse(files: Record<string, string>): RawConcept[];
}
