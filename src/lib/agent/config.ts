import { NextResponse } from "next/server";

/**
 * Shared config for the intervu agent/MCP feature.
 *
 * Single source of truth for Firestore collection names and the numeric
 * limits every later task (credentials, OAuth, rate limiter, tools) reads
 * from — do not duplicate these values elsewhere.
 */
export const AGENT = {
    /**
     * The origin this OAuth authorization server and MCP resource identify as.
     * Everything a connector touches — the two `.well-known` documents, the
     * consent screen, the token endpoint, `/api/mcp`, the OpenClaw installer —
     * must be reachable HERE, directly, with no cross-origin hop.
     *
     * REVERSES the earlier pin to intervu.cc (Vivek, 2026-08-24: "change the
     * base url for these connectors and ensure that they work"). That pin
     * existed to keep already-registered connectors working across the SEO
     * domain move, but by the time it was tested the domain move had half
     * happened underneath it: `/api/*` and `/.well-known/*` were carved out of
     * the intervu.cc → intervuhq.com redirect and still served, while the
     * `authorization_endpoint` this very document advertises
     * (`intervu.cc/oauth/authorize`) and the installer (`intervu.cc/install`)
     * answered 301 to the other origin. An authorization server advertising an
     * endpoint on a domain that redirects away is not a stable identity; it is
     * a half-move that only looks stable because browsers follow redirects.
     *
     * What the pin was protecting turned out not to exist: the 76 registered
     * clients and 213 credentials belong to ~4 uids and are almost all named
     * `mcporter (intervu-cc-mcp)` — re-auth testing, not installs. Moving now,
     * before the connector is handed to real people, costs those test
     * registrations a re-auth; moving later would cost real users theirs.
     *
     * Still reads its OWN `AGENT_ISSUER_URL`, never `NEXT_PUBLIC_SITE_URL` (the
     * SEO canonical), so the two can be pointed apart again without either one
     * silently dragging the other along.
     *
     * 2026-08-29 — Vivek: "on the website, change them to velai.app; keep old
     * links active for backward compatibility." Both legacy domains
     * (intervu.cc AND intervuhq.com) now serve the agent paths directly via
     * the shared `agent_carveout` Caddy snippet (deploy/Caddyfile), so a
     * client that registered against either old origin keeps a live,
     * direct connection instead of hitting a redirect. That works because
     * access tokens are opaque Firestore-backed secrets, not issuer-bound
     * JWTs (extractBearerToken, src/app/api/mcp/route.ts) — flipping this
     * default does not invalidate anything already issued.
     */
    issuer(): string {
        return process.env.AGENT_ISSUER_URL ?? "https://velai.app";
    },
    collections: {
        clients: "agent_clients",
        codes: "agent_codes",
        credentials: "agent_credentials",
        /** One doc per credential — see record-budget.ts. */
        recordBudgets: "agent_record_budgets",
    },
    /**
     * Per-credential hourly call budget — the "pipe" a legitimate agent
     * session should never feel. Bumped 60 → 300 (2026-08-06) after a real
     * claude.ai session got rate_limited after only ~8 tool calls, and a
     * brand-new credential's very first call was also rejected: MCP protocol
     * overhead (handshake, tools/list, SSE stream reconnects) shares this
     * same per-credential budget with visible tool calls, invisibly, so 60
     * was too tight for anything but a trivial session. The real anti-
     * harvesting boundary is `DAILY_RECORD_BUDGET` below, which does not move.
     */
    RATE_LIMIT: 300,
    /**
     * The two public, unauthenticated OAuth endpoints (`/api/oauth/register`,
     * `/api/oauth/token`) key their rate limit by caller IP, not credential —
     * and hosted connectors (claude.ai, ChatGPT custom connectors) proxy
     * every one of THEIR users' calls through a shared pool of provider
     * egress IPs. Budgeting those two routes at the same 300/hr as a single
     * MCP credential would let one intervu user on a hosted connector burn
     * the whole shared IP's budget and 429 every other intervu user behind
     * the same egress IP. Wider on purpose — these routes only mint/refresh
     * tokens, they never touch job data or a user's account.
     */
    PUBLIC_RATE_LIMIT: 600,
    RATE_WINDOW_MS: 3_600_000,
    RESULT_CAP: 20,
    /**
     * search_jobs' cursor pagination depth ceiling (Task 12) — how far into a
     * single query an agent may page in total (5 pages × RESULT_CAP), never
     * how many results a single page returns. Corpus-protection ceiling, same
     * spirit as RESULT_CAP: an agent gets a real "browse" window, not a
     * license to walk the whole index one page at a time.
     */
    SEARCH_DEPTH_CAP: 100,
    /**
     * How long a tool's search waits for its rows' description places
     * (`site-search.ts`). The site waits 250 ms and its browser reads the
     * rows that missed it; an agent has no second read, so it waits longer.
     */
    PLACE_READ_DEADLINE_MS: 2_000,
    /**
     * Per-credential DAILY budget on job RECORDS returned across every
     * corpus-reading tool (search_jobs, get_job — see record-budget.ts) —
     * orthogonal to RATE_LIMIT, which bounds CALLS per hour, not records
     * per day. RATE_LIMIT alone permits 300 calls/hr x RESULT_CAP(20)/call =
     * ~144,000 records/day/credential, sustained indefinitely — far beyond
     * any real job search and a viable slow-exfiltration path against a
     * multi-million-row corpus that is the product's core commercial asset.
     * A genuine digest reads on the order of 20-100 records/day; a heavy
     * manual user maybe a few hundred. 1,000/day is generous for any real
     * usage pattern and still ~144x below today's effective per-credential
     * ceiling.
     */
    DAILY_RECORD_BUDGET: 1_000,
    /**
     * Rolling-window length for DAILY_RECORD_BUDGET: 24h from the first
     * record consumed in the current window, not a UTC-calendar-day reset.
     * Simpler to reason about (one stored timestamp, no timezone math) and
     * closes the "burst at 23:59, burst again at 00:01" double-budget
     * loophole a calendar-day reset would open.
     */
    RECORD_BUDGET_WINDOW_MS: 86_400_000,
    CODE_TTL_MS: 300_000,
    ACCESS_TTL_MS: 3_600_000,
    /** DCR (`/api/oauth/register`) request body caps — this endpoint is
     *  public/unauthenticated, so its attacker-controlled fields need a
     *  ceiling before they ever reach storage. */
    MAX_REDIRECT_URIS: 10,
    MAX_REDIRECT_URI_LENGTH: 2048,
    MAX_CLIENT_NAME_LENGTH: 256,
    /** Manual-token "label" cap (Settings → Connected agents' create-token
     *  input) — the label IS `clientName` (see `trimAndCapLabel`'s doc
     *  comment), but this is a short user-typed display name ("Laptop Claude
     *  Code"), not an OAuth client's self-declared name, so it gets its own,
     *  much tighter cap rather than sharing MAX_CLIENT_NAME_LENGTH. */
    MAX_TOKEN_LABEL_LENGTH: 40,
    /** `save_resume_variant`'s `resume_text` cap (tools.ts) — DoS/cost-
     *  amplification guard: this field is agent-supplied free text written
     *  straight into a Firestore document, so it needs a hard ceiling before
     *  it ever reaches storage, same spirit as the DCR caps above. */
    RESUME_TEXT_MAX_CHARS: 50_000,
    /** `set_preferences`'s per-field string cap (route.ts) — same DoS/cost-
     *  amplification guard as `RESUME_TEXT_MAX_CHARS` above, sized for a
     *  single preference/answer field rather than a whole resume. */
    PREFERENCES_STRING_MAX_CHARS: 500,
    /** `set_preferences`'s `answers.custom` entry-count ceiling (route.ts) —
     *  bounds how many custom Q&A pairs an agent can write into one
     *  Firestore document per request, same DoS/cost-amplification spirit. */
    PREFERENCES_CUSTOM_ANSWERS_MAX: 40,
    /** `get_applications`'s default page size (tools.ts) — how many pursuits
     *  `listPursuitsForUser` returns when the caller omits `limit`. */
    APPLICATIONS_DEFAULT_LIMIT: 20,
    /** `search_jobs`'s default page size (tools.ts) when the caller omits
     *  `limit` — the ONE place this number lives; the catalog description
     *  and llms.txt both interpolate it rather than hand-typing "10" again. */
    SEARCH_DEFAULT_LIMIT: 10,
    /** `get_applications`'s page-size ceiling (tools.ts, route.ts) — same
     *  corpus/cost-protection spirit as `RESULT_CAP`, sized for a user's own
     *  application history rather than the whole job corpus. */
    APPLICATIONS_MAX_LIMIT: 50,
    /** `set_resume`'s `resume_data` cap for a single free-text field
     *  (an experience description, the generated summary) — same DoS/cost-
     *  amplification guard as `RESUME_TEXT_MAX_CHARS`, smaller since it
     *  bounds ONE field of a résumé rather than the whole document. See
     *  `lib/resume/set-resume.ts`. */
    RESUME_DATA_FIELD_MAX_CHARS: 5_000,
    /** `set_resume`'s `resume_data` cap on how many entries any one list in
     *  the structure may hold (experience entries, competency categories,
     *  education entries, skills within a category) — same DoS/cost-
     *  amplification spirit as `PREFERENCES_CUSTOM_ANSWERS_MAX`, one shared
     *  ceiling since no real résumé list runs longer than this. See
     *  `lib/resume/set-resume.ts`. */
    RESUME_DATA_ARRAY_MAX_ITEMS: 50,
    /**
     * D6 — per-credential DAILY cap on company-read tool calls (get_company,
     * get_company_timeline, search_companies), enforced ONCE at the
     * `withDeps` wrapper seam (route.ts) via a `companyRead: true` tool
     * option — never by enumerating tool names, so a future company-reading
     * tool inherits this budget by construction. Resets at UTC midnight (a
     * calendar-day budget, NOT a rolling window like DAILY_RECORD_BUDGET
     * above — see company-read-budget.ts). 50/day is generous for a real
     * "look up this company" session and stingy against enumerating the
     * whole company corpus one profile at a time.
     */
    DAILY_COMPANY_READ_BUDGET: 50,
    /** `search_companies`' per-call result cap — independent of RESULT_CAP
     *  (jobs): coincidentally the same number today, but a different budget
     *  for a different resource (companies, not job records), so it gets its
     *  own constant rather than reusing RESULT_CAP for an unrelated concern. */
    COMPANY_SEARCH_LIMIT: 20,
};

/**
 * Trims a free-text display label and caps it at `max` chars — the one
 * place any user- or client-supplied name (an OAuth client's self-declared
 * `client_name`, a manual token's user-typed label) is sanitized before it
 * reaches storage as `clientName`. A wildly long value is shortened rather
 * than rejected outright — it's just a display label, not something
 * structural. Control characters (NUL included) and lone surrogates aren't
 * valid JSON text for the jsonb column the credential doc lands in, so they
 * are stripped first; the cap then counts code points, not UTF-16 units, so
 * it can never split a surrogate pair. Empty after trim is `undefined` ("no
 * label supplied"), so a blank/whitespace-only input falls back to the
 * caller's default display string instead of storing an empty string.
 */
export function trimAndCapLabel(value: unknown, max: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const cleaned = value.replace(/[\p{Cc}\p{Cs}]/gu, "").trim();
    if (cleaned.length === 0) return undefined;
    const points = Array.from(cleaned);
    return points.length > max ? points.slice(0, max).join("").trimEnd() : cleaned;
}

/**
 * The canonical `claude mcp add` invocation for connecting Claude Code to
 * this server. Both the settings page's "Connected agents" section and the
 * public /agents page show this exact command — one function, not two
 * hand-typed copies, so the two surfaces can never drift apart.
 */
export function claudeCodeConnectCommand(mcpUrl: string): string {
    return `claude mcp add --transport http velai ${mcpUrl} --header "Authorization: Bearer YOUR_TOKEN"`;
}

/**
 * The one chat-apps connect story. Both the settings page's "Connected
 * agents" section and the public /agents page describe how a chat app
 * connects — `primary` is the connector flow, `alternate` is the
 * manual-token fallback — so the two surfaces can never tell two different
 * stories about the same category of client (one saying OAuth, the other
 * saying paste-a-token).
 */
export function chatAppConnectInstruction(): { primary: string; alternate: string } {
    return {
        primary: "Add velai as a connector by URL and sign in when your app asks.",
        alternate: "Some apps ask for a token instead — generate one in Settings → Connected agents.",
    };
}

/**
 * The one RFC 9728 protected-resource-metadata response, shared by the bare
 * `/.well-known/oauth-protected-resource` route and its `[...path]`
 * catch-all sibling (IMPORTANT 5 review fix — some MCP clients insert the
 * protected resource's own path segment, e.g.
 * `/.well-known/oauth-protected-resource/api/mcp`, per RFC 9728 §3.1's
 * path-insertion form; both must answer with the SAME body and cache
 * lifetime, so this is the one place that response is built rather than two
 * routes hand-copying it out of sync.
 */
export function protectedResourceMetadataResponse(): Response {
    const issuer = AGENT.issuer();
    return NextResponse.json(
        { resource: `${issuer}/api/mcp`, authorization_servers: [issuer] },
        { headers: { "Cache-Control": "public, max-age=3600" } }
    );
}
