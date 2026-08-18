"use client";

import { useEffect, useRef } from "react";

/**
 * CursorFabricBackground — Interactive cloth/fabric mesh simulation.
 * Simulates a continuous undulating silk fabric surface that dynamically
 * deforms, ripples, and flows in response to cursor velocity and proximity.
 */
export function CursorFabricBackground() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        let animationFrameId: number;
        let width = (canvas.width = window.innerWidth);
        let height = (canvas.height = window.innerHeight);

        // Simulation parameters
        const cols = Math.max(16, Math.floor(width / 45));
        const rows = Math.max(12, Math.floor(height / 45));
        const numPoints = (cols + 1) * (rows + 1);

        // Point arrays for cloth mesh
        const origX = new Float32Array(numPoints);
        const origY = new Float32Array(numPoints);
        const curX = new Float32Array(numPoints);
        const curY = new Float32Array(numPoints);
        const vx = new Float32Array(numPoints);
        const vy = new Float32Array(numPoints);

        // Initialize grid
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                const idx = r * (cols + 1) + c;
                const px = (c / cols) * width;
                const py = (r / rows) * height;
                origX[idx] = px;
                origY[idx] = py;
                curX[idx] = px;
                curY[idx] = py;
                vx[idx] = 0;
                vy[idx] = 0;
            }
        }

        // Pointer state with smoothing
        const pointer = {
            x: width * 0.5,
            y: height * 0.5,
            targetX: width * 0.5,
            targetY: height * 0.5,
            prevX: width * 0.5,
            prevY: height * 0.5,
            vx: 0,
            vy: 0,
            active: false,
        };

        const handlePointerMove = (e: MouseEvent | TouchEvent) => {
            const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
            const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
            pointer.targetX = clientX;
            pointer.targetY = clientY;
            pointer.active = true;
        };

        const handlePointerLeave = () => {
            pointer.active = false;
        };

        window.addEventListener("mousemove", handlePointerMove, { passive: true });
        window.addEventListener("touchstart", handlePointerMove, { passive: true });
        window.addEventListener("touchmove", handlePointerMove, { passive: true });
        window.addEventListener("mouseleave", handlePointerLeave);

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
            for (let r = 0; r <= rows; r++) {
                for (let c = 0; c <= cols; c++) {
                    const idx = r * (cols + 1) + c;
                    origX[idx] = (c / cols) * width;
                    origY[idx] = (r / rows) * height;
                }
            }
        };

        window.addEventListener("resize", handleResize, { passive: true });

        let time = 0;

        const render = () => {
            time += 0.015;

            // Interpolate mouse
            pointer.prevX = pointer.x;
            pointer.prevY = pointer.y;
            pointer.x += (pointer.targetX - pointer.x) * 0.15;
            pointer.y += (pointer.targetY - pointer.y) * 0.15;
            pointer.vx = pointer.x - pointer.prevX;
            pointer.vy = pointer.y - pointer.prevY;

            // Detect theme
            const isDark = document.documentElement.classList.contains("dark");

            ctx.clearRect(0, 0, width, height);

            // Update cloth vertices with spring physics + ambient silk wave
            const influenceRadius = 180;
            const influenceRadiusSq = influenceRadius * influenceRadius;

            for (let r = 0; r <= rows; r++) {
                for (let c = 0; c <= cols; c++) {
                    const idx = r * (cols + 1) + c;
                    const ox = origX[idx];
                    const oy = origY[idx];

                    // Ambient cloth harmonic wave (undulating silk)
                    const waveOffset =
                        Math.sin(ox * 0.003 + time * 1.2) * 6 +
                        Math.cos(oy * 0.004 + time * 0.9) * 6 +
                        Math.sin((ox + oy) * 0.002 + time * 0.6) * 4;

                    const targetX = ox;
                    const targetY = oy + waveOffset;

                    // Cursor displacement (fabric deformation)
                    const dx = curX[idx] - pointer.x;
                    const dy = curY[idx] - pointer.y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq < influenceRadiusSq && pointer.active) {
                        const dist = Math.sqrt(distSq);
                        const force = (1 - dist / influenceRadius) * 22;
                        const angle = Math.atan2(dy, dx);
                        vx[idx] += Math.cos(angle) * force * 0.3 + pointer.vx * 0.18;
                        vy[idx] += Math.sin(angle) * force * 0.3 + pointer.vy * 0.18;
                    }

                    // Spring return force
                    const fx = (targetX - curX[idx]) * 0.06;
                    const fy = (targetY - curY[idx]) * 0.06;

                    vx[idx] = (vx[idx] + fx) * 0.88; // damping
                    vy[idx] = (vy[idx] + fy) * 0.88;

                    curX[idx] += vx[idx];
                    curY[idx] += vy[idx];
                }
            }

            // Draw organic cloth mesh lines
            const strokeColor = isDark
                ? "rgba(255, 255, 255, 0.05)"
                : "rgba(0, 0, 0, 0.045)";
            const highlightColor = isDark
                ? "rgba(255, 255, 255, 0.09)"
                : "rgba(0, 0, 0, 0.08)";

            ctx.lineWidth = 1;

            // Draw horizontal curves (warp)
            for (let r = 0; r <= rows; r++) {
                ctx.beginPath();
                const startIdx = r * (cols + 1);
                ctx.moveTo(curX[startIdx], curY[startIdx]);

                for (let c = 1; c <= cols; c++) {
                    const idx = r * (cols + 1) + c;
                    const prevIdx = idx - 1;
                    const mx = (curX[prevIdx] + curX[idx]) * 0.5;
                    const my = (curY[prevIdx] + curY[idx]) * 0.5;
                    ctx.quadraticCurveTo(curX[prevIdx], curY[prevIdx], mx, my);
                }
                const lastIdx = r * (cols + 1) + cols;
                ctx.lineTo(curX[lastIdx], curY[lastIdx]);

                ctx.strokeStyle = r % 3 === 0 ? highlightColor : strokeColor;
                ctx.stroke();
            }

            // Draw vertical curves (weft)
            for (let c = 0; c <= cols; c++) {
                ctx.beginPath();
                ctx.moveTo(curX[c], curY[c]);

                for (let r = 1; r <= rows; r++) {
                    const idx = r * (cols + 1) + c;
                    const prevIdx = (r - 1) * (cols + 1) + c;
                    const mx = (curX[prevIdx] + curX[idx]) * 0.5;
                    const my = (curY[prevIdx] + curY[idx]) * 0.5;
                    ctx.quadraticCurveTo(curX[prevIdx], curY[prevIdx], mx, my);
                }
                const lastIdx = rows * (cols + 1) + c;
                ctx.lineTo(curX[lastIdx], curY[lastIdx]);

                ctx.strokeStyle = c % 3 === 0 ? highlightColor : strokeColor;
                ctx.stroke();
            }

            animationFrameId = requestAnimationFrame(render);
        };

        animationFrameId = requestAnimationFrame(render);

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener("mousemove", handlePointerMove);
            window.removeEventListener("touchstart", handlePointerMove);
            window.removeEventListener("touchmove", handlePointerMove);
            window.removeEventListener("mouseleave", handlePointerLeave);
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="fixed inset-0 pointer-events-none -z-10 h-full w-full opacity-80 transition-opacity duration-700"
        />
    );
}
