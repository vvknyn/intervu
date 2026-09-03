"use client";

import { useState } from "react";

/**
 * The single copy-command primitive for /connect and /openclaw (2026-08-26
 * redesign, §03) — one shape for a labeled, copyable shell command: an
 * optional uppercase label above the code, the command itself, and a COPY
 * chip. Local boolean, clipboard write, revert after 1.5s, silent no-op if
 * the Clipboard API is denied, `border-2 border-foreground` box with no fill.
 * Replaces the three prior shapes (this component's own bare form, /connect's
 * bespoke `CopyBox`, and the mocked-up `CopyUrlBar` that never existed as a
 * real component) — every call site now renders through here.
 *
 * `label`, when given, is plain uppercase sans — never wrapped in `<code>`
 * and never given the monospace utility class (banned on .tsx,
 * tests/unit/typography.test.ts): it names the command, it isn't itself code.
 */
export function CopyCommand({ command, label }: { command: string; label?: string }) {
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
      <div className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5">
        {label && (
          <div className="mb-1 whitespace-nowrap text-xs font-semibold text-muted-foreground">
            {label}
          </div>
        )}
        <pre>
          <code className="text-xs text-foreground">{command}</code>
        </pre>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 border-l-2 border-foreground px-3 py-2.5 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
