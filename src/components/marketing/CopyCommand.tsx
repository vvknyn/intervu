"use client";

import { useState } from "react";

/**
 * Copyable command block for /openclaw's setup steps and the front door's
 * install command. Same `copied`-state shape AND the same ink-bordered
 * visual treatment as /connect's `CopyUrlBar` (connect-client.tsx) — local
 * boolean, clipboard write, revert after 1.5s, silent no-op if the
 * Clipboard API is denied, `border-2 border-foreground` box with no fill —
 * reused rather than inventing a second copy-to-clipboard pattern (this one
 * used to paint its own `--oc-night` block; one-visual-world pass,
 * 2026-08-04, retired that in favor of the token-based box already proven
 * on /connect).
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
    <div className="flex items-stretch border-2 border-foreground">
      <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5">
        <code className="text-[13px] text-foreground">{command}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 border-l-2 border-foreground px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
