"use client";

import { useState } from "react";

/**
 * Copyable command block for /openclaw's setup steps. Same `copied`-state
 * shape as /connect's `CopyUrlBar` (connect-client.tsx) — local boolean,
 * clipboard write, revert after 1.5s, silent no-op if the Clipboard API is
 * denied — reused rather than inventing a second copy-to-clipboard pattern.
 */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be denied (permissions/insecure context) — the
      // command is still plain visible text, so this degrades to a no-op
      // rather than breaking the page.
    }
  };

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-[rgb(var(--oc-night))]">
      <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-[13px] text-white">{command}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 border-l border-white/15 px-3 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--oc-coral))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--oc-night))]"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
