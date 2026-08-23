/**
 * Decision logic + injectable I/O for provisioning existing Firebase Auth
 * users into Supabase Auth — the one-shot migration this module backs is
 * `scripts/provision-supabase-users.ts`.
 *
 * Fully generic over the product slug (`app: string`), exactly like
 * app-tag.ts and ensure-app-membership.ts: nothing here knows "intervu"
 * exists. The script hardcodes `APP_INTERVU` at its one call site; this
 * module never does.
 *
 * `planUserProvisioning` is a pure decision (no client, no I/O) so the four
 * possible outcomes — CREATE, SKIP, APPEND_APP, CONFLICT — are directly
 * unit-testable. Everything below it (`listAllFirebaseUsers`,
 * `listAllSupabaseUsers`, `applyPlanEntry`, `runProvisioning`) is I/O behind
 * a narrow injectable interface, the same seam pattern user-directory.ts and
 * ensure-app-membership.ts use.
 *
 * `runProvisioning` deliberately reads the ENTIRE `auth.users` table
 * unfiltered by app (`listAllSupabaseUsers`), not via user-directory.ts's
 * `listAppUsers`. That module's doc calls itself "the ONLY place that
 * enumerates Supabase auth users" specifically to stop a product-scoped
 * surface from ever seeing another product's accounts. This tool is not a
 * product-scoped surface — cross-product visibility is the entire point,
 * because a Firebase user's email may already exist here under the *other*
 * product, and detecting that is what the CONFLICT/APPEND_APP cases below
 * are for. Reusing the app-filtered helper would make that detection
 * impossible.
 */
import { hasApp } from "@/lib/auth/app-tag";
import { computeAppMembershipUpdate } from "@/lib/auth/ensure-app-membership";
import type { User as SupabaseUser } from "@supabase/supabase-js";

/** Firebase's provider id string for Google Sign-In — the one hardcoded
 *  string this module has, since it names a fixed Firebase concept, not a
 *  product. */
export const GOOGLE_PROVIDER_ID = "google.com";

/** One Firebase Auth user, reduced to what provisioning needs. */
export interface FirebaseSourceUser {
    uid: string;
    email: string;
    /** Every linked provider id, e.g. `["google.com"]` or `["password"]`. */
    providers: string[];
}

/** Default scope is Google SSO only; `includePasswordUsers` widens it to
 *  every other provider. Matched on the provider id itself, never on email
 *  domain or a hardcoded list of accounts. */
export function isInScope(providers: string[], includePasswordUsers: boolean): boolean {
    if (providers.includes(GOOGLE_PROVIDER_ID)) return true;
    return includePasswordUsers;
}

/** The Supabase side of a matched-by-email pair, reduced to what the
 *  decision needs. */
export interface ExistingSupabaseUser {
    id: string;
    email: string;
    app_metadata: unknown;
    emailConfirmed: boolean;
}

export type ProvisionPlanEntry =
    | { action: "CREATE"; firebaseUid: string; email: string; reason: string; appMetadata: Record<string, unknown> }
    | { action: "SKIP_ALREADY_PROVISIONED"; firebaseUid: string; email: string; reason: string; supabaseUserId: string }
    | { action: "CONFLICT_UNCONFIRMED_EMAIL"; firebaseUid: string; email: string; reason: string; supabaseUserId: string }
    | {
          action: "APPEND_APP";
          firebaseUid: string;
          email: string;
          reason: string;
          appMetadata: Record<string, unknown>;
          supabaseUserId: string;
      };

/**
 * Pure decision: given one Firebase user and the Supabase row (if any)
 * matched to it by email, what should happen? No client, no I/O — every
 * branch is independently testable.
 */
export function planUserProvisioning(
    fbUser: FirebaseSourceUser,
    existing: ExistingSupabaseUser | null,
    app: string,
): ProvisionPlanEntry {
    const { uid: firebaseUid, email } = fbUser;

    if (!existing) {
        return {
            action: "CREATE",
            firebaseUid,
            email,
            reason: `no Supabase account exists for ${email} — will create one tagged "${app}"`,
            appMetadata: { apps: [app], firebase_uid: firebaseUid },
        };
    }

    if (hasApp(existing.app_metadata, app)) {
        return {
            action: "SKIP_ALREADY_PROVISIONED",
            firebaseUid,
            email,
            reason: `already tagged "${app}" — nothing to do`,
            supabaseUserId: existing.id,
        };
    }

    if (!existing.emailConfirmed) {
        return {
            action: "CONFLICT_UNCONFIRMED_EMAIL",
            firebaseUid,
            email,
            reason:
                `a Supabase account for ${email} already exists for another product with an UNCONFIRMED ` +
                `email — confirming it is a security-relevant decision this script will not make on its own; ` +
                `a human must resolve this manually`,
            supabaseUserId: existing.id,
        };
    }

    const { appMetadata } = computeAppMembershipUpdate(existing.app_metadata, app);
    return {
        action: "APPEND_APP",
        firebaseUid,
        email,
        reason: `already exists for another product with a confirmed email — appending "${app}" to its apps array`,
        appMetadata,
        supabaseUserId: existing.id,
    };
}

export interface ProvisionPlanResult {
    entries: ProvisionPlanEntry[];
    /** Firebase users excluded by scope (password-only, without
     *  `--include-password-users`) — counted, not silently dropped. */
    outOfScopeCount: number;
}

/** Joins the two already-fetched user lists in memory (by lowercased
 *  email) and applies `planUserProvisioning` to every in-scope Firebase
 *  user. No I/O — takes plain arrays/maps, not clients. */
export function buildProvisionPlan(
    firebaseUsers: FirebaseSourceUser[],
    existingByEmail: Map<string, ExistingSupabaseUser>,
    app: string,
    includePasswordUsers: boolean,
): ProvisionPlanResult {
    const entries: ProvisionPlanEntry[] = [];
    let outOfScopeCount = 0;

    for (const fbUser of firebaseUsers) {
        if (!isInScope(fbUser.providers, includePasswordUsers)) {
            outOfScopeCount++;
            continue;
        }
        const existing = existingByEmail.get(fbUser.email.toLowerCase()) ?? null;
        entries.push(planUserProvisioning(fbUser, existing, app));
    }

    return { entries, outOfScopeCount };
}

// ---------------------------------------------------------------------------
// I/O — narrow, injectable client interfaces + the functions that use them.
// ---------------------------------------------------------------------------

/** The slice of Firebase Admin `Auth` this module needs. A real
 *  `getAuth(app)` handle satisfies this structurally. */
export interface FirebaseListUsersClient {
    listUsers(
        maxResults?: number,
        pageToken?: string,
    ): Promise<{
        users: { uid: string; email?: string; providerData: { providerId: string }[] }[];
        pageToken?: string;
    }>;
}

/** Firebase Admin's own page size ceiling for `listUsers`. */
const FIREBASE_PAGE_SIZE = 1000;

/** Walks every page of Firebase Auth users. Users without an email (no
 *  password/Google accounts exist without one in this app, but phone-auth
 *  accounts have no email in general) are skipped — there is nothing to
 *  match or create a Supabase account against. */
export async function listAllFirebaseUsers(client: FirebaseListUsersClient): Promise<FirebaseSourceUser[]> {
    const out: FirebaseSourceUser[] = [];
    let pageToken: string | undefined;
    for (;;) {
        const { users, pageToken: next } = await client.listUsers(FIREBASE_PAGE_SIZE, pageToken);
        for (const u of users) {
            if (!u.email) continue;
            out.push({ uid: u.uid, email: u.email, providers: u.providerData.map((p) => p.providerId) });
        }
        if (!next || users.length === 0) return out;
        pageToken = next;
    }
}

/** The slice of the Supabase admin API this module needs. Same seam pattern
 *  as `DirectoryAdminClient` (user-directory.ts) and `AdminAuthClient`
 *  (ensure-app-membership.ts) — a real service-role `SupabaseClient`
 *  satisfies this structurally. */
export interface SupabaseAdminClient {
    auth: {
        admin: {
            listUsers(params: { page: number; perPage: number }): Promise<{
                data: { users: SupabaseUser[]; nextPage?: number | null };
                error: { message: string } | null;
            }>;
            getUserById(id: string): Promise<{
                data: { user: SupabaseUser | null };
                error: { message: string } | null;
            }>;
            createUser(attrs: {
                email: string;
                email_confirm: boolean;
                app_metadata: Record<string, unknown>;
            }): Promise<{ data: { user: SupabaseUser | null }; error: { message: string } | null }>;
            updateUserById(
                id: string,
                attrs: { app_metadata: Record<string, unknown> },
            ): Promise<{ data: { user: SupabaseUser | null }; error: { message: string } | null }>;
        };
    };
}

/** Page size for the unfiltered `auth.users` walk below — deliberately not
 *  imported from user-directory.ts, which keeps its own `PAGE_SIZE` private;
 *  this walk is intentionally a separate, unfiltered mechanism (see module
 *  doc), not a caller of that module's exports. */
const SUPABASE_PAGE_SIZE = 1000;

/** Walks the ENTIRE `auth.users` table — every product, not just intervu's.
 *  See the module doc for why this can't be `listAppUsers`. */
export async function listAllSupabaseUsers(client: SupabaseAdminClient): Promise<ExistingSupabaseUser[]> {
    const out: ExistingSupabaseUser[] = [];
    let page = 1;
    for (;;) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: SUPABASE_PAGE_SIZE });
        if (error) {
            throw new Error(`listAllSupabaseUsers: failed to list users (page ${page}): ${error.message}`);
        }
        for (const user of data.users) {
            if (!user.email) continue;
            out.push({
                id: user.id,
                email: user.email,
                app_metadata: user.app_metadata,
                emailConfirmed: Boolean(user.email_confirmed_at),
            });
        }
        if (!data.nextPage || data.users.length === 0) return out;
        page = data.nextPage;
    }
}

export type WriteOutcome =
    | { status: "created"; supabaseUserId: string }
    | { status: "appended"; supabaseUserId: string }
    | { status: "failed"; error: string };

type WritableEntry = Extract<ProvisionPlanEntry, { action: "CREATE" | "APPEND_APP" }>;

/** Reads the just-written user back and asserts the write actually landed:
 *  `app_metadata.apps` contains `app`, and — for a freshly CREATEd row only
 *  — `firebase_uid` matches the Firebase source. A CREATE row is the only
 *  case where this script itself decides `firebase_uid`; an APPEND_APP row
 *  belongs to another product and its `firebase_uid` (if any) is preserved
 *  untouched by design (see the module doc on planUserProvisioning), so
 *  there is nothing of this script's to verify there beyond the tag itself.
 */
async function verifyWrite(
    client: SupabaseAdminClient,
    userId: string,
    entry: WritableEntry,
    app: string,
): Promise<WriteOutcome> {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error || !data.user) {
        return { status: "failed", error: `verify read-back failed: ${error?.message ?? "user not found"}` };
    }
    if (!hasApp(data.user.app_metadata, app)) {
        return { status: "failed", error: `verify failed: app_metadata.apps missing "${app}" after write` };
    }
    if (entry.action === "CREATE") {
        const readBack = data.user.app_metadata;
        const readBackUid =
            readBack && typeof readBack === "object" && !Array.isArray(readBack)
                ? (readBack as Record<string, unknown>).firebase_uid
                : undefined;
        if (readBackUid !== entry.firebaseUid) {
            return {
                status: "failed",
                error: `verify failed: firebase_uid mismatch (expected ${entry.firebaseUid}, got ${String(readBackUid)})`,
            };
        }
    }
    return { status: entry.action === "CREATE" ? "created" : "appended", supabaseUserId: userId };
}

/** Performs the one write a CREATE or APPEND_APP plan entry calls for, then
 *  verifies it. Never called for SKIP/CONFLICT entries — callers only reach
 *  this for the two actions that write. Never passes a `password` — a
 *  created account is always left password-less; see the script header. */
export async function applyPlanEntry(
    client: SupabaseAdminClient,
    entry: WritableEntry,
    app: string,
): Promise<WriteOutcome> {
    if (entry.action === "CREATE") {
        const { data, error } = await client.auth.admin.createUser({
            email: entry.email,
            email_confirm: true,
            app_metadata: entry.appMetadata,
        });
        if (error || !data.user) {
            return { status: "failed", error: error?.message ?? "createUser returned no user" };
        }
        return verifyWrite(client, data.user.id, entry, app);
    }

    const { error } = await client.auth.admin.updateUserById(entry.supabaseUserId, {
        app_metadata: entry.appMetadata,
    });
    if (error) {
        return { status: "failed", error: error.message };
    }
    return verifyWrite(client, entry.supabaseUserId, entry, app);
}

export interface RunProvisioningOptions {
    app: string;
    includePasswordUsers: boolean;
    /** false (the default everywhere this is called without the flag)
     *  performs zero writes: CREATE/APPEND_APP entries are still planned and
     *  returned, just never handed to `applyPlanEntry`. */
    apply: boolean;
}

export interface PlanResultRow {
    entry: ProvisionPlanEntry;
    /** null in dry-run mode, and always null for SKIP/CONFLICT entries —
     *  only set when a write was actually attempted. */
    outcome: WriteOutcome | null;
}

export interface RunProvisioningResult {
    rows: PlanResultRow[];
    outOfScopeCount: number;
    /** Every count below reflects WRITES ACTUALLY PERFORMED (apply mode
     *  only) — never a "would have" count. The planned-vs-performed
     *  distinction matters: a caller wanting "how many would be created" in
     *  dry-run mode counts `rows` by `entry.action` instead. */
    created: number;
    appended: number;
    skipped: number;
    conflicts: number;
    failed: number;
}

/**
 * The single entry point both the dry-run and `--apply` code paths share:
 * fetch both user sets, build the plan, and — only when `options.apply` is
 * true — perform and verify each write. Fully generic over `options.app`.
 */
export async function runProvisioning(
    firebaseClient: FirebaseListUsersClient,
    supabaseClient: SupabaseAdminClient,
    options: RunProvisioningOptions,
): Promise<RunProvisioningResult> {
    const firebaseUsers = await listAllFirebaseUsers(firebaseClient);
    const supabaseUsers = await listAllSupabaseUsers(supabaseClient);
    const existingByEmail = new Map(supabaseUsers.map((u) => [u.email.toLowerCase(), u]));

    const { entries, outOfScopeCount } = buildProvisionPlan(
        firebaseUsers,
        existingByEmail,
        options.app,
        options.includePasswordUsers,
    );

    const rows: PlanResultRow[] = [];
    let created = 0;
    let appended = 0;
    let skipped = 0;
    let conflicts = 0;
    let failed = 0;

    for (const entry of entries) {
        if (entry.action === "SKIP_ALREADY_PROVISIONED") {
            skipped++;
            rows.push({ entry, outcome: null });
            continue;
        }
        if (entry.action === "CONFLICT_UNCONFIRMED_EMAIL") {
            conflicts++;
            rows.push({ entry, outcome: null });
            continue;
        }
        if (!options.apply) {
            rows.push({ entry, outcome: null });
            continue;
        }
        const outcome = await applyPlanEntry(supabaseClient, entry, options.app);
        if (outcome.status === "created") created++;
        else if (outcome.status === "appended") appended++;
        else failed++;
        rows.push({ entry, outcome });
    }

    return { rows, outOfScopeCount, created, appended, skipped, conflicts, failed };
}
