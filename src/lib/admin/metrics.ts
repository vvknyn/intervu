/**
 * Server-only module (imports firebase-admin); never import from a client
 * component. Exposed to the UI only via a thin "use server" action wrapper
 * (`src/actions/admin-metrics.ts`) — the same shape `credit-gate.ts` uses.
 *
 * WHAT THIS IS. intervu already writes a lot of telemetry — searches, opens,
 * apply clicks, AI credit spend, saved intent, email lifecycle, daily corpus
 * snapshots — and until now had nowhere to read it back. PostHog is wired in
 * (`components/providers/PostHogProvider.tsx`) but no-ops without a key, and
 * `lib/analytics.ts` has no callers, so a hosted dashboard would show an empty
 * project. This reads the first-party data we already own instead: no new
 * vendor, no new key, no data leaving the project.
 *
 * SHAPE. One declarative `METRICS` list is the single source of truth, exactly
 * like `db/firestore-migration-manifest.ts`. The collector maps over it and the
 * UI renders whatever it gets back, so adding a metric is ONE entry here and
 * nothing else — never a new branch in the collector or a new tile in the view.
 *
 * COUNTING. Firestore's `count()` aggregation bills per index scan, not per
 * document, so ~25 counts cost a handful of reads. It also constrains the
 * queries: an equality filter plus a range filter on a DIFFERENT field needs a
 * composite index, which would fail closed until someone clicks a console link.
 * Every query here therefore uses either one range OR one equality, both of
 * which Firestore's automatic single-field indexes already cover. That is why
 * shares (`% zero-result`, `% widened`) are computed over the whole retained
 * window rather than sliced to 30 days.
 *
 * RETENTION. `search_events` / `search_opens` carry a 90-day `expiresAt`
 * (SEARCH_LOG_TTL_DAYS) enforced by a Firestore TTL policy, so their "total" is
 * a trailing-90-day total, not an all-time one. Each metric says so in `note`
 * rather than letting the number imply a history it does not have.
 *
 * FAILURE. A metric that cannot be read reports `value: null` + `error`. It
 * never reports 0 — "nobody signed up" and "Firestore is unreachable" must not
 * render as the same number.
 */
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { Firestore, Query } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { currentPeriod } from "@/lib/llm/credit-gate";
import { SEARCH_LOG_TTL_DAYS } from "@/lib/jobs/search-log";
import { FOLLOW_FUNNEL_STEPS, type FollowFunnelStep } from "@/lib/follows/funnel-log";
import {
    WINDOWS,
    isoAgo,
    sharePercent,
    summarizeUsers,
    type AuthCensus,
    type MetricMeta,
    type MetricValue,
    type MetricsReport,
} from "./metrics-shape";

/** Re-exported so a server caller has one import for the whole surface. */
export * from "./metrics-shape";

/** A registry entry: the metric's identity plus how to read its number. */
export interface MetricSpec extends MetricMeta {
    read(ctx: MetricContext): Promise<MetricValue>;
}

// --- collection context ----------------------------------------------------

export interface MetricContext {
    db: Firestore;
    auth: Auth;
    nowMs: number;
    /** Memoised: the People metrics all need the same user page-walk, and
     *  `listUsers` is the one genuinely expensive call on this page. */
    census(): Promise<{ census: AuthCensus; truncated: boolean }>;
}

/** Page size Firebase Auth allows per `listUsers` call. */
const AUTH_PAGE_SIZE = 1000;
/** Hard stop on the page walk. Bounds the work an admin page can do; when it
 *  bites, the People tiles say so instead of quietly under-reporting. */
const AUTH_MAX_PAGES = 10;

async function walkUsers(auth: Auth): Promise<{ users: UserRecord[]; truncated: boolean }> {
    const users: UserRecord[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < AUTH_MAX_PAGES; page += 1) {
        const result = await auth.listUsers(AUTH_PAGE_SIZE, pageToken);
        users.push(...result.users);
        pageToken = result.pageToken;
        if (!pageToken) return { users, truncated: false };
    }
    return { users, truncated: true };
}

// --- query helpers ---------------------------------------------------------

async function countOf(query: Query): Promise<number> {
    const snapshot = await query.count().get();
    return snapshot.data().count;
}

/** A top-level collection. */
interface CollectionRef {
    collection: string;
    group?: never;
}

/** Read with `collectionGroup` — `savedSearches`, `followedCompanies` and
 *  `resume_history` live under a parent document, so a plain collection read
 *  finds nothing. */
interface GroupRef {
    collection: string;
    group: true;
}

type SourceRef = CollectionRef | GroupRef;

function queryFor(ctx: MetricContext, source: SourceRef): Query {
    return source.group ? ctx.db.collectionGroup(source.collection) : ctx.db.collection(source.collection);
}

// --- spec factories --------------------------------------------------------

/**
 * Total rows, plus a per-window breakdown range-queried on `timeField`.
 * `timeField` holds an ISO-8601 UTC string, which sorts chronologically as
 * text — the same property `firestore-migration-manifest.ts` relies on.
 *
 * Takes a `CollectionRef`, NOT a `SourceRef`, and that is load-bearing:
 * Firestore's automatic single-field indexes do not extend to collection
 * groups, so a range query across one fails closed with FAILED_PRECONDITION
 * until someone adds a COLLECTION_GROUP_ASC exemption by hand in the console.
 * Counting a whole group needs no index, which is why `totalCount` still
 * accepts one. Making the signature reject a group ref means the next
 * subcollection metric cannot reintroduce that runtime failure.
 */
function timedCount(meta: MetricMeta, source: CollectionRef, timeField: string): MetricSpec {
    return {
        ...meta,
        async read(ctx) {
            const base = queryFor(ctx, source);
            const [total, ...counts] = await Promise.all([
                countOf(base),
                ...WINDOWS.map(({ days }) => countOf(base.where(timeField, ">=", isoAgo(ctx.nowMs, days)))),
            ]);
            return {
                value: total,
                windows: Object.fromEntries(WINDOWS.map(({ label }, i) => [label, counts[i]])),
            };
        },
    };
}

/** Total rows only — for sources that record no timestamp we can range-query. */
function totalCount(meta: MetricMeta, source: SourceRef): MetricSpec {
    return { ...meta, read: async (ctx) => ({ value: await countOf(queryFor(ctx, source)) }) };
}

/**
 * Total rows matching one equality filter, as a raw count — the filtered
 * sibling of `totalCount` (which cannot filter) and `timedCount` (whose
 * spec has no filter param either). Deliberately no window breakdown:
 * pairing this filter with a time range would need a composite index (two
 * fields on one query), and every query in this registry stays inside
 * Firestore's automatic single-field indexes on purpose (see the COUNTING
 * note at the top of this file). Takes a `CollectionRef`, not a
 * `SourceRef`, for the same reason `timedCount` does — a collectionGroup
 * filter isn't covered by an automatic index either.
 */
function filteredCount(meta: MetricMeta, source: CollectionRef, filter: readonly [string, unknown]): MetricSpec {
    const [field, value] = filter;
    return {
        ...meta,
        async read(ctx) {
            return { value: await countOf(queryFor(ctx, source).where(field, "==", value)) };
        },
    };
}

/** Share of a collection matching one equality filter, as a percent. */
function equalityShare(meta: MetricMeta, source: SourceRef, field: string, equals: unknown): MetricSpec {
    return {
        ...meta,
        async read(ctx) {
            const base = queryFor(ctx, source);
            const [whole, part] = await Promise.all([countOf(base), countOf(base.where(field, "==", equals))]);
            return { value: sharePercent(part, whole), unit: "percent" };
        },
    };
}

/** One number lifted out of the memoised Firebase Auth census. */
function authMetric(meta: MetricMeta, pick: (census: AuthCensus) => MetricValue): MetricSpec {
    return {
        ...meta,
        async read(ctx) {
            const { census, truncated } = await ctx.census();
            const value = pick(census);
            return truncated
                ? { ...value, caveat: `first ${AUTH_MAX_PAGES * AUTH_PAGE_SIZE} accounts only` }
                : value;
        },
    };
}

// --- the registry ----------------------------------------------------------

const RETAINED = `trailing ${SEARCH_LOG_TTL_DAYS} days (TTL)`;

/** Exhaustive over `FollowFunnelStep` — TypeScript rejects this object the
 *  moment `FOLLOW_FUNNEL_STEPS` grows a step with no label here, so a new
 *  step can't silently ship as an unlabeled tile. Every label is prefixed
 *  "Follow funnel:" so `unsubscribed`'s tile can never collide with the
 *  existing all-time "Unsubscribed" (Email group) tile — same event
 *  logically, but a different chokepoint (this is per-funnel-step, that one
 *  reads `email_suppressions`) and metric labels must stay unique. */
const FUNNEL_STEP_LABEL: Record<FollowFunnelStep, string> = {
    follow_click: "Follow funnel: follow clicked",
    cta_click: "Follow funnel: “email me” clicked",
    email_submitted: "Follow funnel: email submitted",
    email_verified: "Follow funnel: email verified",
    unsubscribed: "Follow funnel: unsubscribed",
};

export const METRICS: readonly MetricSpec[] = [
    // --- People -----------------------------------------------------------
    // Firebase Auth, NOT the `profiles` collection, is the account of record.
    // Someone who signs up with an email and password and never opens their
    // profile has no Firestore document at all, so counting `profiles` would
    // silently drop them. Reading Auth counts every sign-up route there is.
    authMetric(
        { id: "accounts", label: "Accounts", group: "People", note: "Every Firebase Auth account, however they signed up. Windows are new sign-ups." },
        (c) => ({ value: c.total, windows: c.created }),
    ),
    authMetric(
        { id: "returning", label: "Signed in recently", group: "People", note: "Accounts whose LAST sign-in falls in the window — the closest thing we collect to DAU / WAU / MAU." },
        (c) => ({ value: c.active["30d"] ?? null, windows: c.active }),
    ),
    authMetric(
        { id: "accounts_password", label: "Email + password", group: "People", note: "Accounts with no federated provider — signed up with an email address alone. These have no Firestore profile until they use the product." },
        (c) => ({ value: c.total - c.federated }),
    ),
    authMetric(
        { id: "accounts_federated", label: "Via Google", group: "People", note: "Accounts holding at least one federated provider. Matched on \"not a password login\", so a newly enabled provider counts here without a code change." },
        (c) => ({ value: c.federated }),
    ),

    // --- Waitlist ---------------------------------------------------------
    // Email addresses with NO account behind them. They never appear in Auth,
    // so without these two the funnel's whole top is invisible.
    timedCount(
        { id: "waitlist", label: "Credit-pack waitlist", group: "Waitlist", note: "Rows are email x pack, so one person wanting two packs counts twice. Nobody here has an account." },
        { collection: "waitlist" },
        "ts",
    ),
    timedCount(
        { id: "connect_waitlist", label: "Agent-connect waitlist", group: "Waitlist", note: "One row per address (the email IS the document id), captured on /connect. Nobody here has an account." },
        { collection: "connect_waitlist" },
        "created_at",
    ),

    // --- Search -----------------------------------------------------------
    // The demand signal. Anonymous by construction: `searchId` is random per
    // search, so none of this chains back to a person.
    timedCount(
        { id: "searches", label: "Searches", group: "Search", note: `Searches a human ran — the app's dead-link existence probe is excluded. Total is ${RETAINED}.` },
        { collection: "search_events" },
        "createdAt",
    ),
    timedCount(
        { id: "opens", label: "Results opened", group: "Search", note: `A result opened from a search. Read against searches, this is the click-through rate. Total is ${RETAINED}.` },
        { collection: "search_opens" },
        "createdAt",
    ),
    equalityShare(
        { id: "search_zero", label: "Zero-result searches", group: "Search", note: `Share of searches returning nothing — the corpus-gap signal. Over the ${RETAINED}.` },
        { collection: "search_events" },
        "resultCount",
        0,
    ),
    equalityShare(
        { id: "search_failed", label: "Failed searches", group: "Search", note: `Share where the backend was unavailable, as distinct from genuinely empty. Over the ${RETAINED}.` },
        { collection: "search_events" },
        "unavailable",
        true,
    ),
    equalityShare(
        { id: "search_widened", label: "Widened searches", group: "Search", note: `Share where the title/company pass was thin and the search relaxed. Over the ${RETAINED}.` },
        { collection: "search_events" },
        "widened",
        true,
    ),
    equalityShare(
        { id: "search_filtered", label: "Used a filter", group: "Search", note: `Share where someone reached for an explicit facet, salary floor or visa filter. First-screen defaults do not count. Over the ${RETAINED}.` },
        { collection: "search_events" },
        "filtersApplied",
        true,
    ),

    // --- Product use ------------------------------------------------------
    timedCount(
        { id: "job_analyses", label: "Job analyses", group: "Product use", note: "Postings run through the integrity scan." },
        { collection: "job_analyses" },
        "created_at",
    ),
    timedCount(
        { id: "tailored_resumes", label: "Tailored resumes", group: "Product use", note: "Resumes tailored against a specific posting." },
        { collection: "tailored_resumes" },
        "created_at",
    ),
    timedCount(
        { id: "applications", label: "Pursuits tracked", group: "Product use", note: "Applications people are tracking in /yours, at any stage." },
        { collection: "applications" },
        "created_at",
    ),
    totalCount(
        { id: "resume_versions", label: "Resume versions saved", group: "Product use", note: "Every version in every account's resume history, including the baseline written on first upload. All time — a windowed version would need a hand-created collection-group index." },
        { collection: "resume_history", group: true },
    ),
    timedCount(
        { id: "stories", label: "STAR stories saved", group: "Product use", note: "Interview stories saved to the story bank." },
        { collection: "stories" },
        "created_at",
    ),
    totalCount(
        { id: "apply_days", label: "Apply-active user-days (to 2026-08-18)", group: "Product use", note: "One row per person per UTC day they marked something applied — not a click count. FROZEN: the counter existed only to enforce the free-plan daily apply cap, which was removed 2026-08-18, so nothing writes `apply_counters` anymore. This is the historical total, not a live figure." },
        { collection: "apply_counters" },
    ),
    totalCount(
        { id: "favorite_questions", label: "Questions favourited", group: "Product use", note: "All time, across every account." },
        { collection: "favorite_questions" },
    ),
    totalCount(
        { id: "interview_questions", label: "Interview questions logged", group: "Product use", note: "All time, across every account." },
        { collection: "interview_questions" },
    ),

    // --- Saved intent -----------------------------------------------------
    // The strongest retention signal we collect: someone asking to be told
    // about something later. Both live under `users/<uid>/`, so they are read
    // as collection groups.
    totalCount(
        { id: "saved_searches", label: "Saved searches", group: "Saved intent", note: "Across every account." },
        { collection: "savedSearches", group: true },
    ),
    totalCount(
        { id: "followed_companies", label: "Followed companies", group: "Saved intent", note: "Across every account." },
        { collection: "followedCompanies", group: true },
    ),

    // --- Credits ----------------------------------------------------------
    {
        id: "ai_users",
        label: "Spent AI credits this month",
        group: "Credits",
        note: "Accounts charged at least one shared-key credit in the current UTC month. Admins and legacy BYOK users are never charged, so they never appear here.",
        async read(ctx) {
            return {
                value: await countOf(ctx.db.collection("profiles").where("credits_period", "==", currentPeriod())),
            };
        },
    },
    timedCount(
        { id: "credit_grants", label: "Credit grants", group: "Credits", note: "Additive grants to permanent balances — the welcome bonus and anything else awarded. Idempotent, so one row is one real grant." },
        { collection: "credit_grants" },
        "granted_at",
    ),

    // --- Email ------------------------------------------------------------
    totalCount(
        { id: "welcome_emails", label: "Welcome emails sent", group: "Email", note: "One claim row per address; the claim is what stops a second send." },
        { collection: "welcome_emails" },
    ),
    totalCount(
        { id: "digest_state", label: "Digest recipients", group: "Email", note: "Accounts with a digest cursor — i.e. that have been sent at least one digest." },
        { collection: "email_digest_state" },
    ),
    totalCount(
        { id: "suppressions", label: "Unsubscribed", group: "Email", note: "Addresses suppressed via the unsubscribe link or a Resend bounce. Read this against welcome emails sent." },
        { collection: "email_suppressions" },
    ),

    // --- Follow funnel ------------------------------------------------------
    // The verified-email-follow ladder (docs/specs/2026-08-19-verified-email-
    // follow-design.md), from the first click to unsubscribing. One counter
    // per step in `FOLLOW_FUNNEL_STEPS` (funnel-log.ts) — that array, not a
    // list re-typed here, is what makes a new step a compile error in
    // `FUNNEL_STEP_LABEL` below rather than a metric nobody remembered to add.
    ...FOLLOW_FUNNEL_STEPS.map((step) =>
        filteredCount(
            { id: `follow_funnel_${step}`, label: FUNNEL_STEP_LABEL[step], group: "Follow funnel", note: "Counted since events started recording — no TTL on this collection." },
            { collection: "follow_funnel_events" },
            ["step", step],
        ),
    ),

    // --- Inbound ----------------------------------------------------------
    timedCount(
        { id: "contact_messages", label: "Contact messages", group: "Inbound", note: "Submissions through /contact." },
        { collection: "contact_messages" },
        "ts",
    ),
    timedCount(
        { id: "feedback", label: "Feedback + bug reports", group: "Inbound", note: "In-app feedback. The full text is listed further down this page." },
        { collection: "feedback" },
        "created_at",
    ),

    // --- Agents -----------------------------------------------------------
    totalCount(
        { id: "agent_clients", label: "Paired agent clients", group: "Agents", note: "MCP clients registered against an account." },
        { collection: "agent_clients" },
    ),
    {
        id: "viewer_sessions",
        label: "Live viewer sessions",
        group: "Agents",
        note: "OpenClaw viewer sessions that have not expired yet — a right-now number, not a total.",
        async read(ctx) {
            return {
                value: await countOf(ctx.db.collection("viewer_sessions").where("expiresAt", ">", ctx.nowMs)),
            };
        },
    },

    // --- Corpus -----------------------------------------------------------
    {
        id: "live_roles",
        label: "Live roles",
        group: "Corpus",
        note: "Active postings in the most recent daily snapshot /trends wrote. Reads the snapshot rather than Meili, so it adds no search cost.",
        async read(ctx) {
            const snap = await ctx.db.collection("market_stats_daily").orderBy("date", "desc").limit(1).get();
            const latest = snap.docs[0];
            if (!latest) return { value: null, error: "no daily snapshot written yet" };
            const active = latest.get("active");
            if (typeof active !== "number") return { value: null, error: `snapshot ${latest.id} has no active count` };
            return { value: active, caveat: `snapshot ${latest.id}` };
        },
    },
];

// --- collector -------------------------------------------------------------

/** A spec minus its reader — the identity half that ships to the client. */
function metaOf({ id, label, group, note }: MetricSpec): MetricMeta {
    return { id, label, group, note };
}

/**
 * Read every metric. Each is isolated: one broken source degrades one tile to
 * an error rather than blanking the page, which is the whole point of running
 * them through `Promise.allSettled` instead of `Promise.all`.
 */
export async function collectMetrics(nowMs: number = Date.now()): Promise<MetricsReport> {
    const auth = getAdminAuth();
    let censusOnce: Promise<{ census: AuthCensus; truncated: boolean }> | null = null;
    const ctx: MetricContext = {
        db: getAdminDb(),
        auth,
        nowMs,
        census() {
            censusOnce ??= walkUsers(auth).then(({ users, truncated }) => ({
                census: summarizeUsers(users, nowMs),
                truncated,
            }));
            return censusOnce;
        },
    };

    const settled = await Promise.allSettled(METRICS.map((spec) => spec.read(ctx)));
    const metrics = METRICS.map((spec, i) => {
        const meta = metaOf(spec);
        const outcome = settled[i];
        if (outcome.status === "fulfilled") return { ...meta, ...outcome.value };
        const reason = outcome.reason;
        return {
            ...meta,
            value: null,
            error: reason instanceof Error ? reason.message : String(reason),
        };
    });

    return { metrics, collectedAt: new Date(nowMs).toISOString() };
}
