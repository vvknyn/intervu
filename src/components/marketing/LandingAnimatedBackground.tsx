"use client";

import { cn } from "@/lib/utils";

/**
 * Subtle architectural background animation:
 * - Precision Cartesian CAD coordinate grid with micro-dots.
 * - Smooth vertical radar scanline sweep.
 * - Ambient horizontal telemetry pulse traces (no distracting text).
 * - Gentle pulsing coordinate nodes at grid vertices.
 * - Center attenuation mask to keep the central reading area completely quiet.
 */
export function LandingAnimatedBackground({ className }: { className?: string }) {
    return (
        <div
            aria-hidden="true"
            className={cn(
                "absolute inset-0 overflow-hidden pointer-events-none select-none z-0",
                className,
            )}
        >
            {/* Architectural Coordinate Grid across whole middle viewport */}
            <svg
                className="absolute inset-0 h-full w-full stroke-border opacity-20"
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    <pattern
                        id="landing-cad-grid"
                        width="48"
                        height="48"
                        patternUnits="userSpaceOnUse"
                    >
                        <path d="M 48 0 L 0 0 0 48" fill="none" strokeWidth="1" />
                        <circle cx="0" cy="0" r="1" className="fill-border" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#landing-cad-grid)" />
            </svg>

            {/* Scanning Radar Line (Slow, quiet vertical sweep) */}
            <div className="absolute inset-x-0 h-px bg-border opacity-25 animate-scanline" />

            {/* Subtle Horizontal Telemetry Traces (No text cards — purely ambient light pulses) */}
            <div className="absolute inset-0 flex flex-col justify-around py-12 overflow-hidden pointer-events-none opacity-30">
                {/* Telemetry Trace 1 */}
                <div className="relative w-full h-px bg-border opacity-20">
                    <div className="absolute -top-px h-0.5 w-12 rounded-pill bg-brand opacity-40 animate-marquee-left" />
                </div>

                {/* Telemetry Trace 2 */}
                <div className="relative w-full h-px bg-border opacity-20">
                    <div className="absolute -top-px h-0.5 w-16 rounded-pill bg-live opacity-40 animate-marquee-right" />
                </div>

                {/* Telemetry Trace 3 */}
                <div className="relative w-full h-px bg-border opacity-20">
                    <div className="absolute -top-px h-0.5 w-10 rounded-pill bg-brand opacity-40 animate-marquee-left" />
                </div>
            </div>

            {/* Subtle Pulsing Coordinate Nodes at Grid Intersections */}
            <div className="absolute inset-0 pointer-events-none">
                <span className="absolute top-1/4 left-1/4 h-1.5 w-1.5 rounded-pill bg-brand opacity-30 animate-pulse" />
                <span className="absolute top-1/3 right-1/4 h-1.5 w-1.5 rounded-pill bg-live opacity-30 animate-pulse" />
                <span className="absolute bottom-1/4 left-1/3 h-1.5 w-1.5 rounded-pill bg-live opacity-30 animate-pulse" />
                <span className="absolute bottom-1/3 right-1/3 h-1.5 w-1.5 rounded-pill bg-brand opacity-30 animate-pulse" />
                <span className="absolute top-1/2 left-12 h-1.5 w-1.5 rounded-pill bg-border opacity-40 animate-pulse" />
                <span className="absolute top-1/2 right-12 h-1.5 w-1.5 rounded-pill bg-border opacity-40 animate-pulse" />
            </div>

            {/* Center Readability Mask: Keeps the center behind the card completely calm */}
            <div className="absolute inset-0 pointer-events-none z-10 landing-radial-mask" />
        </div>
    );
}
