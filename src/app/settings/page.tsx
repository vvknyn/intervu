import { Suspense } from "react";
import { SettingsContainer } from "@/components/settings/SettingsContainer";
import { SettingsLoading } from "@/components/settings/SettingsLoading";

export default function SettingsPage() {
    return (
        <Suspense fallback={<SettingsLoading />}>
            <SettingsContainer />
        </Suspense>
    );
}
