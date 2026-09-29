import type { Metadata } from "next";
import Link from "next/link";
// Server-safe icon entry (`/dist/ssr`) — this page has no "use client"
// directive (it exports `metadata`), and the default `@phosphor-icons/react`
// entry uses React context internally, which throws in a real Server
// Component (verified live against the dev server).
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { WhatsAppThreadHero } from "@/components/marketing/WhatsAppThreadHero";
import { OpenclawWaitlistForm } from "@/components/marketing/OpenclawWaitlistForm";
import { OpenclawStatusBadge } from "@/components/marketing/OpenclawStatusBadge";
import { CopyCommand } from "@/components/marketing/CopyCommand";
import { PlatformInstallPanel } from "@/components/marketing/PlatformInstallPanel";
import {
  OPENCLAW_HEADLINE,
  WHILE_YOU_SLEPT_STEPS,
  WHAT_IT_WONT_DO_ITEMS,
  RUNS_ON_YOUR_MACHINE,
  openclawInstallCommand,
  setupSteps,
} from "@/components/marketing/openclaw-content";
import { AGENT } from "@/lib/agent/config";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageTitle, SectionTitle } from "@/components/ui/heading";

export const metadata: Metadata = {
  title: "OpenClaw — an overnight job-application agent",
  description:
    "A self-hosted agent that finds matching roles overnight, tailors your resume, fills out the form, and hands you a finished draft to review on WhatsApp. You always click submit. The skill isn't installable yet — join the list to be notified.",
};

export default function OpenclawPage() {
  // Step 2's `mcporter auth` command points at the connector's own origin.
  const SETUP_STEPS = setupSteps(AGENT.issuer());
  const installCommand = openclawInstallCommand(AGENT.issuer());
  return (
    <div data-testid="openclaw-page" className="bg-background">
      {/* Hero */}
      <PageContainer measure="reading" className="flex flex-col items-start pb-14 pt-16">
        <OpenclawStatusBadge />
        <PageTitle className="mt-4 max-w-2xl">{OPENCLAW_HEADLINE}</PageTitle>
        <p className="mt-4 max-w-xl text-base text-muted-foreground">
          A skill for OpenClaw, the open-source assistant you run on your own machine. It works while you
          sleep and messages you on WhatsApp when an application is ready. You read it, you send it.
        </p>
        <WhatsAppThreadHero className="mt-10 mx-0" />
        <OpenclawWaitlistForm className="mt-10 w-full max-w-sm" />
      </PageContainer>

      {/* While you slept */}
      <section aria-labelledby="while-you-slept-heading" className="border-t border-border py-16">
        <PageContainer measure="reading">
          <SectionTitle id="while-you-slept-heading">While you slept</SectionTitle>
          <ol className="mt-8 flex flex-col gap-6">
            {WHILE_YOU_SLEPT_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="shrink-0 text-sm font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-foreground">{step.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </PageContainer>
      </section>

      {/* What it won't do */}
      <section aria-labelledby="wont-do-heading" className="border-t border-border py-16">
        <PageContainer measure="reading">
          <SectionTitle id="wont-do-heading">What it won&apos;t do</SectionTitle>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            The difference between this and a spray-and-pray auto-applier is everything it refuses to do on its own.
          </p>
          <ul className="mt-8 flex flex-col gap-5">
            {WHAT_IT_WONT_DO_ITEMS.map((item) => (
              <li key={item.title} className="flex gap-3">
                <X
                  size={16}
                  weight="bold"
                  className="mt-0.5 shrink-0 text-foreground"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </PageContainer>
      </section>

      {/* Runs on your machine */}
      <section aria-labelledby="runs-local-heading" className="border-t border-border py-16">
        <PageContainer measure="reading">
          <SectionTitle id="runs-local-heading">Runs on your machine</SectionTitle>
          <p className="mt-4 max-w-xl text-base text-foreground">{RUNS_ON_YOUR_MACHINE.long}</p>
        </PageContainer>
      </section>

      {/* Setup in 3 steps */}
      <section aria-labelledby="setup-heading" className="border-t border-border py-16">
        <PageContainer measure="reading">
          <SectionTitle id="setup-heading">Setup in 3 steps</SectionTitle>
          <ol className="mt-8 flex flex-col gap-6">
            {SETUP_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="shrink-0 text-sm font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{step.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                  {step.command ? (
                    <div className="mt-3">
                      <CopyCommand command={step.command} label="authenticate" />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </PageContainer>
      </section>

      {/* Closing install/waitlist — platform-scoped truth, not a blanket
          "get notified when it's installable" above the live steps this
          same page just walked through (D1). */}
      <section aria-label="Install OpenClaw" className="border-t border-border py-16">
        <PageContainer measure="reading" className="flex flex-col items-start">
          <SectionTitle>Install OpenClaw</SectionTitle>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Available on macOS today. Windows and Linux aren&apos;t built yet.
          </p>
          <div className="mt-6 w-full text-left">
            <PlatformInstallPanel installCommand={installCommand} />
          </div>
          <p className="mt-8 text-xs text-muted-foreground">
            <Check size={16} weight="bold" className="mr-1 inline text-brand" aria-hidden="true" />
            Already using velai&apos;s search?{" "}
            <Link href="/" className="text-foreground underline underline-offset-2">
              Back to jobs
            </Link>
          </p>
        </PageContainer>
      </section>
    </div>
  );
}
