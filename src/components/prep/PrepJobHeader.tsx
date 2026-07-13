"use client";

import { PencilSimple } from "@phosphor-icons/react";
import type { PrepJobContext } from "@/lib/prep/job-context";
import { Button } from "@/components/ui/button";

export interface PrepJobHeaderProps {
  jobContext: PrepJobContext;
  onEdit?: () => void;
}

export function PrepJobHeader({ jobContext, onEdit }: PrepJobHeaderProps) {
  const { companyName, jobTitle } = jobContext.identity;
  const { round } = jobContext.interview;
  const hasIdentity = companyName || jobTitle || round;

  if (!hasIdentity) return null;

  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {companyName || "Company"}
          {jobTitle ? ` · ${jobTitle}` : ""}
        </h2>
        {round && (
          <p className="text-sm text-muted-foreground mt-1">{round} round</p>
        )}
      </div>
      {onEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit} className="shrink-0">
          <PencilSimple size={16} className="mr-1.5" />
          Edit
        </Button>
      )}
    </div>
  );
}
