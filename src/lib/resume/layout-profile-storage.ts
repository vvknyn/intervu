/**
 * Keeps the measured layout of a person's uploaded PDF résumé on this device
 * (`layout-profile.ts`), so the tailored copies they download later print
 * like the original. Stored per person, matched by the email or name the
 * résumé carries (hashed, never stored as text here), so a profile never
 * dresses up somebody else's résumé. Nothing leaves the browser.
 */

import { parseResumeLayoutProfile, type ResumeLayoutProfile } from "@/lib/resume/layout-profile";
import type { ResumeData } from "@/types/resume";

export const RESUME_LAYOUTS_KEY = "velai.resume.layouts";
const MAX_PROFILES = 4;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

interface StoredLayout {
  keys: string[];
  profile: ResumeLayoutProfile;
  savedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** FNV-1a: a short, stable fingerprint, so the store holds no email or name. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function emailKey(email: string | undefined | null): string | null {
  const match = email?.match(EMAIL_RE);
  return match ? `e:${fingerprint(match[0].toLowerCase())}` : null;
}

function nameKey(name: string | undefined | null): string | null {
  const letters = (name ?? "").split(/[,|]/)[0].toLowerCase().replace(/[^\p{L}]+/gu, " ").trim();
  return letters.split(" ").length >= 2 ? `n:${fingerprint(letters)}` : null;
}

/** Who an extracted résumé text belongs to: its email, and its first line as the name. */
export function resumeLayoutKeysFromText(text: string): string[] {
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => /\p{L}/u.test(l) && !EMAIL_RE.test(l) && l.split(/\s+/).length <= 6);
  return [emailKey(text), nameKey(firstLine)].filter((k): k is string => !!k);
}

function resumeLayoutKeysFromData(data: ResumeData): string[] {
  return [emailKey(data.profile?.email), nameKey(data.profile?.name)].filter((k): k is string => !!k);
}

function readAll(): StoredLayout[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(RESUME_LAYOUTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry): StoredLayout[] => {
      const profile = parseResumeLayoutProfile((entry as StoredLayout)?.profile);
      const keys = (entry as StoredLayout)?.keys;
      return profile && Array.isArray(keys) ? [{ keys: keys.filter((k) => typeof k === "string"), profile, savedAt: String((entry as StoredLayout).savedAt ?? "") }] : [];
    });
  } catch {
    return [];
  }
}

/** Remembers the layout of the PDF résumé whose text is `text`. */
export function rememberResumeLayout(text: string, profile: ResumeLayoutProfile, savedAt: string = new Date().toISOString()): void {
  const store = storage();
  const keys = resumeLayoutKeysFromText(text);
  if (!store || keys.length === 0) return;
  const rest = readAll().filter((entry) => !entry.keys.some((k) => keys.includes(k)));
  try {
    store.setItem(RESUME_LAYOUTS_KEY, JSON.stringify([{ keys, profile, savedAt }, ...rest].slice(0, MAX_PROFILES)));
  } catch {
    // Private browsing or a full quota: the export falls back to the default layout.
  }
}

/** The remembered layout of the original résumé `data` was made from, if this device has one. */
export function recallResumeLayout(data: ResumeData): ResumeLayoutProfile | null {
  const keys = resumeLayoutKeysFromData(data);
  if (keys.length === 0) return null;
  const entries = readAll();
  // An email match outranks a name match: two people can share a name.
  for (const key of keys) {
    const hit = entries.find((entry) => entry.keys.includes(key));
    if (hit) return hit.profile;
  }
  return null;
}
