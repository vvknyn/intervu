import { Suspense } from "react";
import { SettingsContainer } from "@/components/settings/SettingsContainer";

function SettingsLoading() {
    return (
        <div className="mx-auto flex max-w-[720px] flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <div className="h-5 w-5 animate-spin rounded-full border border-border border-t-foreground" />
            <p className="text-sm">Loading account…</p>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={<SettingsLoading />}>
            <SettingsContainer />
        </Suspense>
    );
}
