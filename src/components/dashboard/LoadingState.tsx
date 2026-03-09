import { useState, useEffect, useCallback, useRef } from "react";
import { pickRandom, LOADING_TIPS } from "@/lib/copy";

interface LoadingStateProps {
    message: string;
}

export function LoadingState({ message }: LoadingStateProps) {
    const [tip, setTip] = useState(LOADING_TIPS[0]);
    const [fading, setFading] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const rotateTip = useCallback(() => {
        setFading(true);
        setTimeout(() => {
            setTip(pickRandom(LOADING_TIPS));
            setFading(false);
        }, 300);
    }, []);

    useEffect(() => {
        setTip(pickRandom(LOADING_TIPS));
        intervalRef.current = setInterval(rotateTip, 8000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [rotateTip]);

    return (
        <div className="text-center py-20 fade-in flex flex-col items-center gap-5">
            <div className="relative">
                <div className="w-8 h-8 border-2 border-brand/20 border-t-brand rounded-full animate-spin"></div>
            </div>
            <div className="space-y-1">
                <p className="text-foreground text-sm font-medium">{message}</p>
                <p className={`text-muted-foreground text-xs transition-opacity duration-300 ${fading ? "opacity-0" : "opacity-100"}`}>{tip}</p>
            </div>
        </div>
    );
}
