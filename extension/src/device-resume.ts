/**
 * The résumé the extension scores jobs against.
 *
 * With a paid month it is the résumé on the person's Velai account
 * (GET /api/extension/me). Without one, it is the résumé velai.app keeps in
 * this browser: a guest's, or an account's without a paid month, which the
 * site never uploads. velai-bridge.ts reads that one localStorage key on
 * velai.app pages and the service worker keeps a copy in
 * `chrome.storage.local`, on this computer only, so fit, the proposed
 * changes, the PDF, form filling and the résumé-line answers work for free.
 * The copy follows velai.app's: replaced when the site's is, removed when
 * the site's is removed.
 */
import { LOCAL_AI_RESUME_KEY } from "@/lib/local-ai/resume-storage";
import { storedResumeData } from "@/lib/resume/stored-resume-data";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import type { ResumeData } from "@/types/resume";
import { resumeFromMe, type MeResponse } from "./report";

/** velai.app's localStorage key for the résumé it keeps in the browser (the site's own constant). */
export const SITE_RESUME_KEY = LOCAL_AI_RESUME_KEY;

/** chrome.storage.local key: the extension's copy of that résumé. */
export const DEVICE_RESUME_KEY = "velaiDeviceResume";

export interface DeviceResume {
    data: ResumeData;
    updatedAt: string;
}

/** The résumé in use, and where it came from: the account, or this browser. */
export interface ResumeInUse {
    resume: ResumeData;
    updatedAt: string | null;
    from: "account" | "browser";
}

/** Pure: velai.app's stored value as a DeviceResume, or null when there is none or it isn't one. */
export function parseSiteResume(raw: string | null | undefined): DeviceResume | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { data?: unknown; updatedAt?: unknown };
        if (!parsed?.data || typeof parsed.data !== "object" || typeof parsed.updatedAt !== "string") return null;
        return { data: parsed.data as ResumeData, updatedAt: parsed.updatedAt };
    } catch {
        return null;
    }
}

/** JSON with every object's keys in order: Chrome's storage hands objects back with their keys sorted. */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) =>
        v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
    );
}

/** Pure: whether two copies are the same résumé (nothing to store or re-check), whatever order their keys come in. */
export function sameDeviceResume(a: DeviceResume | null, b: DeviceResume | null): boolean {
    if (!a || !b) return a === b;
    return a.updatedAt === b.updatedAt && canonical(a.data) === canonical(b.data);
}

/** Pure: the account's résumé when it gives one, else this browser's when it is usable, else null. */
export function resumeInUse(me: MeResponse | null, device: DeviceResume | null): ResumeInUse | null {
    const account = me?.signedIn ? resumeFromMe(me) : null;
    if (account) return { resume: account, updatedAt: me?.resume?.updatedAt ?? null, from: "account" };
    if (!device) return null;
    const data = storedResumeData(device.data, null);
    return data && resumeIsUsable(data) ? { resume: data, updatedAt: device.updatedAt, from: "browser" } : null;
}

/** The extension's copy, or null. Never throws: an unreadable copy is no copy. */
export async function readDeviceResume(): Promise<DeviceResume | null> {
    try {
        const stored = await chrome.storage.local.get(DEVICE_RESUME_KEY);
        const value = stored[DEVICE_RESUME_KEY] as DeviceResume | undefined;
        return value?.data && typeof value.updatedAt === "string" ? value : null;
    } catch {
        return null;
    }
}
