import type { CompanyFacts } from "./company-facts";
import { roleCountText } from "./facts-copy";
import { eventDate, formatCount } from "@/lib/format";
import { hiringFreshness } from "./freshness";

export interface CompanyFaqItem {
  question: string;
  answer: string;
}

const MAX_FAQ = 5;
const REMOTE_VALUES = new Set(["remote", "fully_remote", "fully remote"]);

/**
 * Up to five Q/A from the facts, in a fixed order; a question whose fact is
 * absent is omitted. The visible FAQ and the FAQPage JSON-LD both render this
 * one array, so they cannot disagree.
 */
export function buildCompanyFaq(facts: CompanyFacts, nowMs: number): CompanyFaqItem[] {
  const { name } = facts.identity;
  const { openCount, openCountIsLowerBound: lower, lastPostedAt, checkedAt } = facts.hiring;
  const { fresh, checkedOn } = hiringFreshness(checkedAt, nowMs);
  const newest = lastPostedAt ? eventDate(lastPostedAt) : null;
  const { countries, workType, visaSponsorship } = facts.mix;
  const items: (CompanyFaqItem | null)[] = [
    {
      question: `Is ${name} hiring?`,
      answer:
        openCount > 0
          ? `${fresh ? "Yes. " : ""}${name} has ${roleCountText(openCount, lower)} listed${!fresh && checkedOn ? `, last checked ${checkedOn}` : ""}${newest ? `, the newest posted ${newest}` : ""}.`
          : `${name} has no open roles listed right now.`,
    },
    openCount > 0
      ? { question: `How many open roles does ${name} have?`, answer: `${name} has ${roleCountText(openCount, lower)}${lower ? " (a floor: the count is capped)" : ""}.` }
      : null,
    countries
      ? {
          question: `Where does ${name} hire?`,
          answer: `${name} lists roles in ${countries.buckets.slice(0, 5).map((b) => `${b.value} (${formatCount(b.count)})`).join(", ")}.`,
        }
      : null,
    workType
      ? (() => {
          const remote = workType.buckets.filter((b) => REMOTE_VALUES.has(b.value.toLowerCase())).reduce((s, b) => s + b.count, 0);
          const stated = workType.stated ?? 0;
          return {
            question: `Does ${name} hire remote?`,
            answer:
              remote > 0
                ? `Yes. ${formatCount(remote)} of ${formatCount(stated)} listings that state a work mode are remote.`
                : `None of the ${formatCount(stated)} listings that state a work mode are remote.`,
          };
        })()
      : null,
    visaSponsorship
      ? {
          question: `Does ${name} sponsor visas?`,
          answer:
            visaSponsorship.sponsors > 0
              ? `${formatCount(visaSponsorship.sponsors)} of ${formatCount(visaSponsorship.stated)} listings that state it offer visa sponsorship.`
              : `None of the ${formatCount(visaSponsorship.stated)} listings that state it offer visa sponsorship.`,
        }
      : null,
  ];
  return items.filter((i): i is CompanyFaqItem => i !== null).slice(0, MAX_FAQ);
}
