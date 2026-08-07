"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
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
import { parseConnectClientParam } from "@/lib/auth/landing-intent";
import { CONNECT_CLIENTS, type ConnectClientId } from "@/lib/connect-clients";
import { detectPlatform, type DetectedPlatform } from "@/lib/detect-platform";
import { CONNECT_HEALTH_COPY } from "@/lib/mcp/connect-health-copy";
import { handoffClientFromConnectTab, saveHandoffClient } from "@/lib/mcp/job-handoff";
import type { HowItWorksFilmId } from "@/lib/marketing/how-it-works";
import { cn } from "@/lib/utils";

function filmForClient(id: ConnectClientId): HowItWorksFilmId {
  return id === "openclaw" ? "claw" : "mcp";
}

/** Only step 1 differs per client — steps 2 and 3 are shared verbatim. */
const STEP1_INTRO: Record<ConnectClientId, string> = {
  claude: "In Claude, open Settings → Connectors → Add custom connector and paste:",
  chatgpt:
    "In ChatGPT: Settings → Connectors (developer mode) → Add — requires a paid plan.",
  gemini:
    "The Gemini app can't take custom MCP connectors yet. In your Gemini CLI settings.json, add intervu as an mcpServers entry pointing at:",
  cursor: "In Cursor, open Settings → MCP and add a new server pointing at:",
  openclaw:
    "In your terminal, install and run the intervu skill — it runs on your machine:",
};

function CopyUrlBar({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be denied (permissions/insecure context) — the
      // URL is still plain visible text, so this degrades to a no-op
      // rather than breaking the page.
    }
  };

  return (
    <div className={cn("flex items-stretch rounded-none border-2 border-foreground", className)}>
      <code className="flex-1 truncate px-3 py-2.5 font-mono text-sm text-foreground">
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded-none border-l-2 border-foreground px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground transition hover:bg-muted/50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-border text-xs font-bold text-foreground">
        {n}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide text-foreground">{label}</span>
    </div>
  );
}

/**
 * OpenClaw tab body for a visitor `detectPlatform` reads as non-Mac — the
 * local agent has no self-bootstrapping installer there yet (see the spec's
 * persona matrix), so this replaces the curl command with plain-language
 * routing to the zero-install Claude path plus a "notify me" capture,
 * instead of showing a command that cannot run. Reuses the same
 * `joinConnectWaitlist` action + `resolveWaitlistOutcome` decision helper as
 * `OpenclawWaitlistForm` (landing/`/openclaw`) rather than forking a second
 * waitlist flow — only the markup differs, to match /connect's squared,
 * token-based styling instead of that component's dark-landing one.
 */
function OpenclawNonMacBand({ onSwitchToClaude }: { onSwitchToClaude: () => void }) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: true } | null>(null);
  const outcome = result ? resolveWaitlistOutcome(result) : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setResult(await joinConnectWaitlist({ email, client: "openclaw" }));
    });
  };

  return (
    <div className="space-y-4 rounded-none border border-border p-4">
      <p className="text-sm text-foreground">
        The local agent runs on a Mac today. Somewhere else? Claude already works right
        now, no install —{" "}
        <button
          type="button"
          onClick={onSwitchToClaude}
          className="cursor-pointer border-0 bg-transparent p-0 font-medium text-brand underline-offset-4 hover:underline"
        >
          switch to the Claude tab
        </button>
        .
      </p>
      {outcome?.kind === "success" ? (
        <p className="text-sm font-medium text-brand" data-testid="openclaw-band-waitlist-success">
          You&apos;re on the list — we&apos;ll email you the moment it&apos;s ready for Windows.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            disabled={pending}
            aria-label="Email address"
            className="rounded-none sm:min-w-0 sm:flex-1"
          />
          <Button type="submit" disabled={pending} variant="outline" className="shrink-0 rounded-none">
            {pending ? "Sending…" : "Tell me when it's ready for Windows"}
          </Button>
        </form>
      )}
      {outcome?.kind === "error" ? (
        <p className="text-sm text-foreground" data-testid="openclaw-band-waitlist-error">
          {outcome.message}
        </p>
      ) : null}
    </div>
  );
}

const TRY_THESE_PROMPTS = [
  "Find senior product manager roles in Berlin posted this week",
  "Is this posting real, or is it a ghost job?",
  "Save that role and mark it applied",
];

export function ConnectClient() {
  const searchParams = useSearchParams();
  const [activeClient, setActiveClient] = useState<ConnectClientId>(CONNECT_CLIENTS[0].id);
  const [film, setFilm] = useState<HowItWorksFilmId | null>(null);
  const activeClientMeta = CONNECT_CLIENTS.find((c) => c.id === activeClient)!;
  // Client-only OS read for the OpenClaw tab (Mac command vs. non-Mac band).
  // Starts null so server and first client render match (no hydration
  // mismatch) and so a non-Mac visitor never sees a flash of a command that
  // can't run — the one-frame empty state while this resolves is fine.
  const [platform, setPlatform] = useState<DetectedPlatform | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent));
  }, []);

  useEffect(() => {
    const fromQuery = parseConnectClientParam(searchParams.get("client"));
    if (!fromQuery) return;
    setActiveClient(fromQuery);
    const handoff = handoffClientFromConnectTab(fromQuery);
    if (handoff) saveHandoffClient(handoff);
  }, [searchParams]);

  return (
    <div>
      <h1 className="font-display text-display font-extrabold text-foreground">
        Your AI already knows how to job hunt. Give it the real market.
      </h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Sign-in linked this browser. Next: allow your AI in the connector popup.
      </p>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Pair intervu with the AI client you already use through MCP, and let it search and
        track verified job listings for you.{" "}
        <button
          type="button"
          onClick={() => setFilm(filmForClient(activeClient))}
          className="cursor-pointer border-0 bg-transparent p-0 font-medium text-brand underline-offset-4 hover:underline"
          data-testid="connect-how-it-works"
        >
          How it works
        </button>
      </p>

      <p className="mt-6 max-w-xl text-sm text-muted-foreground">
        Already using Claude? Its tab below is the zero-install path — or try OpenClaw for
        an agent that applies while you sleep (Mac, for now).
      </p>

      <div
        data-testid="connect-tabs"
        role="tablist"
        aria-label="AI client"
        className="mt-8 flex gap-2 overflow-x-auto"
      >
        {CONNECT_CLIENTS.map((client) => (
          <button
            key={client.id}
            type="button"
            role="tab"
            aria-selected={activeClient === client.id}
            onClick={() => {
              setActiveClient(client.id);
              const handoff = handoffClientFromConnectTab(client.id);
              if (handoff) saveHandoffClient(handoff);
            }}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-none border px-4 py-2 text-sm font-medium transition ${
              activeClient === client.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground hover:border-foreground"
            }`}
          >
            {client.label}
            {client.badge ? (
              <span className="rounded-none border border-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                {client.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Stuck?{" "}
        <Link href="/connect/help" className="underline underline-offset-4 hover:text-foreground">
          Setup help
        </Link>
      </p>

      <div className="mt-6 space-y-6">
        <div className="rounded-none border border-border p-6">
          <StepLabel n={1} label="Connect" />
          {activeClient === "openclaw" && platform !== "mac" ? null : (
            <p className="mt-3 text-sm text-foreground">{STEP1_INTRO[activeClient]}</p>
          )}
          {activeClientMeta.supportsDirectConnect ? (
            activeClient === "openclaw" ? (
              platform === "mac" ? (
                <div className="mt-3 space-y-4">
                  <CopyUrlBar value={OPENCLAW_INSTALL_COMMAND} />
                  <p className="text-xs text-muted-foreground">{OPENCLAW_INSTALL_HINT}</p>
                  <p className="text-xs text-muted-foreground">
                    This sets up everything it needs on your Mac — nothing else to install
                    first.{" "}
                    <Link
                      href="/connect/help#install-node"
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      What exactly does this install?
                    </Link>
                  </p>
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">MCP endpoint (advanced)</p>
                    <CopyUrlBar value={MCP_CONNECTOR_URL} />
                  </div>
                </div>
              ) : platform === null ? null : (
                <div className="mt-3">
                  <OpenclawNonMacBand onSwitchToClaude={() => setActiveClient("claude")} />
                </div>
              )
            ) : (
              <div className="mt-3">
                <CopyUrlBar value={MCP_CONNECTOR_URL} />
              </div>
            )
          ) : null}
        </div>

        <div className="rounded-none border border-border p-6">
          <StepLabel n={2} label="Approve" />
          <p className="mt-3 text-sm text-foreground">Approve once — you&apos;re paired.</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-start gap-2 text-brand">
              <span aria-hidden="true">✓</span>
              <span>Search verified jobs for you</span>
            </li>
            <li className="flex items-start gap-2 text-brand">
              <span aria-hidden="true">✓</span>
              <span>File jobs you approve to your tracker</span>
            </li>
            <li className="flex items-start gap-2 text-foreground">
              <span aria-hidden="true">✗</span>
              <span>It can never apply anywhere without you</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Every client above can search and track for you out of the box. Actually opening a posting and
            filling it in takes an agent with browser control (like Claude Code) — either way, intervu never
            submits applications for you; you approve the moment it hits submit.
          </p>
        </div>

        <div className="rounded-none border border-border p-6">
          <StepLabel n={3} label="Ask" />
          <p className="mt-3 text-sm italic text-foreground">
            &ldquo;What&apos;s the next job I should apply to?&rdquo;
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Job descriptions are third-party text pulled from the original posting — we label them as data, not
            instructions, in every response your agent gets.
          </p>
        </div>
      </div>

      <section className="mt-10 rounded-none border-2 border-foreground p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-foreground">Try these first</h2>
        <ul className="mt-3 space-y-2">
          {TRY_THESE_PROMPTS.map((prompt) => (
            <li key={prompt} className="text-sm italic text-foreground">
              &ldquo;{prompt}&rdquo;
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 max-w-xl text-xs text-muted-foreground">
        {CONNECT_HEALTH_COPY}
      </p>

      <p className="mt-3 max-w-xl text-xs text-muted-foreground">
        Revocable any time in settings. Your AI&apos;s subscription does the thinking —
        intervu provides the data.
      </p>

      <HowItWorksFilm film={film} onOpenChange={(open) => !open && setFilm(null)} />
    </div>
  );
}
