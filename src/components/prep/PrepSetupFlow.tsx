"use client";

import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PrepSettings, type QuestionSettings } from "@/components/dashboard/PrepSettings";
import type { PrepJobContext } from "@/lib/prep/job-context";
import type { StarStory, SourceItem } from "@/types";
import { PrepJobHeader } from "./PrepJobHeader";

export interface PrepSetupFlowProps {
  jobContext: PrepJobContext;
  onJobContextChange: (ctx: PrepJobContext) => void;
  prepSettings: QuestionSettings;
  onPrepSettingsChange: (s: QuestionSettings) => void;
  resume: string;
  stories: StarStory[];
  sources: SourceItem[];
  onContinue: () => void;
  onBack: () => void;
  isFetchingJob?: boolean;
  onFetchJobContext?: () => void;
}

export function PrepSetupFlow({
  jobContext,
  onJobContextChange,
  prepSettings,
  onPrepSettingsChange,
  resume,
  stories,
  sources,
  onContinue,
  onBack,
  isFetchingJob = false,
  onFetchJobContext = () => {},
}: PrepSetupFlowProps) {
  const updateIdentity = (field: "companyName" | "jobTitle", value: string) => {
    onJobContextChange({
      ...jobContext,
      identity: { ...jobContext.identity, [field]: value },
    });
  };

  const updateRound = (round: string) => {
    onJobContextChange({
      ...jobContext,
      interview: { ...jobContext.interview, round },
    });
  };

  const hasResume = resume.length > 50;
  const storyCount = stories.filter((s) => !s.deleted).length;
  const sourceCount = sources.length;

  return (
    <div className="w-full max-w-2xl animate-in fade-in duration-300">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6 -ml-2">
        <ArrowLeft size={16} className="mr-1.5" />
        Back
      </Button>

      <PrepJobHeader jobContext={jobContext} />

      <div className="space-y-6">
        <div className="space-y-4 p-5 rounded-xl border border-border/40 bg-card">
          <h3 className="text-sm font-medium">Role details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prep-company">Company</Label>
              <Input
                id="prep-company"
                placeholder="e.g. Google"
                value={jobContext.identity.companyName}
                onChange={(e) => updateIdentity("companyName", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prep-role">Role</Label>
              <Input
                id="prep-role"
                placeholder="e.g. Product Manager"
                value={jobContext.identity.jobTitle}
                onChange={(e) => updateIdentity("jobTitle", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prep-round">Interview round</Label>
            <Input
              id="prep-round"
              placeholder="e.g. Behavioral, Technical, Onsite"
              value={jobContext.interview.round}
              onChange={(e) => updateRound(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card">
          <PrepSettings
            settings={prepSettings}
            onChange={onPrepSettingsChange}
            jobUrl={jobContext.identity.sourceUrl ?? ""}
            onJobUrlChange={(url) =>
              onJobContextChange({
                ...jobContext,
                identity: { ...jobContext.identity, sourceUrl: url },
              })
            }
            jobContext={jobContext.content.originalJd ?? ""}
            onJobContextChange={(text) =>
              onJobContextChange({
                ...jobContext,
                content: { ...jobContext.content, originalJd: text },
              })
            }
            isFetchingJob={isFetchingJob}
            onFetchJobContext={onFetchJobContext}
          />
          <span className="text-sm text-muted-foreground">Prep intensity &amp; counts</span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center text-xs text-muted-foreground">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/30">
            <p className="font-medium text-foreground">{hasResume ? "✓" : "—"}</p>
            <p>Resume</p>
          </div>
          <div className="p-3 rounded-lg border border-border/30 bg-muted/30">
            <p className="font-medium text-foreground">{storyCount}</p>
            <p>Stories</p>
          </div>
          <div className="p-3 rounded-lg border border-border/30 bg-muted/30">
            <p className="font-medium text-foreground">{sourceCount}</p>
            <p>Sources</p>
          </div>
        </div>

        <Button
          variant="brand"
          size="lg"
          className="w-full h-12"
          onClick={onContinue}
        >
          Continue to mode selection
          <ArrowRight size={18} weight="bold" className="ml-2" />
        </Button>
      </div>
    </div>
  );
}
