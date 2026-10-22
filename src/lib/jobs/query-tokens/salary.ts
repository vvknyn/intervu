import { replaceOutsideQuotes, tidy } from "./consume";

/** A salary floor below this is a count or an hourly rate, not an annual pay band. */
const MIN_ANNUAL = 10_000;

const CURRENCY = String.raw`(?:usd|cad|gbp|eur|aud|nzd|chf|inr|us|dollars?)`;
const SALARY_RE = new RegExp(
  String.raw`(?<![\w$£€.,-])(?:(?:over|above|at least|more than|min(?:imum)?(?: of)?|from)\s+)?` +
    String.raw`([$£€]\s?)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?k)?\+?` +
    String.raw`(?:\s*${CURRENCY}\b)?(?:\s+(?:minimum|min|plus|or more)\b)?(?![\w])`,
  "gi",
);

export interface ParsedSalary {
  residualQ: string;
  /** Annual floor in the posting's own currency units (currency words are consumed, not converted). */
  salaryMin?: number;
}

/**
 * "150k", "over 150k CAD", "$180k+", "at least 250k usd", "90k gbp minimum",
 * "150,000". A bare number is a salary only with a k suffix, a currency
 * symbol or comma grouping — "5", "2024" or "1500" are never one. The first
 * accepted amount is the floor; later ones stay in the query.
 */
export function parseSalaryTokens(q: string): ParsedSalary {
  let salaryMin: number | undefined;
  const residual = replaceOutsideQuotes(q, SALARY_RE, (match, symbol, digits, k) => {
    if (salaryMin !== undefined) return match;
    if (!symbol && !k && !digits.includes(",")) return match;
    // "401k" is a retirement plan, not 401,000 a year.
    if (k && !symbol && digits === "401") return match;
    const amount = Math.round(Number(digits.replace(/,/g, "")) * (k ? 1000 : 1));
    if (amount < MIN_ANNUAL) return match;
    salaryMin = amount;
    return " ";
  });
  return { residualQ: tidy(residual), ...(salaryMin !== undefined && { salaryMin }) };
}
