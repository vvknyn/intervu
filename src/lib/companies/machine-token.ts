import { prettyEnum } from "@/lib/jobs/presentation";

/** A machine token: lowercase letters/digits joined by "_" or "-", no spaces ("big_tech", "ai-infra").
 *  Free text ("Node.js", "United States") is not one and must pass through unchanged. */
const MACHINE_TOKEN = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/;

/** THE display rule for a categorical company label (sector, industry, categorical mix): the /jobs
 *  vocabulary, so a raw lowercase source value ("healthcare", "big_tech") reads like "Big Tech" does. */
export const categoryLabel = (value: string): string => prettyEnum(machineTokenLabel(value));

/** Display spelling for words whose title case is wrong ("Ai", "Saas"). A casing lexicon, not a gate: any
 *  other word keeps `prettyEnum`'s capitalisation. */
const WORD_SPELLING: Record<string, string> = { ai: "AI", ml: "ML", saas: "SaaS" };

/** A machine token as /jobs shows it (`prettyEnum`, with "-" a word separator too, and whole words spelled per
 *  `WORD_SPELLING`); anything else unchanged. */
export const machineTokenLabel = (value: string): string =>
  MACHINE_TOKEN.test(value)
    ? prettyEnum(value.replace(/-/g, "_")).replace(/[A-Za-z0-9]+/g, (w) => WORD_SPELLING[w.toLowerCase()] ?? w)
    : value;
