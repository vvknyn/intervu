/**
 * Privacy-safe résumé funnel payloads — pure helpers for unit tests and UI seams.
 */

export type ResumeFunnelReason =
    | "fit"
    | "customize"
    | "for-you"
    | "resume"
    | "tailor"
    | "tracker"
    | "drop"
    | "picker"
    | "paste";

export type ResumeInputSource = "drop" | "picker" | "paste";

export type ResumeFileType = "pdf" | "doc" | "docx" | "other";

export type ResumeSizeBucket = "empty" | "lt_100kb" | "100kb_1mb" | "1mb_5mb" | "gt_5mb";

export type ResumeErrorClass =
    | "type"
    | "size"
    | "empty"
    | "too_short"
    | "read_error"
    | "parse_error"
    | "unsupported";

export type ResumeParserEngine = "on_device_model" | "rules";

const FORBIDDEN_PAYLOAD_KEYS = new Set([
    "filename",
    "file_name",
    "email",
    "message",
    "raw_error",
    "error_message",
    "file_contents",
    "content",
    "resume_text",
    "job_description",
]);

/** Classify byte size without exposing the file. */
export function classifyResumeSizeBucket(byteLength: number): ResumeSizeBucket {
    if (byteLength <= 0) return "empty";
    if (byteLength < 100 * 1024) return "lt_100kb";
    if (byteLength < 1024 * 1024) return "100kb_1mb";
    if (byteLength < 5 * 1024 * 1024) return "1mb_5mb";
    return "gt_5mb";
}

/** Map extension/mime class — never the filename. */
export function classifyResumeFileType(extensionOrMime: string | undefined | null): ResumeFileType {
    const raw = (extensionOrMime ?? "").toLowerCase();
    const normalized = raw.includes(".") ? raw.split(".").pop()! : raw;
    if (normalized === "pdf" || raw.includes("application/pdf")) return "pdf";
    if (normalized === "doc") return "doc";
    if (normalized === "docx" || raw.includes("wordprocessingml")) return "docx";
    return "other";
}

/** Stable error codes only — never exception messages. */
export function classifyResumeError(input: {
    kind?: string;
    message?: string;
    byteLength?: number;
}): ResumeErrorClass {
    const kind = (input.kind ?? "").toLowerCase();
    const message = (input.message ?? "").toLowerCase();
    if (kind.includes("unsupported") || message.includes("unsupported file")) return "unsupported";
    if (kind.includes("size") || message.includes("too large") || message.includes("file size")) return "size";
    if (kind.includes("empty") || input.byteLength === 0) return "empty";
    if (kind.includes("short") || message.includes("too short")) return "too_short";
    if (kind.includes("read") || message.includes("read")) return "read_error";
    if (kind.includes("type") || message.includes("file type")) return "type";
    return "parse_error";
}

export interface ResumeFunnelBaseProps {
    reason?: ResumeFunnelReason;
    source?: ResumeInputSource;
    file_type?: ResumeFileType;
    size_bucket?: ResumeSizeBucket;
    latency_ms?: number;
    duration_ms?: number;
    parser_source?: ResumeParserEngine;
    engine?: ResumeParserEngine;
    error_class?: ResumeErrorClass;
    error_code?: ResumeErrorClass;
    surface?: string;
    signed_in?: boolean;
    section_count?: number;
    warning_count?: number;
    edited?: boolean;
}

/** Strip sensitive keys and normalize engine/error aliases. */
export function buildResumeFunnelPayload(
    props: ResumeFunnelBaseProps & Record<string, unknown>,
): ResumeFunnelBaseProps {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
        if (FORBIDDEN_PAYLOAD_KEYS.has(key)) continue;
        if (value === undefined) continue;
        clean[key] = value;
    }
    if (clean.engine && !clean.parser_source) {
        clean.parser_source = clean.engine;
    }
    if (clean.error_code && !clean.error_class) {
        clean.error_class = clean.error_code;
    }
    return clean as ResumeFunnelBaseProps;
}
