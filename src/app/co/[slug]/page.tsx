import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { Button } from "@/components/ui/button";
import { BOARD_META } from "@/lib/boards/types";
import { getCompanyPageData } from "@/lib/companies/get-company";
import type { CompanyPageData } from "@/lib/companies/types";
import {
  decodeText,
  ghostMetaFor,
  locationText,
  prettyEnum,
  salaryText,
} from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

const ROLES_PREVIEW = 10;

function prepHref(data: CompanyPageData): string {
  const p = new URLSearchParams();
  p.set("company", data.name);
  p.set("position", data.jobs[0]?.title?.trim() || data.name);
  p.set("round", "Technical");
  p.set("searched", "true");
  return `/prep?${p.toString()}`;
}

function formatKpi(value: number | null): string {
  return value == null ? "—" : String(value);
}

function roleMeta(job: PublicJob): string {
  const parts = [locationText(job), salaryText(job), prettyEnum(job.experience_level)].filter(Boolean);
  return parts.join(" · ");
}

function roleGhostLine(job: PublicJob): string | null {
  const meta = ghostMetaFor(job.ghost_badge, false);
  if (!meta) return null;
  return `● ${meta.label}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCompanyPageData(slug);
  if (!data) return { title: "Company not found" };
  return { title: data.name, description: data.oneLiner ?? undefined };
}

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getCompanyPageData(slug);
  if (!data) notFound();

  const preview = data.jobs.slice(0, ROLES_PREVIEW);
  const prepUrl = prepHref(data);
  const jobsSearchUrl = `/?q=${encodeURIComponent(data.name)}`;

  return (
    <>
      <div className="border-b border-border bg-muted/30 px-4 py-3 sm:px-6">
        <nav className="mx-auto max-w-3xl font-mono text-xs text-muted-foreground">
          <Link href="/" className="text-brand hover:underline">
            Find jobs
          </Link>
          {" / "}
          {data.name}
        </nav>
      </div>

      <main data-testid="company-page" className="mx-auto max-w-3xl px-4 py-8 pb-28 sm:px-6">
        <header className="mb-7 flex gap-5">
          <CompanyLogo domain={data.domain} name={data.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[32px] font-semibold tracking-tight">{data.name}</h1>
            {data.oneLiner && (
              <p className="mt-1.5 text-[15px] leading-snug text-muted-foreground">{data.oneLiner}</p>
            )}
            {data.boards.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.boards.map((id) => (
                  <span
                    key={id}
                    className="rounded border border-brand/25 bg-brand/10 px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-brand"
                  >
                    {BOARD_META[id].label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="brand"
            size="sm"
            disabled
            data-testid="follow-company"
            className="shrink-0 self-start"
          >
            Follow
          </Button>
        </header>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi value={formatKpi(data.openCount)} label="Open roles" hot={data.openCount > 0} />
          <Kpi value={formatKpi(data.opened90d)} label="Opened 90d" hot={typeof data.opened90d === "number" && data.opened90d > 0} />
          <Kpi value={formatKpi(data.closed90d)} label="Closed 90d" />
          <Kpi
            value={data.ghostFlaggedPct == null ? "—" : `${data.ghostFlaggedPct}%`}
            label="Ghost-flagged"
          />
        </div>

        <section>
          <h2 className="mb-3.5 flex items-baseline justify-between font-display text-[19px] font-semibold">
            Open roles
            {data.jobs.length > 0 && (
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {preview.length} of {data.openCount} shown
              </span>
            )}
          </h2>

          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open roles indexed right now.</p>
          ) : (
            <ul className="space-y-2">
              {preview.map((job) => {
                const ghost = roleGhostLine(job);
                return (
                  <li key={job.id}>
                    <Link
                      href={`/?job=${encodeURIComponent(job.id)}`}
                      className="flex items-center justify-between gap-4 rounded-[10px] border border-border bg-card px-5 py-4 transition-colors hover:border-foreground/25"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold">{decodeText(job.title)}</div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">{roleMeta(job)}</div>
                        {ghost && (
                          <div className="mt-1 font-mono text-[11px] text-brand">{ghost}</div>
                        )}
                      </div>
                      <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-6 rounded-lg bg-muted/60 px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          Metrics derived from observed job postings over 90 days — not fundraising data, employee
          reviews, or third-party valuations.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-4 py-3.5 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3">
          <Button variant="outline" asChild>
            <Link href={jobsSearchUrl}>View all {data.openCount} jobs</Link>
          </Button>
          <Button variant="default" asChild>
            <Link href={prepUrl}>Open interview prep</Link>
          </Button>
        </div>
      </div>
    </>
  );
}

function Kpi({ value, label, hot }: { value: string; label: string; hot?: boolean }) {
  return (
    <div className="rounded-[10px] border border-border bg-card px-4 py-4 text-center">
      <div className={cn("font-display text-[26px] font-bold tracking-tight", hot && "text-brand")}>
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
