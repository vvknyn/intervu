import type { TitleSourceLoader } from "./types";
import { wikidataLoader } from "./wikidata";

/** Every source the generator reads. */
export const TITLE_SOURCE_LOADERS: TitleSourceLoader[] = [wikidataLoader];
