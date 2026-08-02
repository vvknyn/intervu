"use client";

import Link from "next/link";
import { ChatCircleText, FileText, Globe, Kanban, LockKey, ShieldCheck, type Icon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { CORPUS_SOURCE_DESCRIPTOR } from "@/lib/marketing-stats";
import { ProofBand } from "./ProofBand";

interface FeatureCopy {
  icon: Icon;
  title: string;
  body: string;
}

/** Plain, specific, no-hype — legal constraint: automated risk SIGNALS, never
 *  an assertion that a specific job IS fake (see ghost-job screening copy
 *  elsewhere on the site, e.g. GhostRadarCard). */
const DIFFERENTIATORS: readonly FeatureCopy[] = [
  {
    icon: ShieldCheck,
    title: "Screened before you spend an hour",
    body: "Every posting carries ghost-risk signals, and reposts are flagged as reposts — not presented as a new role.",
  },
  {
    icon: Globe,
    title: "The whole market",
    body: "On-site, hybrid, and remote roles, sourced from companies' own career pages — not a remote-only slice.",
  },
  {
    icon: LockKey,
    title: "Never resold, never curated",
    body: `Direct from ATS and career pages — ${CORPUS_SOURCE_DESCRIPTOR}, with freshness and first-seen dates shown.`,
  },
];

const TOOLS: readonly (FeatureCopy & { href: string })[] = [
  {
    icon: FileText,
    title: "Tailored resumes",
    body: "Generate a resume tuned to the exact role you're applying to.",
    href: "/resume-builder",
  },
  {
    icon: ChatCircleText,
    title: "Job-anchored interview prep",
    body: "Practice questions built from the posting itself, not a generic question bank.",
    href: "/prep",
  },
  {
    icon: Kanban,
    title: "Application tracker",
    body: "Track every application's stage in one place.",
    href: "/yours",
  },
];

function FeatureGrid({ items }: { items: readonly FeatureCopy[] }) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.title}>
          <item.icon className="text-brand" size={22} weight="bold" />
          <h3 className="mt-3 text-base font-semibold text-foreground">{item.title}</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Self-contained marketing sections mounted below the landing search/claim
 * block (see docs handoff — mounted by a parallel agent's page.tsx edit, not
 * this file). Zero props: every live number sources itself via `ProofBand`;
 * every other section is static copy against the same corpus-source
 * vocabulary the Footer already uses (`CORPUS_SOURCE_DESCRIPTOR`).
 */
export function LandingMarketing() {
  return (
    <div data-testid="landing-marketing">
      <ProofBand />

      <section aria-label="Why intervu" className="border-t border-border py-14">
        <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
          <h2 className="max-w-2xl text-2xl font-semibold text-foreground sm:text-3xl">
            The real cost isn&apos;t just fake jobs — it&apos;s the hours wasted applying to them.
          </h2>
          <FeatureGrid items={DIFFERENTIATORS} />
        </div>
      </section>

      <section aria-label="Tools for after you find the role" className="border-t border-border bg-muted/40 py-14">
        <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
          <h2 className="text-lg font-semibold text-foreground">Once you find the role</h2>
          <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-3">
            {TOOLS.map((tool) => (
              <Link key={tool.href} href={tool.href} className="group block">
                <tool.icon className="text-brand" size={22} weight="bold" />
                <h3 className="mt-3 text-base font-semibold text-foreground group-hover:underline">
                  {tool.title}
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{tool.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Get started" className="border-t border-border py-14">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center gap-4 px-4 text-center lg:px-8">
          <p className="max-w-xl text-sm text-muted-foreground">
            Every listing is {CORPUS_SOURCE_DESCRIPTOR} — never resold, never curated.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" variant="brand">
              <Link href="/pricing">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/research/ghost-jobs">Read the research</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
