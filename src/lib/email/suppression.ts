/**
 * `email_suppressions` — one doc per normalized email (the doc id IS the
 * normalized address, same idempotent-upsert shape `connect_waitlist`
 * already uses), holding a map of scope → suppression event:
 *
 *   email_suppressions/{normalizedEmail}: {
 *     email: string,
 *     entries: { [scope: EmailKind | "all"]: { reason, at } }
 *   }
 *
 * A map keyed by scope (rather than one flat {reason,kind,at} record per
 * doc) is deliberate: a single flat record can only remember ONE current
 * suppression state, so a later kind-scoped event would silently overwrite
 * — and un-suppress — an earlier one for a different kind. The map can't
 * regress: unsuppressing one scope never touches another, and this is also
 * E5's source of truth (a "digest off" toggle IS `entries.digest` existing).
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { normalizeEmail } from "./normalize-email";
import type { EmailKind } from "./types";
import type { UnsubscribeScope } from "./unsubscribe-token";

export type SuppressionReason = "unsubscribed" | "bounced" | "complained";

export interface SuppressionEntry {
  reason: SuppressionReason;
  at: string;
}

export type SuppressionEntries = Partial<Record<UnsubscribeScope, SuppressionEntry>>;

const COLLECTION = "email_suppressions";

/**
 * Pure decision: is `kind` blocked given this email's current entries?
 * Blocked by an exact-kind entry OR by an "all" entry — either is
 * sufficient, and this is the one place that OR lives (send.ts and the
 * preferences UI both call this rather than re-deriving it).
 */
export function isSuppressedForKind(entries: SuppressionEntries | undefined, kind: EmailKind): boolean {
  if (!entries) return false;
  return Boolean(entries.all || entries[kind]);
}

export async function isSuppressed(email: string, kind: EmailKind): Promise<boolean> {
  const snap = await getAdminDb().collection(COLLECTION).doc(normalizeEmail(email)).get();
  return isSuppressedForKind(snap.data()?.entries as SuppressionEntries | undefined, kind);
}

/** Fetches the raw entries map — used by the preferences UI (E5) to render
 *  current per-kind state, and by the unsubscribe page to show what a
 *  token's undo would restore. */
export async function getSuppressionEntries(email: string): Promise<SuppressionEntries> {
  const snap = await getAdminDb().collection(COLLECTION).doc(normalizeEmail(email)).get();
  return (snap.data()?.entries as SuppressionEntries | undefined) ?? {};
}

export async function suppress(email: string, scope: UnsubscribeScope, reason: SuppressionReason): Promise<void> {
  const id = normalizeEmail(email);
  await getAdminDb()
    .collection(COLLECTION)
    .doc(id)
    .set(
      { email: id, entries: { [scope]: { reason, at: new Date().toISOString() } } },
      { merge: true },
    );
}

/** One-click undo (the unsubscribe page's "wasn't me" link). Idempotent —
 *  undoing a scope on a doc that doesn't exist yet is a no-op, not an
 *  error: `update()` on a missing doc throws, so this checks existence
 *  first rather than letting a repeat click (or a stale link) surface a
 *  failure the user can't do anything about. `FieldValue.delete()` removes
 *  just that one map key, leaving any other suppressed scope untouched. */
export async function unsuppress(email: string, scope: UnsubscribeScope): Promise<void> {
  const id = normalizeEmail(email);
  const ref = getAdminDb().collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;

  await ref.update({ [`entries.${scope}`]: FieldValue.delete() });
}
