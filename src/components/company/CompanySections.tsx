import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { CompanyCadenceStrip, cadenceStripHasContent } from "@/components/company/CompanyCadenceStrip";
import { CompanyVerdictBand, verdictBandHasContent } from "@/components/company/CompanyVerdictBand";
import { DotSeparated } from "@/components/ui/dot-separated";
import { SectionTitle } from "@/components/ui/heading";
import type { CompanyFaqItem } from "@/lib/companies/company-faq";
import { PAY_SCOPE, type CompanyFacts, type Distribution } from "@/lib/companies/company-facts";
import type { SectionId } from "@/lib/companies/company-sections";
import type { CompanyExhaust } from "@/lib/companies/exhaust";
import { listedOnPostings, listedOnRoles, statedOfTotal } from "@/lib/companies/facts-copy";
import { exhaustHiringRecord, trackingStartedInWindow } from "@/lib/companies/hiring-record";
import { categoryLabel } from "@/lib/companies/machine-token";
import { careerHubPathFor } from "@/lib/companies/hub-link";
import { companyBoardPath } from "@/lib/companies/paths";
import { formatCount } from "@/lib/format";
import { openCountLabel } from "@/lib/companies/presentation";
import type { RelatedCompany } from "@/lib/companies/related-companies";

export interface SectionContext {
  facts: CompanyFacts;
  exhaust: CompanyExhaust | null;
  nowMs: number;
  /** The interactive roles list (a client component, already rendered by the body). */
  roles: ReactNode;
  related: RelatedCompany[];
  faq: CompanyFaqItem[];
  /** The ghost-flagged sentence, null when the page cannot state it. */
  staleShare: string | null;
}

const monthYear = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function Section({ id, title, children }: { id: SectionId; title: string; children: ReactNode }) {
  return (
    <section data-testid={`company-section-${id}`} className="border-t border-border pt-6">
      <SectionTitle className="mb-3">{title}</SectionTitle>
      {children}
    </section>
  );
}

/** One distribution as "United States 900 · Canada 100"; a value links to a career hub only where one exists. */
function BucketList({ d, linkValues = false }: { d: Distribution; linkValues?: boolean }) {
  return (
    <DotSeparated
      items={d.buckets.map((b) => {
        const hub = linkValues ? careerHubPathFor(b.value) : null;
        const label = hub ? (
          <Link key={b.value} href={hub} className="text-brand hover:underline">
            {b.value}
          </Link>
        ) : (
          b.value
        );
        return (
          <span key={b.value}>
            {label} <span className="mono-data">{formatCount(b.count)}</span>
          </span>
        );
      })}
    />
  );
}

function Mix({ label, d, noun }: { label: string; d: Distribution | null; noun: string }) {
  if (!d) return null;
  const stated = statedOfTotal(d, noun);
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      <div className="mt-1 break-words text-sm text-muted-foreground">
        <BucketList d={d} />
      </div>
      {stated && <p className="mt-1 text-xs text-muted-foreground">{`Counts ${stated.replace(/^of /, "of ")}.`}</p>}
    </div>
  );
}

const SECTION_VIEWS: Record<SectionId, (c: SectionContext) => ReactNode> = {
  identity: ({ facts }) => {
    const { identity: i } = facts;
    const p = i.profile;
    return (
      <Section id="identity" title={`About ${i.name}`}>
        {p?.tagline && <p className="text-sm text-foreground">{p.tagline}</p>}
        <div className="mt-2 break-words text-sm text-muted-foreground">
          <DotSeparated
            items={[
              <a key="d" href={`https://${i.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">
                {i.domain}
              </a>,
              i.careersUrl && (
                <a key="c" href={i.careersUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">
                  Careers page
                </a>
              ),
              i.atsProvider && `Applications via ${i.atsProvider}`,
              i.sector,
              p?.hqCountry && `HQ ${p.hqCountry}`,
              p?.yearFounded != null && `Founded ${p.yearFounded}`,
              p?.employees && `≈${p.employees} people${p.employeesAsOf ? ` (${p.employeesAsOf})` : ""}`,
              p && p.industries.map(categoryLabel).filter((x) => x !== i.sector).join(", "),
            ]}
          />
        </div>
        {i.profileSources.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {i.profileSources.length > 1 ? "Sources: " : "Source: "}
            {i.profileSources.map((s, n) => (
              <Fragment key={s.name}>
                {n > 0 && ", "}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
                {s.fetchedAt && ` · ${monthYear(s.fetchedAt)}`}
              </Fragment>
            ))}
          </p>
        )}
      </Section>
    );
  },
  hiringNow: ({ facts, exhaust, nowMs }) => {
    const h = facts.hiring;
    const lines = [
      exhaustHiringRecord(exhaust, nowMs),
      h.lastPostedAt && `Newest role posted ${h.lastPostedAt.slice(0, 10)}`,
      h.monitoredSince && !trackingStartedInWindow(h.monitoredSince, nowMs) && `Watched since ${monthYear(h.monitoredSince)}`,
    ].filter(Boolean);
    return (
      <Section id="hiringNow" title="Hiring now">
        <p className="text-sm text-foreground">{`${formatCount(h.openCount)}${h.openCountIsLowerBound ? "+" : ""} open role${h.openCount === 1 ? "" : "s"}.`}</p>
        {lines.length > 0 && <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">{lines.map((l, k) => <li key={k}>{l as string}</li>)}</ul>}
        {exhaust && cadenceStripHasContent(exhaust.cadence) && <div className="mt-4"><CompanyCadenceStrip cadence={exhaust.cadence} /></div>}
      </Section>
    );
  },
  whereAndHow: ({ facts }) => {
    const { mix, pay } = facts;
    const v = mix.visaSponsorship;
    return (
      <Section id="whereAndHow" title="Where and how it hires">
        <div className="grid gap-5 sm:grid-cols-2">
          <Mix label="Countries" d={mix.countries} noun="a country" />
          <Mix label="Work mode" d={mix.workType} noun="a work mode" />
          <Mix label="Employment type" d={mix.employmentType} noun="an employment type" />
          <Mix label="Level" d={mix.experienceLevel} noun="a level" />
          {v && (
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Visa sponsorship</h3>
              <p className="mt-1 text-sm text-muted-foreground">{`${formatCount(v.sponsors)} of ${formatCount(v.stated)} listings that state it offer sponsorship.`}</p>
            </div>
          )}
          {pay && (
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Pay</h3>
              <p className="mt-1 text-sm text-muted-foreground">{`${pay.typical ? `Typical ${pay.typical}, ` : ""}${formatCount(pay.roles)} ${PAY_SCOPE}.`}</p>
            </div>
          )}
        </div>
      </Section>
    );
  },
  skills: ({ facts }) => (
    <Section id="skills" title="Skills and tech">
      <div className="grid gap-5 sm:grid-cols-2">
        {facts.mix.skills && (
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Skills asked for</h3>
            <div className="mt-1 break-words text-sm text-muted-foreground">
              <DotSeparated items={facts.mix.skills.buckets.map((b) => <span key={b.value}>{b.value} <span className="text-xs">({listedOnRoles(b.count)})</span></span>)} />
            </div>
          </div>
        )}
        {facts.mix.tech && (
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Tech named</h3>
            <div className="mt-1 break-words text-sm text-muted-foreground">
              <DotSeparated items={facts.mix.tech.buckets.map((b) => <span key={b.value}>{b.value} <span className="text-xs">({listedOnPostings(b.count)})</span></span>)} />
            </div>
          </div>
        )}
      </div>
    </Section>
  ),
  listingHealth: ({ exhaust, nowMs, staleShare }) => (
    <Section id="listingHealth" title="Listing health">
      {staleShare && <p className="text-sm text-muted-foreground">{staleShare}</p>}
      {exhaust && verdictBandHasContent(exhaust.health, nowMs) && <div className={staleShare ? "mt-4" : undefined}><CompanyVerdictBand health={exhaust.health} nowMs={nowMs} /></div>}
    </Section>
  ),
  filings: ({ facts }) => {
    const { sec, h1b, warn } = facts.filings;
    const rows = [
      sec && `SEC: ${formatCount(sec.count)} filings in two years${sec.latestAt ? `, newest ${sec.latestAt.slice(0, 10)}` : ""}`,
      h1b && `H-1B: ${formatCount(h1b.count)} approvals in fiscal year ${h1b.fiscalYear}`,
      warn && `WARN layoff notices: ${formatCount(warn.count)}${warn.latestAt ? `, newest ${warn.latestAt.slice(0, 10)}` : ""}`,
    ].filter(Boolean);
    return (
      <Section id="filings" title="Public filings">
        <ul className="space-y-0.5 text-sm text-muted-foreground">{rows.map((r, k) => <li key={k}>{r as string}</li>)}</ul>
      </Section>
    );
  },
  openRoles: ({ roles }) => <div data-testid="company-section-openRoles" className="border-t border-border pt-6">{roles}</div>,
  related: ({ related }) => (
    <Section id="related" title="Related companies">
      <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {related.map((c) => (
          <li key={c.domain} className="min-w-0 truncate">
            <a href={companyBoardPath(c.domain)} className="text-brand hover:underline">{c.name}</a>
            {c.openCount && <span className="text-muted-foreground">{` · ${openCountLabel(c.openCount)} open`}</span>}
          </li>
        ))}
      </ul>
    </Section>
  ),
  faq: ({ faq }) => (
    <Section id="faq" title="Questions">
      <dl className="space-y-4">
        {faq.map((q) => (
          <div key={q.question}>
            <dt className="text-sm font-semibold text-foreground">{q.question}</dt>
            <dd className="mt-1 text-sm text-muted-foreground">{q.answer}</dd>
          </div>
        ))}
      </dl>
    </Section>
  ),
};

export function CompanySections({ ids, ctx }: { ids: readonly SectionId[]; ctx: SectionContext }) {
  return <>{ids.map((id) => <div key={id}>{SECTION_VIEWS[id](ctx)}</div>)}</>;
}

