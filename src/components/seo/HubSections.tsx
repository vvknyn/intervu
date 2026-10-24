import Link from "next/link";
import { companyBoardPath } from "@/lib/companies/paths";
import { jobPath } from "@/lib/jobs/job-slug";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { decodeText, displayCompanyName, locationText, postedAgeShort } from "@/lib/jobs/presentation";
import type { HubFacts } from "@/lib/seo/hub-facts";
import { SectionTitle } from "@/components/ui/heading";

/** The facts a career hub states, server-rendered: live role count, companies, newest roles.
 *  A part whose data was not read is not rendered. */
export function HubSections({ facts, label, now }: { facts: HubFacts; label: string; now: number }) {
  const topic = label.toLowerCase();
  return (
    <>
      {facts.total !== null && (
        <p className="mt-8 text-sm" data-testid="career-hub-total">
          <span className="font-semibold">{facts.total.toLocaleString("en-US")}</span> live matching roles
        </p>
      )}
      {facts.companies.length > 0 && (
        <section aria-labelledby="hub-companies" className="mt-8" data-testid="career-hub-companies">
          <SectionTitle id="hub-companies">Companies hiring for {topic}</SectionTitle>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {facts.companies.map(({ domain, name }) => (
              <li key={domain}>
                <Link href={companyBoardPath(domain)} className="hover:underline">
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {facts.roles.length > 0 && (
        <section aria-labelledby="hub-roles" className="mt-8" data-testid="career-hub-roles">
          <SectionTitle id="hub-roles">Newest {topic} roles</SectionTitle>
          <ul className="mt-2 space-y-1 text-sm [&_span]:text-muted-foreground">
            {facts.roles.map((job) => {
              const age = postedAgeShort(derivePostedTs(job), now);
              const place = locationText(job);
              return (
                <li key={job.id}>
                  <Link href={jobPath(job)} className="hover:underline">
                    {decodeText(job.title)}
                  </Link>{" "}
                  <span>
                    · {displayCompanyName(job.company)}
                    {place ? ` · ${place}` : ""}
                    {age ? ` · ${age}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
