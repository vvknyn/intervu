"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PrepPlanView } from "@/lib/prep/plan-list";

export interface PrepPackageSwitchProps {
  activeView: PrepPlanView;
  onSwitch: (view: PrepPlanView) => void;
  hasActiveSession: boolean;
}

export function PrepPackageSwitch({
  activeView,
  onSwitch,
  hasActiveSession,
}: PrepPackageSwitchProps) {
  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => onSwitch(value as PrepPlanView)}
      data-testid="prep-view-switch"
      className="w-full max-w-xs"
    >
      <TabsList className="w-full grid grid-cols-2">
        <TabsTrigger value="session" className="relative">
          Session
          {hasActiveSession && activeView !== "session" && (
            <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-brand" />
          )}
        </TabsTrigger>
        <TabsTrigger value="package">Prep package</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
