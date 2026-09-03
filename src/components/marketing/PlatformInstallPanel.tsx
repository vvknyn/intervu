"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CopyCommand } from "@/components/marketing/CopyCommand";
import { OpenclawWaitlistForm } from "@/components/marketing/OpenclawWaitlistForm";
import {
  MAC_INSTALL_COMMAND_LABEL,
  OPENCLAW_INSTALL_HINT,
  PLATFORM_INSTALL_STATUS,
} from "@/components/marketing/openclaw-content";
import { detectPlatform } from "@/lib/detect-platform";
import { cn } from "@/lib/utils";

/**
 * Platform-scoped install truth for the local OpenClaw agent (D1/D4,
 * 2026-08-26 redesign, §02/§06) — shared by /connect's OpenClaw card and
 * /openclaw's closing section so both read the same two rows instead of
 * each carrying its own copy of the install command and the waitlist. Before
 * this, /connect showed the Mac command with no Windows/Linux path at all,
 * while /openclaw's closing section printed a blanket "get notified when
 * it's installable" one screen below its own live install steps.
 *
 * No platform flash (frozen prop 4): the first render is always BOTH rows,
 * identical to what a server render would produce. Detection only adds a
 * highlight to the row that matches the visitor's platform — it never hides
 * or swaps content that was already on screen. The component this replaces
 * did exactly that: `platform === "mac" || platform === null` rendered the
 * Mac command on every frame before the `useEffect` ran, including for a
 * Windows visitor who would see it flash before the waitlist form appeared.
 */
export function PlatformInstallPanel({ installCommand }: { installCommand: string }) {
  const [detected, setDetected] = useState<"mac" | "waitlist" | null>(null);

  useEffect(() => {
    setDetected(detectPlatform(navigator.userAgent) === "mac" ? "mac" : "waitlist");
  }, []);

  return (
    <div className="space-y-2.5">
      <PlatformRow highlighted={detected === "mac"} status={PLATFORM_INSTALL_STATUS.mac} pillVariant="verdict-good">
        <CopyCommand command={installCommand} label={MAC_INSTALL_COMMAND_LABEL} />
        <p className="mt-2 text-xs text-muted-foreground">{OPENCLAW_INSTALL_HINT}</p>
      </PlatformRow>
      <PlatformRow
        highlighted={detected === "waitlist"}
        status={PLATFORM_INSTALL_STATUS.waitlist}
        pillVariant="verdict-caution"
      >
        <OpenclawWaitlistForm className="mt-2.5" ctaLabel="Notify me" />
      </PlatformRow>
    </div>
  );
}

function PlatformRow({
  status,
  pillVariant,
  highlighted,
  children,
}: {
  status: { row: string; pill: string; body: string };
  pillVariant: "verdict-good" | "verdict-caution";
  highlighted: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-none border p-3.5 transition-colors",
        highlighted ? "border-brand bg-muted" : "border-border bg-muted",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-2 text-xs font-semibold text-foreground">{status.row}</span>
          <span className="text-xs text-muted-foreground">{status.body}</span>
        </div>
        <Badge variant={pillVariant}>{status.pill}</Badge>
      </div>
      {children}
    </div>
  );
}
