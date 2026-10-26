/** A name source for the title alias graph. Add one by exporting a loader from ./index.ts; the generator and the query side need no change. */
export interface RawConcept {
  id: string;
  /** One synonym-level item (a Wikidata occupation, an ESCO occupation): its names, preferred first, as published. The generator normalises them. */
  names: string[];
}

export interface TitleSourceLoader {
  id: string;
  label: string;
  version: string;
  license: string;
  /** Files read from the work dir, fetched into it when absent: a plain GET of `url`, or `fetchBody` for a paged query. */
  files: Array<{ name: string; url: string; fetchBody?: () => Promise<string> }>;
  /** Pure: file contents by `files[].name` in, concepts out. */
  parse(files: Record<string, string>): RawConcept[];
}
