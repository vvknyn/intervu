"use client";

import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { ExtensionTile } from "@/components/jobs/ExtensionTile";
import { FrontDoorReturnCard } from "@/components/jobs/front-door/FrontDoorReturnCard";
import { writeVisitCursor } from "@/lib/jobs/visit-cursor";

// FrontDoorReturnCard shows only for a returning visitor: plant the cursor before it mounts.
if (typeof window !== "undefined") writeVisitCursor("jobs", new Date(Date.now() - 3 * 86_400_000).toISOString());

const JOB = { id: "mock-job", title: "Senior Data Analyst", company: "Northwind", location: "Toronto, ON" };

export function DismissMock({ width }: { width: number }) {
    return (
        <main className="space-y-6 p-4">
            <div data-testid="notice-frame" style={{ width }}>
                <ExtensionTile />
            </div>
            <div data-testid="notice-frame" style={{ width }}>
                <FrontDoorReturnCard recentQuery="data analyst toronto" onRerun={() => {}} />
            </div>
            <div data-testid="notice-frame" style={{ width }}>
                <McpHandoffNote job={JOB} />
            </div>
            <div data-testid="notice-frame" style={{ width }}>
                <McpHandoffNote />
            </div>
        </main>
    );
}
