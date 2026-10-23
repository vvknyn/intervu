import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectClient } from "./connect-client";
import { WaitState } from "@/components/ui/wait-state";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { AGENT } from "@/lib/agent/config";
import { getServerUser } from "@/lib/auth/server-user";
import { mcpConnectorUrl, openclawInstallCommand } from "@/components/marketing/openclaw-content";

const TITLE = "Connect your AI to velai (MCP)";
const DESCRIPTION =
  "Pair Claude, Gemini CLI, or Cursor with velai's verified job data through an MCP server for job search — ask your AI client to find and track real openings without leaving the chat.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata("/connect", TITLE, DESCRIPTION),
};

/**
 * Server shell. It exists to resolve two things the client half must not guess:
 * the connector's own origin (`AGENT.issuer()` — a server-only env var, so
 * reading it here and passing it down is the only way the page can't disagree
 * with the `.well-known` documents a client actually reads), and whether the
 * visitor is signed in.
 *
 * The sign-in fact matters because every route on this page ends at an intervu
 * account: the MCP endpoint answers 401 until a connector completes the OAuth
 * handshake, and the Claude Code lane tells you to paste a token that only
 * Settings → Connected agents can mint. The page used to know neither, so a
 * signed-out visitor was handed a URL and a token placeholder with nothing
 * saying an account was involved (Vivek, 2026-08-24).
 */
export default async function ConnectPage() {
  const issuer = AGENT.issuer();
  const user = await getServerUser();
  return (
    <div data-testid="connect-page" className="shell-row py-10">
      <Suspense fallback={<WaitState label="Loading agents page" fill className="bg-background" />}>
        <ConnectClient
          mcpUrl={mcpConnectorUrl(issuer)}
          installCommand={openclawInstallCommand(issuer)}
          signedIn={Boolean(user)}
        />
      </Suspense>
    </div>
  );
}
