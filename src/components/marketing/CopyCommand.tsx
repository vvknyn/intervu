"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The single copy-command primitive for /connect and /openclaw — one shape
 * for a labeled, copyable shell command: an optional sentence-case label
 * above the code, the command itself, and a ghost "Copy" word. Flat
 * `bg-muted` layer, no border — the Button primitive supplies its own 2px
 * Klein focus ring, so there is nothing hand-rolled to keep in sync. Local
 * boolean, clipboard write, revert after 1.5s, silent no-op if the Clipboard
 * API is denied. Replaces the three prior shapes (this component's own bare
 * form, /connect's bespoke `CopyBox`, and the mocked-up `CopyUrlBar` that
 * never existed as a real component) — every call site now renders through
 * here.
 *
 * `label`, when given, is plain sentence-case sans — never wrapped in
 * `<code>` and never given the monospace utility class (banned on .tsx,
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
    <div className="flex items-center gap-3 bg-muted px-4 py-3">
      <div className="min-w-0 flex-1 overflow-x-auto">
        {label && (
          <div className="mb-1 whitespace-nowrap text-xs font-semibold text-muted-foreground">
            {label}
          </div>
        )}
        <pre>
          <code className="select-all text-sm text-foreground">{command}</code>
        </pre>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className="shrink-0">
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
