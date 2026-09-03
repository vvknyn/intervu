"use client";

import * as React from "react";
import { CopyCommand } from "@/components/marketing/CopyCommand";
import { OpenclawWaitlistForm } from "@/components/marketing/OpenclawWaitlistForm";
import {
  MAC_INSTALL_COMMAND_LABEL,
  OPENCLAW_INSTALL_HINT,
  PLATFORM_INSTALL_STATUS,
} from "@/components/marketing/openclaw-content";
import { cn } from "@/lib/utils";

/**
 * Platform-scoped install truth for the local OpenClaw agent — shared by
 * /connect's OpenClaw card and /openclaw's closing section so both read the
 * same two rows instead of each carrying its own copy of the install command
 * and the waitlist. Before this, /connect showed the Mac command with no
 * Windows/Linux path at all, while /openclaw's closing section printed a
 * blanket "get notified when it's installable" one screen below its own live
 * install steps.
 *
 * Both rows always render, in the same order, on every frame — nothing here
 * conditions on the visitor's platform, so there is no first-paint content to
 * flash or swap.
 */
export function PlatformInstallPanel({ installCommand }: { installCommand: string }) {
  return (
    <div className="space-y-3">
      <PlatformRow status={PLATFORM_INSTALL_STATUS.mac} statusClassName="text-live">
        <CopyCommand command={installCommand} label={MAC_INSTALL_COMMAND_LABEL} />
        <p className="mt-2 text-xs text-muted-foreground">{OPENCLAW_INSTALL_HINT}</p>
      </PlatformRow>
      <PlatformRow status={PLATFORM_INSTALL_STATUS.waitlist} statusClassName="text-warn">
        <OpenclawWaitlistForm className="mt-3" ctaLabel="Notify me" />
      </PlatformRow>
    </div>
  );
}

/**
 * PLATFORM_INSTALL_STATUS.pill is stored lowercase ("available today",
 * "waitlist") — capitalizeWords (lib/text-case.ts) would title-case every
 * word, which the rulebook's sentence-case rule forbids. Only the first
 * letter needs it here, so a one-line local helper beats reaching for a
 * mismatched shared one.
 */
function sentenceCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function PlatformRow({
  status,
  statusClassName,
  children,
}: {
  status: { row: string; pill: string; body: string };
  statusClassName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-muted p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-2 text-sm font-semibold text-foreground">{status.row}</span>
          <span className="text-sm text-muted-foreground">{status.body}</span>
        </div>
        <span className={cn("text-xs font-semibold", statusClassName)}>{sentenceCase(status.pill)}</span>
      </div>
      {children}
    </div>
  );
}
