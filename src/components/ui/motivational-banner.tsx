"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { X } from "@phosphor-icons/react";
import { BANNER_QUOTES, pickRandom } from "@/lib/copy";

const DISMISSED_UNTIL_KEY = "banner_dismissed_until";
const DISABLED_KEY = "banner_disabled";
const ROTATE_INTERVAL = 3 * 60 * 1000; // 3 minutes

export function MotivationalBanner() {
    const [text, setText] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);
    const [fading, setFading] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const pickNext = useCallback(() => {
        setFading(true);
        setTimeout(() => {
            setText(pickRandom(BANNER_QUOTES));
            setFading(false);
        }, 400);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;

        if (localStorage.getItem(DISABLED_KEY) === "true") return;

        const dismissedUntil = localStorage.getItem(DISMISSED_UNTIL_KEY);
        if (dismissedUntil && Date.now() < Number(dismissedUntil)) return;

        setText(pickRandom(BANNER_QUOTES));
        setVisible(true);

        intervalRef.current = setInterval(pickNext, ROTATE_INTERVAL);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [pickNext]);

    const dismiss = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
        localStorage.setItem(DISMISSED_UNTIL_KEY, String(tomorrow));
        setVisible(false);
    };

    if (!visible || !text) return null;

    return (
        <div className="flex items-center justify-center gap-2 py-2 mb-2 group/banner">
            <p
                className={`text-xs text-muted-foreground text-center leading-relaxed select-none transition-opacity duration-400 ${fading ? "opacity-0" : "opacity-100"}`}
            >
                {text}
            </p>
            <button
                onClick={dismiss}
                className="opacity-0 group-hover/banner:opacity-100 p-0.5 rounded-ctl text-muted-foreground hover:text-muted-foreground transition-opacity duration-200"
                aria-label="Dismiss"
            >
                <X />
            </button>
        </div>
    );
}
