import { censusLoader } from "./census";
import { onetLoader } from "./onet";
import type { TitleSourceLoader } from "./types";

/** Every source the generator reads. */
export const TITLE_SOURCE_LOADERS: TitleSourceLoader[] = [onetLoader, censusLoader];
