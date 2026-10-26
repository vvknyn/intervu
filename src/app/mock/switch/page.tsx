"use client";

import { useState } from "react";
import { SearchAlertSwitch } from "@/components/jobs/SearchAlertSwitch";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_URL_STATE } from "@/lib/jobs/url-state";

/**
 * The switch at rest, off until clicked, on two call sites of the one primitive: the /jobs
 * "Job alert" switch (signed out; the real results line needs the search backend) and a bare
 * `Switch` as Settings uses it (journey J-NAV-44).
 */
export default function SwitchMockPage() {
    const [alertOpen, setAlertOpen] = useState(false);
    const [remoteOnly, setRemoteOnly] = useState(false);
    return (
        <main className="space-y-4 p-6">
            <SearchAlertSwitch signedIn={false} saved={[]} urlState={DEFAULT_URL_STATE} guestOn={alertOpen} guestRequested={false} onGuestChange={setAlertOpen} />
            <div className="flex items-center gap-2">
                <Switch checked={remoteOnly} onChange={() => setRemoteOnly((v) => !v)} aria-label="Remote only" />
                <span className="text-sm">Remote only</span>
            </div>
        </main>
    );
}
