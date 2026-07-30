import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/companies/FollowButton";
import { CompanyInitialTile } from "@/components/jobs/CompanyLogo";
import { Button } from "@/components/ui/button";
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

function roleGhostLine(job: PublicJob): { text: string; live: boolean } | null {
  if (job.ghost_badge === "likely_ghost") {
    const meta = ghostMetaFor(job.ghost_badge, false);
    return meta ? { text: `● ${meta.label}`, live: false } : null;
  }
  if (job.ghost_badge === "clear" || !job.ghost_badge) {
    return { text: "Live · no ghost signals", live: true };
  }
  return null;
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
  const isElite = data.boards.includes("elite");

  return (
    <div className="elite-signal min-h-[calc(100dvh-3.5rem)] bg-[color:var(--elite-page)]">
      <div className="border-b border-[color:var(--elite-border)] bg-[color:var(--elite-surface)] px-4 py-3 sm:px-6">
        <nav className="mx-auto max-w-[900px] font-mono text-xs text-[color:var(--elite-faint)]">
          <Link href="/" className="text-[color:var(--elite-brand)] hover:underline">
            Find jobs
          </Link>
          {" / "}
          {data.name}
        </nav>
      </div>

      <main data-testid="company-page" className="mx-auto max-w-[900px] px-4 py-8 pb-28 sm:px-6">
        <header className="mb-7 flex gap-4">
          <CompanyInitialTile
            name={data.name}
            className="h-16 w-16 rounded-[12px] text-[22px]"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[32px] font-semibold tracking-tight">{data.name}</h1>
            {data.oneLiner && (
              <p className="mt-1.5 text-[15px] leading-snug text-[color:var(--elite-muted)]">
                {data.oneLiner}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {isElite && (
                <span className="rounded border border-[color:var(--elite-tint-border)] bg-[color:var(--elite-tint-bg)] px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--elite-brand)]">
                  Elite
                </span>
              )}
              {data.stage && (
                <span className="rounded border border-[color:var(--elite-border-strong)] bg-[color:var(--elite-rule)] px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--elite-muted)]">
                  {data.stage}
                </span>
              )}
            </div>
          </div>
          <FollowButton
            key={data.domain}
            domain={data.domain}
            slug={data.slug}
            displayName={data.name}
            variant="elite"
            className="shrink-0 self-start"
          />
        </header>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi value={formatKpi(data.openCount)} label="Open roles" hot={data.openCount > 0} />
          <Kpi
            value={formatKpi(data.opened90d)}
            label="Opened 90d"
            hot={typeof data.opened90d === "number" && data.opened90d > 0}
          />
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
              <span className="font-mono text-xs font-normal text-[color:var(--elite-muted)]">
                {preview.length} of {data.openCount} shown
              </span>
            )}
          </h2>

          {preview.length === 0 ? (
            <p className="text-sm text-[color:var(--elite-muted)]">No open roles indexed right now.</p>
          ) : (
            <ul className="space-y-2">
              {preview.map((job) => {
                const ghost = roleGhostLine(job);
                return (
                  <li key={job.id}>
                    <Link
                      href={`/?job=${encodeURIComponent(job.id)}`}
                      className="flex items-center justify-between gap-4 rounded-[10px] border border-[color:var(--elite-border)] bg-[color:var(--elite-card)] px-5 py-4 transition-colors hover:border-[#C9C4B4]"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold">{decodeText(job.title)}</div>
                        <div className="mt-1 font-mono text-xs text-[color:var(--elite-muted)]">
                          {roleMeta(job)}
                        </div>
                        {ghost && (
                          <div
                            className={cn(
                              "mt-1.5 flex items-center gap-1.5 font-mono text-[11px]",
                              ghost.live
                                ? "text-[color:var(--elite-live)]"
                                : "text-[color:var(--elite-muted)]",
                            )}
                          >
                            {ghost.live && <span className="elite-live-dot" aria-hidden />}
                            {ghost.live ? ghost.text : ghost.text}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-sm text-[color:var(--elite-faint)]" aria-hidden>
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-6 rounded-lg bg-[color:var(--elite-rule)] px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-[color:var(--elite-muted)]">
          Metrics derived from observed job postings over 90 days — not fundraising data, employee
          reviews, or third-party valuations.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--elite-border)] bg-[color:var(--elite-surface)] px-4 py-3.5 sm:px-6">
        <div className="mx-auto flex max-w-[900px] flex-wrap justify-center gap-3">
          <Button
            variant="outline"
            asChild
            className="border-[color:var(--elite-ink)] bg-[color:var(--elite-card)]"
          >
            <Link href={jobsSearchUrl}>View all {data.openCount} jobs</Link>
          </Button>
          <Button
            asChild
            className="bg-[color:var(--elite-ink)] text-[color:var(--elite-surface)] hover:bg-[color:var(--elite-ink)]/90"
          >
            <Link href={prepUrl}>Open interview prep</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ value, label, hot }: { value: string; label: string; hot?: boolean }) {
  return (
    <div className="rounded-[10px] border border-[color:var(--elite-border)] bg-[color:var(--elite-card)] px-4 py-4 text-center">
      <div
        className={cn(
          "font-display text-[26px] font-bold tracking-tight",
          hot && "text-[color:var(--elite-brand)]",
        )}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[color:var(--elite-faint)]">
        {label}
      </div>
    </div>
  );
}
