"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut, Copy } from "@phosphor-icons/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CopyCommand } from "@/components/marketing/CopyCommand";
import { HowItWorksFilm } from "@/components/marketing/HowItWorksFilm";
import { PlatformInstallPanel } from "@/components/marketing/PlatformInstallPanel";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseConnectClientParam } from "@/lib/auth/landing-intent";
import { CONNECT_CLIENTS, type ConnectClientId } from "@/lib/connect-clients";
import { handoffClientFromConnectTab, saveHandoffClient } from "@/lib/mcp/job-handoff";
import type { HowItWorksFilmId } from "@/lib/marketing/how-it-works";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";
import { CONNECT_FAQ_NO_MCP_NEEDED, CONNECT_PRIVACY_LINE } from "@/lib/jobs/resume-privacy-copy";
import { PageEyebrow, PageLead, PageTitle } from "@/components/ui/heading";
import { READING_MEASURE } from "@/components/ui/prose";
import { AGENT_PERMISSIONS, AGENT_PERMISSIONS_LIMITS, CONNECT_SAMPLE_PROMPTS } from "@/lib/agent/permissions-copy";

const MCP_CLIENTS = CONNECT_CLIENTS.filter((c) => c.kind === "mcp");

interface ClientInstruction {
  title: string;
  steps: string[];
  note?: string;
}

const CLIENT_INSTRUCTIONS: Record<string, ClientInstruction> = {
  claude: {
    title: "Claude (Desktop & Web)",
    steps: [
      "Open Claude and navigate to Settings → Connectors",
      "Click 'Add Custom Connector'",
      "Paste the MCP Endpoint URL below and click Save",
    ],
  },
  chatgpt: {
    title: "ChatGPT (Paid & Developer Plans)",
    steps: [
      "Open ChatGPT and go to Settings → Connectors (Developer Mode)",
      "Click 'Add Custom Connector'",
      "Paste the MCP Endpoint URL below and authorize access",
    ],
  },
  cursor: {
    title: "Cursor & Windsurf IDE",
    steps: [
      "Open Cursor Settings (Cmd+,) → Features → MCP",
      "Click '+ Add New MCP Server'",
      "Set Type to 'SSE / HTTP' and paste the MCP Endpoint URL below",
    ],
  },
  gemini: {
    title: "Google Gemini Web",
    steps: [
      "Open Gemini on the web and click Settings & Help → Connected Apps",
      "Click 'Add Custom App'",
      "Paste the MCP Endpoint URL below, choose Next, and sign in to velai when Gemini asks",
    ],
    note: "Needs a personal Google account (not a work or school one) with Keep Activity on. Leave the client ID and secret boxes under Additional settings empty. Sign in to velai in this browser first; if Gemini says \"Account linking is required\", sign in and try again.",
  },
};

const TRY_THESE_PROMPTS = CONNECT_SAMPLE_PROMPTS.map((prompt) => prompt.text);

/**
 * `mcpUrl` and `installCommand` arrive already built from `AGENT.issuer()` —
 * this half never derives them, because the issuer lives in a server-only env
 * var and a client-side re-derivation could only guess at a default. `signedIn`
 * likewise comes from the server session rather than a client auth listener, so
 * the sign-in step is correct on the FIRST paint instead of flickering in.
 */
export function ConnectClient({
  mcpUrl,
  installCommand,
  signedIn,
}: {
  mcpUrl: string;
  installCommand: string;
  signedIn: boolean;
}) {
  const searchParams = useSearchParams();
  const [selectedClient, setSelectedClient] = useState<ConnectClientId>("claude");
  const [film, setFilm] = useState<HowItWorksFilmId | null>(null);

  const currentMeta = MCP_CLIENTS.find((c) => c.id === selectedClient) || MCP_CLIENTS[0];
  const currentInstruction = CLIENT_INSTRUCTIONS[selectedClient] || CLIENT_INSTRUCTIONS.claude;

  const handleSelectClient = (id: ConnectClientId) => {
    setSelectedClient(id);
    const handoff = handoffClientFromConnectTab(id);
    if (handoff) saveHandoffClient(handoff);
  };

  useEffect(() => {
    const fromQuery = parseConnectClientParam(searchParams.get("client"));
    if (fromQuery && fromQuery !== "openclaw") {
      handleSelectClient(fromQuery as ConnectClientId);
    }
  }, [searchParams]);

  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        velai: {
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-8 w-full">
      {/* Header Banner */}
      <div>
        <PageEyebrow>Model context protocol (MCP) and local agents</PageEyebrow>
        <PageTitle>
          Connect your AI to live, verified job data
        </PageTitle>
        <PageLead>
          Query live ATS postings directly inside your favorite AI client with zero hallucinations.
          Screen out stale postings, compare true hiring rates, and analyze market trends.
        </PageLead>
      </div>

      {/* 2-Column Responsive Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
        {/* Left Column: Universal MCP Server Connection */}
        <section className="rounded-panel border border-border bg-surface p-6 sm:p-7 space-y-6 shadow-[var(--shadow-bevel-highlight)]">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Universal MCP Server</h2>
              <p className="text-xs text-muted-foreground">Standard SSE / HTTP transport</p>
            </div>
            <button
              type="button"
              onClick={() => setFilm("mcp")}
              className="text-xs font-semibold text-live hover:underline underline-offset-4"
            >
              How MCP works
            </button>
          </div>

          {/* Sign-in is step 1 of this sequence, not a floating aside — see
              the `!signedIn` step below. Everything after it ends at an
              intervu account: the endpoint answers 401 until a connector
              finishes the OAuth handshake, and the Claude Code lane hands
              you a token only Settings can mint. `next` brings a signed-out
              visitor back HERE, mid-setup, rather than dropping them on
              /jobs. */}
          <ol className="space-y-5">
            {!signedIn && (
              <li data-testid="connect-signin-step" className="flex gap-4">
                <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">1.</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* signup-gate-exempt: agent-connect card, the sign-in is the page's only step */}<h3 className="text-xs font-semibold text-foreground">Sign in to velai</h3>
                    <Button asChild size="sm" className="shrink-0">
                      {/* signup-gate-exempt: agent-connect card, the sign-in is the page's only step */}<a href={`/login?next=${encodeURIComponent("/connect")}`}>{AUTH_CTA_LABEL}</a>
                    </Button>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    Your AI connects as you, so it needs an account to connect to. We&apos;ll bring you
                    right back here.
                  </p>
                </div>
              </li>
            )}

            <li className="flex gap-4">
              <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">{signedIn ? "1." : "2."}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-foreground">Copy the endpoint</h3>
                <div className="mt-2">
                  <CopyCommand command={mcpUrl} label="MCP endpoint" />
                </div>
              </div>
            </li>

            <li className="flex gap-4">
              <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">{signedIn ? "2." : "3."}</span>
              <div className="min-w-0 flex-1 space-y-3">
                <h3 className="text-xs font-semibold text-foreground">Paste it into your AI client</h3>
                <p className="text-xs text-muted-foreground">Pick your client for its exact steps.</p>

                <Tabs
                  value={selectedClient}
                  onValueChange={(value) => handleSelectClient(value as ConnectClientId)}
                >
                  <TabsList variant="line">
                    {MCP_CLIENTS.map((client) => (
                      <TabsTrigger key={client.id} value={client.id}>
                        {client.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                {/* Instructions Box */}
                <div className="rounded-panel border border-border bg-surface-2 p-4 space-y-3 shadow-[var(--shadow-bevel-inset)]">
                  {/* Wraps: on a 320px phone the heading squeezed to four
                      lines beside the Open button. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <h4 className="text-xs font-semibold text-foreground">
                      {currentInstruction.title} Setup
                    </h4>
                    {currentMeta.openUrl && (
                      <Button asChild size="xs" variant="ghost" className="gap-1">
                        <a href={currentMeta.openUrl} target="_blank" rel="noopener noreferrer">
                          Open {currentMeta.label} <ArrowSquareOut size={16} />
                        </a>
                      </Button>
                    )}
                  </div>

                  <ol className="space-y-1.5 text-xs text-foreground">
                    {currentInstruction.steps.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground">
                          {idx + 1}.
                        </span>
                        <span className="leading-snug">{step}</span>
                      </li>
                    ))}
                  </ol>

                  {currentInstruction.note && (
                    <p className="text-xs font-semibold text-warn">
                      Note: {currentInstruction.note}
                    </p>
                  )}
                </div>
              </div>
            </li>
          </ol>
        </section>

        {/* Right Column: OpenClaw Local Agent & Accordions */}
        <div className="space-y-6">
          {/* OpenClaw Card */}
          <section className="rounded-panel border border-border bg-surface p-6 sm:p-7 space-y-5 shadow-[var(--shadow-bevel-highlight)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">OpenClaw (Autonomous Mac Agent)</h2>
                <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">
                  Self-hosted
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFilm("claw")}
                className="text-xs font-semibold text-live hover:underline underline-offset-4"
              >
                Watch the demo
              </button>
            </div>

            <p className={`text-xs text-muted-foreground leading-relaxed ${READING_MEASURE}`}>
              Autonomous desktop worker for macOS. Discovers verified postings matching your goals, parses ATS forms, and queues drafts for your 1-click review.
            </p>

            <PlatformInstallPanel installCommand={installCommand} />
          </section>

          {/* Accordion Panels for Sample Prompts & Security */}
          <Accordion type="single" collapsible>
            {/* Sample Prompts */}
            <AccordionItem value="sample-prompts">
              <AccordionTrigger>Sample prompts</AccordionTrigger>
              <AccordionContent className="pb-3 pt-1">
                <div className="space-y-1.5">
                  {TRY_THESE_PROMPTS.map((prompt, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded-ctl border border-border bg-surface-2 p-2.5 text-xs text-foreground shadow-[var(--shadow-bevel-inset)]"
                    >
                      <span className="flex-1 leading-snug">{prompt}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => navigator.clipboard.writeText(prompt)}
                        className="shrink-0 gap-1 whitespace-nowrap px-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Copy size={16} /> Copy
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* FAQ for Job Seekers */}
            <AccordionItem value="faq-seekers">
              <AccordionTrigger>Frequently asked questions</AccordionTrigger>
              <AccordionContent className="pb-3 pt-1">
                <div className={`space-y-3 text-xs leading-relaxed text-muted-foreground ${READING_MEASURE}`}>
                  <div>
                    <p className="font-semibold text-foreground">Do I need an AI to search jobs on Velai?</p>
                    <p className="mt-0.5">
                      {CONNECT_FAQ_NO_MCP_NEEDED}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">What is an MCP connection?</p>
                    <p className="mt-0.5">
                      Model Context Protocol (MCP) lets your AI assistant (like Claude Desktop, Cursor, or Gemini) query Velai&apos;s verified job database directly from your conversation so you don&apos;t have to switch tabs.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Can an AI apply to jobs for me?</p>
                    <p className="mt-0.5">
                      No. Your AI can search roles, keep your tracker and résumé up to date, and save your preferences, but it never submits an application. You apply yourself.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Privacy & Permissions Guarantees */}
            <AccordionItem value="privacy-security">
              <AccordionTrigger>Permissions and privacy</AccordionTrigger>
              <AccordionContent className="pb-3 pt-1">
                <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex items-start gap-1.5">
                    <span className="text-live font-semibold">✓</span>
                    <span>
                      <span className="font-semibold text-foreground">What it can do, as you:</span>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4" data-testid="connect-permissions">
                        {AGENT_PERMISSIONS.map((permission) => (
                          <li key={permission.text}>{permission.text}</li>
                        ))}
                      </ul>
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-live font-semibold">✓</span>
                    <span><span className="font-semibold text-foreground">No auto-submit:</span> {AGENT_PERMISSIONS_LIMITS}</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-live font-semibold">✓</span>
                    <span><span className="font-semibold text-foreground">Your approval:</span> MCP access only works after you sign in and authorize the connection; revoke it anytime from account settings.</span>
                  </li>
                  <li className="flex items-start gap-1.5" data-testid="connect-privacy">
                    <span className="text-live font-semibold">✓</span>
                    <span>
                      <span className="font-semibold text-foreground">Your data:</span> {CONNECT_PRIVACY_LINE}{" "}
                      <Link href="/privacy#your-resume" className="underline underline-offset-2 hover:text-foreground">
                        How Velai keeps it private
                      </Link>
                    </span>
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            {/* Raw JSON Config */}
            <AccordionItem value="json-config">
              <AccordionTrigger>Raw JSON config</AccordionTrigger>
              <AccordionContent className="pb-3 pt-1">
                <div className="relative">
                  <pre className="overflow-x-auto rounded-ctl bg-surface-2 p-3 text-xs text-foreground shadow-[var(--shadow-bevel-inset)]">
                    <code>{jsonConfig}</code>
                  </pre>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => navigator.clipboard.writeText(jsonConfig)}
                    className="absolute right-2 top-2 gap-1 whitespace-nowrap"
                  >
                    <Copy size={16} /> Copy
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      {/* Demo Video Modal */}
      <HowItWorksFilm film={film} onOpenChange={(open) => !open && setFilm(null)} />
    </div>
  );
}
