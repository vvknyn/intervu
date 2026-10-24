import { CAREER_HUBS } from "@/lib/seo/career-hubs";

/** The career hub that is about exactly `value` (its search query or one of its facet values), or null: a value links only where a hub already exists. */
export function careerHubPathFor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const hub = CAREER_HUBS.find(
    (h) => h.jobsQuery?.toLowerCase() === v || Object.values(h.jobsFacets ?? {}).some((f) => f?.toLowerCase() === v),
  );
  return hub?.path ?? null;
}
