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

export type ResumeErrorClass =
    | "type"
    | "size"
    | "empty"
    | "too_short"
    | "read_error"
    | "parse_error"
    | "unsupported";

export type ResumeParserEngine = "on_device_model" | "rules";

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

/**
 * Everything a résumé funnel event may carry, and the only things it may carry.
 * Nothing here is read from the résumé's content or from how it matches a job:
 * the file's type, which step failed, how long a step took, which parser read
 * it. No size, section or warning counts, and no fit values.
 */
export interface ResumeFunnelProps {
    reason?: ResumeFunnelReason;
    source?: ResumeInputSource;
    file_type?: ResumeFileType;
    latency_ms?: number;
    duration_ms?: number;
    parser_source?: ResumeParserEngine;
    engine?: ResumeParserEngine;
    error_class?: ResumeErrorClass;
    error_code?: ResumeErrorClass;
    surface?: string;
    signed_in?: boolean;
}

/** Deny by default: a key not named here never leaves the browser. Typed against `ResumeFunnelProps`, so a key added to one must be added to the other. */
const FUNNEL_KEYS: Record<keyof ResumeFunnelProps, true> = {
    reason: true,
    source: true,
    file_type: true,
    latency_ms: true,
    duration_ms: true,
    parser_source: true,
    engine: true,
    error_class: true,
    error_code: true,
    surface: true,
    signed_in: true,
};

/** Keep only the allowlisted keys and normalize engine/error aliases. */
export function buildResumeFunnelPayload(props: ResumeFunnelProps & Record<string, unknown>): ResumeFunnelProps {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
        if (!Object.hasOwn(FUNNEL_KEYS, key) || value === undefined) continue;
        clean[key] = value;
    }
    if (clean.engine && !clean.parser_source) {
        clean.parser_source = clean.engine;
    }
    if (clean.error_code && !clean.error_class) {
        clean.error_class = clean.error_code;
    }
    return clean as ResumeFunnelProps;
}
