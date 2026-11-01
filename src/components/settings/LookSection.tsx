"use client";

import { useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { currentLook, DEFAULT_LOOK, setLook } from "@/lib/ui/look";

function subscribe(onChange: () => void) {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look"] });
    return () => observer.disconnect();
}

/** The look switch (see lib/ui/look.ts): glass on, or the classic look back. This device only. */
export function LookSection() {
    const look = useSyncExternalStore(subscribe, currentLook, () => DEFAULT_LOOK);
    return (
        <div className="flex items-center justify-between gap-4" data-testid="look-section">
            <div className="min-w-0">
                <h2 className="text-base font-semibold leading-snug">
                    <label htmlFor="look-switch">Glass look</label>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Translucent bars, sheets and menus, in the style of iOS 27 on a phone and macOS 27 on a computer. Off brings back the classic look. Applies to this device.
                </p>
            </div>
            <Switch id="look-switch" checked={look === "glass"} onChange={() => setLook(look === "glass" ? "classic" : "glass")} />
        </div>
    );
}
