"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
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
import { CONNECT_CLIENTS } from "@/lib/connect-clients";
import { detectPlatform, type DetectedPlatform } from "@/lib/detect-platform";
import { CONNECT_HEALTH_COPY } from "@/lib/mcp/connect-health-copy";
import { handoffClientFromConnectTab, saveHandoffClient } from "@/lib/mcp/job-handoff";
import type { HowItWorksFilmId } from "@/lib/marketing/how-it-works";
import { cn } from "@/lib/utils";

/**
 * The picker only ever shows clients that share the one MCP paste-a-URL
 * flow — OpenClaw (`kind: "local"`) gets its own section below instead of a
 * tab, so new members are covered by construction: adding another MCP
 * client to CONNECT_CLIENTS puts it here without touching this file.
 */
const MCP_CLIENTS = CONNECT_CLIENTS.filter(
  (c): c is Extract<(typeof CONNECT_CLIENTS)[number], { kind: "mcp" }> => c.kind === "mcp",
);
type McpClientId = (typeof MCP_CLIENTS)[number]["id"];

/** Only step 1 differs per client — steps 2 and 3 are shared verbatim. */
const STEP1_INTRO: Record<McpClientId, string> = {
  claude: "In Claude: Settings → Connectors → Add custom connector, then paste:",
  chatgpt: "In ChatGPT: Settings → Connectors (developer mode; paid plans), then add:",
  gemini: "In Gemini on the web: Settings & help → Connected Apps → Add a custom app, then paste:",
  cursor: "In Cursor: Settings → MCP, add a server pointing at:",
};

/** Secondary note under the step-1 one-liner — only Gemini needs one today. */
const STEP1_NOTE: Partial<Record<McpClientId, string>> = {
  gemini: "Needs a personal Google account in the US, with Keep Activity on.",
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
 * OpenClaw band for a visitor `detectPlatform` reads as non-Mac — the local
 * agent has no self-bootstrapping installer there yet (see the spec's
 * persona matrix), so this replaces the curl command with plain-language
 * routing to the zero-install MCP path plus a "notify me" capture, instead
 * of showing a command that cannot run. Reuses the same `joinConnectWaitlist`
 * action + `resolveWaitlistOutcome` decision helper as `OpenclawWaitlistForm`
 * (landing/`/openclaw`) rather than forking a second waitlist flow — only
 * the markup differs, to match /connect's squared, token-based styling
 * instead of that component's dark-landing one.
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
  const [mcpClient, setMcpClient] = useState<McpClientId>(MCP_CLIENTS[0].id);
  // Derived, not a second lookup table — MCP_CLIENTS (connect-clients.ts) is
  // the one place a client's label/openUrl live (R2's "Open <client>" action).
  const activeMcpClient = MCP_CLIENTS.find((c) => c.id === mcpClient)!;
  // Which lane the "How it works" trigger explains — mirrors HowItWorksFilmId
  // directly rather than re-deriving it from a client id, since the OpenClaw
  // section is no longer a picker selection. Only a `?client=openclaw` deep
  // link can move this to "claw"; everything else keeps it on "mcp".
  const [lane, setLane] = useState<HowItWorksFilmId>("mcp");
  const [film, setFilm] = useState<HowItWorksFilmId | null>(null);
  // Client-only OS read for the OpenClaw section (Mac command vs. non-Mac
  // band). Starts null so server and first render match (no hydration
  // mismatch) and so a non-Mac visitor never sees a flash of a command that
  // can't run — the one-frame empty state while this resolves is fine.
  const [platform, setPlatform] = useState<DetectedPlatform | null>(null);
  const mcpSectionRef = useRef<HTMLElement>(null);
  const openclawSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent));
  }, []);

  /** Shared by picker clicks and the `?client=` deep link so both paths
   *  save the same handoff client instead of two inline copies drifting. */
  const selectMcpClient = (id: McpClientId) => {
    setMcpClient(id);
    setLane("mcp");
    const handoff = handoffClientFromConnectTab(id);
    if (handoff) saveHandoffClient(handoff);
  };

  const switchToClaudeTab = () => {
    selectMcpClient("claude");
    mcpSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const fromQuery = parseConnectClientParam(searchParams.get("client"));
    if (!fromQuery) return;
    if (fromQuery === "openclaw") {
      setLane("claw");
      openclawSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    selectMcpClient(fromQuery);
  }, [searchParams]);

  return (
    <div>
      <h1 className="font-display text-display font-extrabold text-foreground">
        Your AI already knows how to job hunt. Give it the real market.
      </h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Pair intervu with the AI you already use. It searches and tracks verified listings for
        you — and can never apply anywhere without you.{" "}
        <button
          type="button"
          onClick={() => setFilm(lane)}
          className="cursor-pointer border-0 bg-transparent p-0 font-medium text-brand underline-offset-4 hover:underline"
          data-testid="connect-how-it-works"
        >
          How it works
        </button>
      </p>

      <section ref={mcpSectionRef} className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Connect your AI chat</h2>

        <div
          data-testid="connect-tabs"
          role="tablist"
          aria-label="AI client"
          className="mt-4 flex flex-wrap gap-2"
        >
          {MCP_CLIENTS.map((client) => (
            <button
              key={client.id}
              type="button"
              role="tab"
              aria-selected={mcpClient === client.id}
              onClick={() => selectMcpClient(client.id)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-none border px-4 py-2 text-sm font-medium transition ${
                mcpClient === client.id
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
            <p className="mt-3 text-sm text-foreground">{STEP1_INTRO[mcpClient]}</p>
            <div className="mt-3">
              <CopyUrlBar value={MCP_CONNECTOR_URL} />
            </div>
            {/* Copy stays the primary, load-bearing instruction — opening the
             *  app doesn't configure anything by itself — so this comes
             *  AFTER the copy bar, never before (R2, 2026-08-09). */}
            <a
              href={activeMcpClient.openUrl}
              target="_blank"
              rel="noopener"
              data-testid="connect-open-client"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              <ArrowSquareOut size={16} />
              Open {activeMcpClient.label}
            </a>
            {STEP1_NOTE[mcpClient] ? (
              <p className="mt-2 text-xs text-muted-foreground">{STEP1_NOTE[mcpClient]}</p>
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
          </div>

          <div className="rounded-none border border-border p-6">
            <StepLabel n={3} label="Ask" />
            <p className="mt-3 text-sm italic text-foreground">
              &ldquo;What&apos;s the next job I should apply to?&rdquo;
            </p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-foreground">
              Try these first
            </p>
            <ul className="mt-2 space-y-1.5">
              {TRY_THESE_PROMPTS.map((prompt) => (
                <li key={prompt} className="text-sm italic text-foreground">
                  &ldquo;{prompt}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section ref={openclawSectionRef} className="mt-10 rounded-none border border-border p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-foreground">OpenClaw — a local agent for your Mac</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Different from the connectors above: OpenClaw installs on your machine and works the
          market overnight — you approve every application before it goes out.
        </p>
        {platform === "mac" ? (
          <div className="mt-4 space-y-4">
            <CopyUrlBar value={OPENCLAW_INSTALL_COMMAND} />
            <p className="text-xs text-muted-foreground">{OPENCLAW_INSTALL_HINT}</p>
            <p className="text-xs text-muted-foreground">
              This sets up everything it needs on your Mac — nothing else to install first.{" "}
              <Link
                href="/connect/help#install-node"
                className="underline underline-offset-4 hover:text-foreground"
              >
                What exactly does this install?
              </Link>
            </p>
          </div>
        ) : platform === null ? null : (
          <div className="mt-4">
            <OpenclawNonMacBand onSwitchToClaude={switchToClaudeTab} />
          </div>
        )}
      </section>

      <div className="mt-10 max-w-xl space-y-3 text-xs text-muted-foreground">
        <p>{CONNECT_HEALTH_COPY}</p>
        <p>
          Revocable any time in settings. Your AI&apos;s subscription does the thinking —
          intervu provides the data.
        </p>
      </div>

      <HowItWorksFilm film={film} onOpenChange={(open) => !open && setFilm(null)} />
    </div>
  );
}
