import { replaceOutsideQuotes, tidy } from "./consume";

/** "french not required": a condition on the role, so the whole comma segment is the fragment. */
const NOT_REQUIRED_RE = /[^,;"]*(?<![\w-])(?:no|not)\s+(?:required|needed|necessary|mandatory)\b/gi;
/** "no crypto", "not sales", "without sql", "excluding agencies" — up to the next comma. */
const NEGATION_RE = /(?<![\w-])(no|not|without|excluding)\s+(?=[a-z])([^,;"]+)/gi;

export interface ParsedExclusions {
  residualQ: string;
  /** Each consumed negation, as typed. */
  mentions: string[];
}

/**
 * Negations ("no X", "not X", "without X", "excluding X"). The search backend
 * has no negation on title or text (buildFilter only filters on facets, and
 * the Meili query is positive-only), so these cannot become filters: they are
 * consumed from the query — "not sales" must not search for sales — and
 * reported, so the page says it couldn't apply them.
 */
export function parseExclusionTokens(q: string): ParsedExclusions {
  const mentions: string[] = [];
  const take = (fragment: string): string => {
    mentions.push(fragment.replace(/\s+/g, " ").trim());
    return " ";
  };
  let residual = replaceOutsideQuotes(q, NOT_REQUIRED_RE, take);
  residual = replaceOutsideQuotes(residual, NEGATION_RE, (_m, negator, what) => take(`${negator.toLowerCase()} ${what}`));
  return { residualQ: tidy(residual), mentions };
}
