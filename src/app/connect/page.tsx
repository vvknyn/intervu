import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectClient } from "./connect-client";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

const TITLE = "Connect your AI to intervu (MCP)";
const DESCRIPTION =
  "Pair Claude, Gemini CLI, or Cursor with intervu's verified job data through an MCP server for job search — ask your AI client to find and track real openings without leaving the chat.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/connect", TITLE, DESCRIPTION),
};

export default function ConnectPage() {
  return (
    <main data-testid="connect-page" className="mx-auto max-w-6xl xl:max-w-7xl px-4 sm:px-8 py-10">
      <Suspense fallback={null}>
        <ConnectClient />
      </Suspense>
    </main>
  );
}
