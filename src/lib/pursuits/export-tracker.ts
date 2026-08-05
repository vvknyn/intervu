/**
 * Client-side export helpers for the /yours tracker — pure serialization,
 * no I/O.
 */

import { trackerStatusLabel } from "@/lib/pursuits/tracker-display";
import type { Pursuit } from "@/lib/pursuits/types";

export type TrackerExportFormat = "csv" | "json";

function csvEscape(value: string): string {
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

const CSV_HEADERS = ["company", "position", "status", "applied_at", "job_url", "note", "created_at", "updated_at"] as const;

function pursuitRow(p: Pursuit): Record<(typeof CSV_HEADERS)[number], string> {
    return {
        company: p.company_name ?? "",
        position: p.position ?? "",
        status: trackerStatusLabel(p.status),
        applied_at: p.applied_at ?? "",
        job_url: p.job_url ?? "",
        note: p.note ?? "",
        created_at: p.created_at ?? "",
        updated_at: p.updated_at ?? "",
    };
}

export function serializePursuitsCsv(pursuits: Pursuit[]): string {
    const lines = [CSV_HEADERS.join(",")];
    for (const p of pursuits) {
        const row = pursuitRow(p);
        lines.push(CSV_HEADERS.map((h) => csvEscape(row[h])).join(","));
    }
    return lines.join("\n");
}

export function serializePursuitsJson(pursuits: Pursuit[]): string {
    return JSON.stringify(
        pursuits.map((p) => ({
            id: p.id,
            ...pursuitRow(p),
            stage: p.status,
        })),
        null,
        2,
    );
}

export function trackerExportFilename(format: TrackerExportFormat, now = new Date()): string {
    const stamp = now.toISOString().slice(0, 10);
    return `intervu-tracker-${stamp}.${format}`;
}

export function trackerExportMime(format: TrackerExportFormat): string {
    return format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
}

/** Trigger a browser download — thin I/O wrapper around pure serializers. */
export function downloadTrackerExport(pursuits: Pursuit[], format: TrackerExportFormat): void {
    const body = format === "csv" ? serializePursuitsCsv(pursuits) : serializePursuitsJson(pursuits);
    const blob = new Blob([body], { type: trackerExportMime(format) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = trackerExportFilename(format);
    a.click();
    URL.revokeObjectURL(url);
}
