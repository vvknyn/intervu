import type { Metadata } from "next";
import { ConnectClient } from "./connect-client";

export const metadata: Metadata = {
  title: "Connect your AI to intervu (MCP)",
  description:
    "Pair Claude, Gemini CLI, or Cursor with intervu's verified job data through an MCP server for job search — ask your AI client to find and track real openings without leaving the chat.",
};

export default function ConnectPage() {
  return (
    <main data-testid="connect-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <ConnectClient />
    </main>
  );
}
