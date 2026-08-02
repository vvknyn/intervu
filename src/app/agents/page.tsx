import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AGENT, claudeCodeConnectCommand, chatAppConnectInstruction } from "@/lib/agent/config";

export const metadata: Metadata = {
  title: "AI agents",
  description:
    "Connect an AI agent to intervu — it searches verified-live jobs, preps applications, and you approve every submit.",
};

/** The three journey beats, in order. Plain content, not logic — kept as
 *  data so the section below stays a simple map, not three hand-copied
 *  blocks that could drift out of sync with each other. */
const JOURNEY = [
  {
    step: "01",
    title: "Search real jobs",
    body: "Your agent searches intervu's verified-live listings — the ghost postings and dead links are already filtered out.",
  },
  {
    step: "02",
    title: "Your agent preps",
    body: "It reads the posting, drafts a tailored resume or cover letter, and gets the application ready to go — using its own hands, not ours.",
  },
  {
    step: "03",
    title: "You approve, every time",
    body: "Nothing goes out without you. You approve the resume it writes, and you approve the moment it actually hits submit.",
  },
] as const;

/**
 * Public, static marketing page for intervu's agent/MCP feature. Server
 * component, no auth required (see middleware.ts — only /account is gated).
 * The connect address and Claude Code command below read from the same
 * `AGENT.issuer()` / `claudeCodeConnectCommand` the settings page's
 * "Connected agents" section uses (`AgentAccessSection.tsx`), so the two
 * surfaces can never show different instructions.
 */
export default function AgentsPage() {
  const mcpUrl = `${AGENT.issuer()}/api/mcp`;
  const chatAppInstruction = chatAppConnectInstruction();

  return (
    <PageLayout header={<PageHeader title="Agents" description="Bring your own AI agent to intervu" />}>
      <div className="mx-auto max-w-3xl space-y-16 py-6">
        {/* Hero */}
        <section className="space-y-4 text-center">
          <h2 className="font-display text-display font-extrabold text-foreground">
            Only real jobs. Browse them yourself — or send your agent.
          </h2>
          <p className="mx-auto max-w-xl text-lg text-muted-foreground">
            Connect the AI app you already use. It searches verified-live jobs, preps applications, and you approve
            every submit.
          </p>
        </section>

        {/* How it works */}
        <section>
          <h2 className="mb-6 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            How it works
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {JOURNEY.map((beat) => (
              <Card key={beat.step}>
                <CardHeader>
                  <div className="mb-1 font-mono text-xs text-brand">{beat.step}</div>
                  <CardTitle className="text-base">{beat.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{beat.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Honest scope */}
        <section>
          <Card className="border-brand/20 bg-brand/5">
            <CardHeader>
              <CardTitle>What intervu actually does</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-foreground">
                intervu never submits applications for you. Your agent runs on your side; we supply verified targets
                and keep your tracker true.
              </p>
              <p className="text-sm text-muted-foreground">Think of us as the map, not the driver.</p>
            </CardContent>
          </Card>
        </section>

        {/* Connect instructions */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Connect your agent</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search and tracking work in any app that supports remote connectors — just add intervu and start
              asking. Agents with browser control can take it from there: they open the posting, fill it in,
              and stop for your approval.
            </p>
          </div>

          <Tabs defaultValue="chat">
            <TabsList>
              <TabsTrigger value="chat">Chat apps</TabsTrigger>
              <TabsTrigger value="cli">Claude Code &amp; CLIs</TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="mt-4">
              <Card>
                <CardContent className="space-y-3 pt-6">
                  <p className="text-sm">{chatAppInstruction.primary} Use this address:</p>
                  <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{mcpUrl}</code>
                  <p className="text-xs text-muted-foreground">
                    That&apos;s intervu&apos;s MCP endpoint — the address any compatible app connects to.
                  </p>
                  <p className="text-xs text-muted-foreground">{chatAppInstruction.alternate}</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cli" className="mt-4">
              <Card>
                <CardContent className="space-y-3 pt-6">
                  <p className="text-xs text-muted-foreground">
                    We test this connection ourselves — the same protocol any MCP client uses.
                  </p>
                  <p className="text-sm">
                    Generate a token in{" "}
                    <Link href="/settings" className="text-brand underline hover:text-brand/80">
                      Settings → Connected agents
                    </Link>
                    , then run:
                  </p>
                  <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                    {claudeCodeConnectCommand(mcpUrl)}
                  </code>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* Safety note */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">One safety note</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                A job posting is somebody else&apos;s text — a company wrote it, not us. So we label it that
                way: job descriptions are third-party text; our responses label them as data, not instructions.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Demo slot — recording is a separate post-ship task; this page doesn't block on it. */}
        <section>
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium">Demo film coming</p>
              <p className="text-xs text-muted-foreground">
                We&apos;re recording a full walkthrough — check back soon.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
}
