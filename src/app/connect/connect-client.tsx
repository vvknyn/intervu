"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { ArrowSquareOut, Check, Copy, Sparkle, ShieldCheck, Code, TerminalWindow } from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { joinConnectWaitlist } from "@/actions/connect-waitlist";
import { HowItWorksFilm } from "@/components/marketing/HowItWorksFilm";
import {
  MCP_CONNECTOR_URL,
  OPENCLAW_INSTALL_COMMAND,
  OPENCLAW_INSTALL_HINT,
} from "@/components/marketing/openclaw-content";
import { resolveWaitlistOutcome } from "@/components/marketing/waitlist-outcome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { parseConnectClientParam } from "@/lib/auth/landing-intent";
import { CONNECT_CLIENTS, type ConnectClientId } from "@/lib/connect-clients";
import { detectPlatform, type DetectedPlatform } from "@/lib/detect-platform";
import { handoffClientFromConnectTab, saveHandoffClient } from "@/lib/mcp/job-handoff";
import type { HowItWorksFilmId } from "@/lib/marketing/how-it-works";
import { cn } from "@/lib/utils";

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
      "Paste the MCP Endpoint URL below and confirm",
    ],
    note: "Requires a personal Google account with Keep Activity enabled.",
  },
};

function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Degrades gracefully if clipboard is denied
    }
  };

  return (
    <div className="relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-slate-300 bg-slate-50/80 p-3 shadow-2xs dark:border-slate-700 dark:bg-slate-900/60">
      <div className="min-w-0 flex-1 pl-1">
        {label && (
          <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        )}
        <code className="block truncate font-mono text-[13px] font-semibold text-foreground">
          {value}
        </code>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={handleCopy}
        className={cn(
          "shrink-0 gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
          copied
            ? "bg-emerald-600 text-white dark:bg-emerald-500"
            : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100",
        )}
      >
        {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

const TRY_THESE_PROMPTS = [
  "Find senior product manager roles in Berlin with verified salary > $120k posted this week",
  "Is this job posting real, or are there ghost / relisted signals?",
  "Search for remote Staff Frontend Engineer roles and save the top 3 matches to my tracker",
  "Summarize key requirements and interview insights for Stripe and OpenAI openings",
];

export function ConnectClient() {
  const searchParams = useSearchParams();
  const [selectedClient, setSelectedClient] = useState<ConnectClientId>("claude");
  const [film, setFilm] = useState<HowItWorksFilmId | null>(null);
  const [platform, setPlatform] = useState<DetectedPlatform | null>(null);

  // OpenClaw Waitlist state for non-mac
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: true } | null>(null);
  const outcome = result ? resolveWaitlistOutcome(result) : null;

  const currentMeta = MCP_CLIENTS.find((c) => c.id === selectedClient) || MCP_CLIENTS[0];
  const currentInstruction = CLIENT_INSTRUCTIONS[selectedClient] || CLIENT_INSTRUCTIONS.claude;

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent));
  }, []);

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

  const handleWaitlistSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setResult(await joinConnectWaitlist({ email, client: "openclaw" }));
    });
  };

  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        intervu: {
          url: MCP_CONNECTOR_URL,
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div>
        <div className="mb-2.5 inline-flex items-center gap-2 rounded-full border border-emerald-300/80 bg-emerald-50 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-800 shadow-2xs dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
          <Sparkle size={13} weight="fill" className="text-emerald-500" />
          Model Context Protocol (MCP) & Local Agents
        </div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Connect your AI to live, verified job data
        </h1>
        <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground leading-relaxed">
          Query live ATS postings directly inside your favorite AI client with zero hallucinations.
          Screen for ghost postings, compare true hiring rates, and analyze market trends.
        </p>
      </div>

      {/* 2-Column Responsive Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12 items-start">
        {/* Left Column: Universal MCP Server Connection */}
        <section className="rounded-2xl border border-slate-300/80 bg-card p-5 shadow-xs dark:border-slate-700 sm:p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-border/80 pb-4">
            <div>
              <h2 className="text-sm font-bold text-foreground">1. Universal MCP Server</h2>
              <p className="text-xs text-muted-foreground">Standard SSE / HTTP transport</p>
            </div>
            <button
              type="button"
              onClick={() => setFilm("mcp")}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 underline underline-offset-4"
            >
              How MCP works →
            </button>
          </div>

          <CopyBox value={MCP_CONNECTOR_URL} label="Universal MCP Endpoint URL" />

          {/* AI Client Selector Tabs */}
          <div className="border-t border-border/80 pt-4 space-y-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">2. Select Your AI Assistant</h3>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {MCP_CLIENTS.map((client) => {
                const active = selectedClient === client.id;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => handleSelectClient(client.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-150 shadow-2xs",
                      active
                        ? "border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-600/30 dark:border-emerald-500 dark:bg-emerald-950/70 dark:text-emerald-200"
                        : "border-slate-300 bg-card text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
                    )}
                  >
                    {client.label}
                  </button>
                );
              })}
            </div>

            {/* Instructions Box */}
            <div className="rounded-xl border border-slate-300/90 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/50 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white dark:bg-emerald-500 dark:text-slate-950">
                    ✓
                  </span>
                  <h4 className="text-xs font-bold text-foreground">
                    {currentInstruction.title} Setup
                  </h4>
                </div>
                {currentMeta.openUrl && (
                  <Button
                    asChild
                    size="xs"
                    className="gap-1 rounded-md bg-slate-900 font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 shadow-2xs"
                  >
                    <a href={currentMeta.openUrl} target="_blank" rel="noopener noreferrer">
                      Open {currentMeta.label} <ArrowSquareOut size={12} />
                    </a>
                  </Button>
                )}
              </div>

              <ol className="space-y-1.5 text-xs text-foreground">
                {currentInstruction.steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-white border border-slate-300 font-mono text-[10px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 shadow-2xs">
                      {idx + 1}
                    </span>
                    <span className="leading-snug">{step}</span>
                  </li>
                ))}
              </ol>

              {currentInstruction.note && (
                <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded px-2 py-0.5 inline-block">
                  Note: {currentInstruction.note}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Right Column: OpenClaw Local Agent & Accordions */}
        <div className="space-y-6">
          {/* OpenClaw Card */}
          <section className="rounded-2xl border border-slate-300/80 bg-card p-5 shadow-xs dark:border-slate-700 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-4">
              <div className="flex items-center gap-2">
                <TerminalWindow size={18} weight="duotone" className="text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-bold text-foreground">OpenClaw (Autonomous Mac Agent)</h2>
                <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Self-Hosted
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFilm("claw")}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 underline underline-offset-4"
              >
                Watch demo film →
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Autonomous desktop worker for macOS. Discovers verified postings matching your goals, parses ATS forms, and queues drafts for your 1-click review.
            </p>

            <div>
              {platform === "mac" || platform === null ? (
                <div className="space-y-2">
                  <CopyBox value={OPENCLAW_INSTALL_COMMAND} label="1-Click Mac Terminal Command" />
                  <p className="text-[11px] text-muted-foreground font-mono">{OPENCLAW_INSTALL_HINT}</p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
                  <p className="text-xs text-muted-foreground mb-2.5">
                    OpenClaw is built for macOS. Enter your email to get notified when Windows / Linux launches:
                  </p>
                  {outcome?.kind === "success" ? (
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      ✓ You&apos;re on the list!
                    </p>
                  ) : (
                    <form onSubmit={handleWaitlistSubmit} className="flex gap-2">
                      <Input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        disabled={pending}
                        className="h-8 text-xs rounded-lg"
                      />
                      <Button type="submit" size="xs" disabled={pending} className="rounded-lg">
                        {pending ? "Joining…" : "Notify me"}
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Accordion Panels for Sample Prompts & Security */}
          <Accordion type="single" collapsible className="space-y-3">
            {/* Sample Prompts */}
            <AccordionItem
              value="sample-prompts"
              className="rounded-2xl border border-slate-300/80 bg-card px-4 shadow-2xs dark:border-slate-700"
            >
              <AccordionTrigger className="py-3 text-xs font-bold text-foreground hover:no-underline">
                <div className="flex items-center gap-2">
                  <Sparkle size={14} weight="duotone" className="text-emerald-600 dark:text-emerald-400" />
                  <span>Sample Prompts to Ask Your AI</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-3 pt-1">
                <div className="space-y-1.5">
                  {TRY_THESE_PROMPTS.map((prompt, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-[11px] text-foreground dark:border-slate-800 dark:bg-slate-900/40"
                    >
                      <span className="flex-1 font-medium leading-snug">{prompt}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => navigator.clipboard.writeText(prompt)}
                        className="h-6 shrink-0 gap-1 rounded px-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <Copy size={11} /> Copy
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Privacy & Permissions Guarantees */}
            <AccordionItem
              value="privacy-security"
              className="rounded-2xl border border-slate-300/80 bg-card px-4 shadow-2xs dark:border-slate-700"
            >
              <AccordionTrigger className="py-3 text-xs font-bold text-foreground hover:no-underline">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} weight="duotone" className="text-emerald-600 dark:text-emerald-400" />
                  <span>Permissions & Privacy Guarantees</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-3 pt-1">
                <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span><strong>Read-only search:</strong> Your AI queries public verified job data only.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span><strong>No auto-submit:</strong> Never submits applications automatically without manual approval.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span><strong>Stateless queries:</strong> Zero tracking and never used for model training.</span>
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            {/* Raw JSON Config */}
            <AccordionItem
              value="json-config"
              className="rounded-2xl border border-slate-300/80 bg-card px-4 shadow-2xs dark:border-slate-700"
            >
              <AccordionTrigger className="py-3 text-xs font-bold text-foreground hover:no-underline">
                <div className="flex items-center gap-2">
                  <Code size={14} weight="duotone" className="text-emerald-600 dark:text-emerald-400" />
                  <span>Raw JSON Config</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-3 pt-1">
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-[11px] text-slate-100 dark:border-slate-800 shadow-2xs">
                    <code>{jsonConfig}</code>
                  </pre>
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => navigator.clipboard.writeText(jsonConfig)}
                    className="absolute right-2 top-2 h-6 gap-1 rounded bg-slate-800 px-2 text-[10px] font-semibold text-white hover:bg-slate-700"
                  >
                    <Copy size={11} /> Copy
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
