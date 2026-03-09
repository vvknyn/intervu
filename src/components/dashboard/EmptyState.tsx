import { useState, useEffect } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { pickRandom, EMPTY_DASHBOARD } from "@/lib/copy";

export function EmptyState() {
    // Pick once on mount to avoid hydration mismatch
    const [heading, setHeading] = useState(EMPTY_DASHBOARD.headings[0]);
    useEffect(() => { setHeading(pickRandom(EMPTY_DASHBOARD.headings)); }, []);

    return (
        <div className="text-center py-24 fade-in max-w-lg mx-auto">
            <div className="w-16 h-16 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto mb-6 text-brand">
                <MagnifyingGlass size={32} weight="duotone" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-3">{heading}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-md mx-auto">
                {EMPTY_DASHBOARD.subtext}
            </p>
            <div className="flex items-center justify-center gap-3 mt-6 text-xs text-muted-foreground/50">
                <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
                    Company
                </span>
                <span className="text-border">,</span>
                <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
                    Role
                </span>
                <span className="text-border">,</span>
                <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
                    Round
                </span>
            </div>
        </div>
    );
}
