"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinConnectWaitlist } from "@/actions/connect-waitlist";
import { CONNECT_CLIENTS, type ConnectClientId } from "@/lib/connect-clients";

/**
 * The MCP endpoint intervu's connectors point at. Verified against the
 * in-flight `feat/2026-08-02/agent-mcp` branch (src/app/api/mcp/route.ts,
 * confirmed via its oauth-protected-resource metadata and
 * AgentAccessSection.tsx) — the route is `/api/mcp`, not bare `/mcp`. Using
 * `/mcp` would 404 forever once that backend ships, so this deliberately
 * deviates from a bare-`/mcp` brief.
 */
const MCP_URL = "https://intervu.cc/api/mcp";

/** Only step 1 differs per client — steps 2 and 3 are shared verbatim. */
const STEP1_INTRO: Record<ConnectClientId, string> = {
  claude: "In Claude, open Settings → Connectors → Add custom connector and paste:",
  chatgpt:
    "In ChatGPT: Settings → Connectors (developer mode) → Add — requires a paid plan.",
  gemini:
    "The Gemini app can't take custom MCP connectors yet. In your Gemini CLI settings.json, add intervu as an mcpServers entry pointing at:",
  cursor: "In Cursor, open Settings → MCP and add a new server pointing at:",
  openclaw:
    "In your openclaw.json, add intervu under mcpServers pointing at the URL below. Headless setups authenticate with a personal key — issued here when the agent surface ships.",
};

function CopyUrlBar() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be denied (permissions/insecure context) — the
      // URL is still plain visible text, so this degrades to a no-op
      // rather than breaking the page.
    }
  };

  return (
    <div className="flex items-stretch rounded-none border-2 border-foreground">
      <code className="flex-1 truncate px-3 py-2.5 font-mono text-sm text-foreground">
        {MCP_URL}
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

function WaitlistBand({ activeClient }: { activeClient: ConnectClientId }) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await joinConnectWaitlist({ email, client: activeClient });
      setResult(res.error ? { ok: false, message: res.error } : { ok: true });
    });
  };

  return (
    <section className="mt-10 rounded-none border-2 border-foreground p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-foreground">Rolling out in beta</h2>
      {result?.ok ? (
        <p className="mt-3 text-sm text-brand">
          You&apos;re on the list — we&apos;ll email you when it&apos;s ready.
        </p>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={pending}
              className="rounded-none"
            />
            <Button type="submit" variant="brand" disabled={pending} className="rounded-none">
              {pending ? "Joining…" : "Get early access"}
            </Button>
          </form>
          {result && !result.ok ? (
            <p className="mt-2 text-sm text-foreground">{result.message}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ConnectClient() {
  const [activeClient, setActiveClient] = useState<ConnectClientId>(CONNECT_CLIENTS[0].id);
  const activeClientMeta = CONNECT_CLIENTS.find((c) => c.id === activeClient)!;

  return (
    <div>
      <h1 className="font-display text-display font-extrabold text-foreground">
        Your AI already knows how to job hunt. Give it the real market.
      </h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Pair intervu with the AI client you already use through MCP, and let it search and
        track verified job listings for you.
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
            onClick={() => setActiveClient(client.id)}
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

      <div className="mt-6 space-y-6">
        <div className="rounded-none border border-border p-6">
          <StepLabel n={1} label="Connect" />
          <p className="mt-3 text-sm text-foreground">{STEP1_INTRO[activeClient]}</p>
          {activeClientMeta.supportsDirectConnect ? (
            <div className="mt-3">
              <CopyUrlBar />
            </div>
          ) : null}
        </div>

        <div className="rounded-none border border-border p-6">
          <StepLabel n={2} label="Approve" />
          <p className="mt-3 text-sm text-foreground">Approve once — you're paired.</p>
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
        </div>
      </div>

      <WaitlistBand activeClient={activeClient} />

      <p className="mt-6 max-w-xl text-xs text-muted-foreground">
        Revocable any time in settings. Your AI&apos;s subscription does the thinking —
        intervu provides the data.
      </p>
    </div>
  );
}
