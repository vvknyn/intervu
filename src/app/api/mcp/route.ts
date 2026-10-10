import { NextResponse } from "next/server";
import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import type { McpServer, ServerContext, ToolCallback } from "@modelcontextprotocol/server";
import { AGENT } from "@/lib/agent/config";
import { extractBearerToken } from "@/lib/agent/http";
import { getAgentStore } from "@/lib/agent/store";
import { verifySecret, AUTHORIZED_CREDENTIAL_KINDS } from "@/lib/agent/tokens";
import { checkRateLimit, rateLimitedResponse } from "@/lib/agent/rate-limit";
import { consumeRecordBudget } from "@/lib/agent/record-budget";
import { consumeCompanyReadBudget } from "@/lib/agent/company-read-budget";
import {
    toolSearchJobs, toolGetJob, toolForYou, toolSaveJob, toolMarkApplied,
    toolGetResume, toolSaveResumeVariant, toolGetResumeVariant, toolSetResume,
    toolGetPreferences, toolSetPreferences, toolGetApplications, type ToolDeps,
} from "@/lib/agent/tools";
import { toolGetCompany, toolGetCompanyTimeline, toolSearchCompanies } from "@/lib/agent/company-tools";
import { getAgentPreferences, setAgentPreferences } from "@/lib/agent/preferences";
import { searchJobs, locationVocabulary } from "@/lib/jobs/search";
import { hydrateJobDescription } from "@/lib/jobs/hydrate-description";
import { withDescriptionPlace, withPlaceRestrictions } from "@/lib/jobs/place-notes";
import { siteSearch } from "@/lib/agent/site-search";
import { upsertPursuitCore, findPursuitByJobId } from "@/lib/pursuits/upsert-core";
import { saveResumeVersionForPursuit } from "@/lib/pursuits/resume-version";
import { listPursuitsForUser } from "@/lib/pursuits/list";
import { getBaseResumeForUser } from "@/lib/resume/base-resume";
import { setBaseResumeForUser } from "@/lib/resume/set-resume";
import { getIntervuPg, getExhaustPg } from "@/lib/pg/pool";
import { getCompanyPageData } from "@/lib/companies/get-company";
import { getCompanyExhaust } from "@/lib/companies/exhaust";
import { searchCompanies } from "@/lib/companies/company-search";
import { MCP_TOOL_SPECS, type McpToolName } from "@/lib/agent/mcp-tool-specs";
import { captureMcpToolCall, mcpClientName, mcpErrorType, mcpToolFromLabel } from "@/lib/agent/telemetry";

/**
 * POST/GET/DELETE /api/mcp — Streamable HTTP entrypoint for velai's agent
 * tools. The full tool list (title, description, wire schema) lives in
 * exactly one place — `MCP_TOOL_SPECS` (src/lib/agent/mcp-tool-specs.ts) —
 * registered onto `server` by the loop in `createMcpHandler` below.
 * `/llms.txt` (src/app/llms.txt/route.ts) generates its own `## Tools`
 * section from that same object, so the two surfaces can never drift apart.
 *
 * Auth is hand-rolled rather than routed through `mcp-handler`'s
 * `withMcpAuth`: that helper's own 401/403 response (an RFC 6749 OAuth error
 * body plus a `WWW-Authenticate` challenge carrying `error=`/`error_description=`
 * segments) doesn't match this route's wire contract — a plain
 * `{ error: 'unauthorized' }` body and a bare
 * `Bearer resource_metadata="..."` challenge — so `handleMcpRequest` below
 * builds that response itself. It still uses the exact mechanism
 * `withMcpAuth` uses to hand a verified identity to tool callbacks
 * (`request.auth`, read by `mcp-handler` and surfaced to each tool call as
 * `ctx.http.authInfo`), so `uid` still flows per-request, never through
 * module-level state.
 */

export function unauthorizedResponse(): Response {
    return NextResponse.json(
        { error: "unauthorized" },
        {
            status: 401,
            headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${AGENT.issuer()}/.well-known/oauth-protected-resource"`,
            },
        }
    );
}

/**
 * Wraps a tool's plain-object result as MCP `tools/call` content. The one
 * place a tool failure — either an `{ error: ... }` shape (job not found,
 * upsert failure, ...) OR `search_jobs`'s `unavailable: true` shape (backend
 * down, `SearchOut` in tools.ts) — becomes the wire's `isError` flag, so
 * every tool marks failures the same way instead of each callback deciding
 * it separately. Before this, `unavailable: true` alone (no sibling `error`
 * key) rendered as a normal, non-error tool result — an MCP client has no
 * reason to treat that payload as a failure unless `isError` says so.
 */
export function toolResult(payload: object): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
    const isFailure = "error" in payload || (payload as { unavailable?: boolean }).unavailable === true;
    return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        ...(isFailure ? { isError: true } : {}),
    };
}

type McpToolResult = ReturnType<typeof toolResult>;

/**
 * A catalog handler carrying the tool name it was built for as a phantom
 * type. `withDeps` needs the name for telemetry, which puts a string
 * literal next to each `handlers` key below — the `__tool?: K` brand is what
 * makes `search_jobs: withDeps("get_job", …)` a TYPECHECK error instead of
 * a mislabeled dashboard. Never set at runtime.
 */
type CatalogHandler<K extends McpToolName> = ToolCallback<(typeof MCP_TOOL_SPECS)[K]["inputSchema"]> & {
    readonly __tool?: K;
};

/**
 * Resolves `ToolDeps` from the per-request identity `handleMcpRequest`
 * stashed on `ctx.http.authInfo.extra.uid`, then runs `run` and wraps its
 * result for the wire. Deps are built fresh from `ctx` on every call — never
 * read off a module-level variable — so concurrent requests for different
 * users can never cross-contaminate.
 *
 * Every outcome past the auth check — budget refusal, tool error, tool
 * success, thrown exception — is one `$mcp_tool_call` to PostHog
 * (lib/agent/telemetry.ts), timed from here. The unauthorized short-circuit
 * is not counted: there is no uid to attribute it to, and `handleMcpRequest`
 * already refused anything without a valid credential before this runs.
 */
function withDeps<K extends McpToolName, In, Out extends object>(
    name: K,
    run: (deps: ToolDeps, input: In) => Promise<Out>,
    opts?: { companyRead?: boolean },
): ((input: In, ctx: ServerContext) => Promise<McpToolResult>) & { readonly __tool?: K } {
    return async (input: In, ctx: ServerContext) => {
        const extra = ctx.http?.authInfo?.extra;
        const uid = extra?.uid;
        const credentialId = extra?.credentialId;
        if (typeof uid !== "string" || typeof credentialId !== "string") return toolResult({ error: "unauthorized" });
        const clientName = typeof extra?.clientName === "string" ? extra.clientName : undefined;
        const sessionId = ctx.sessionId ?? (typeof extra?.sessionId === "string" ? extra.sessionId : undefined);
        const startedAt = Date.now();
        const finish = (payload: object): McpToolResult => {
            const result = toolResult(payload);
            captureMcpToolCall({
                tool: name, uid, durationMs: Date.now() - startedAt,
                isError: result.isError === true, errorType: mcpErrorType(payload), clientName, sessionId,
            });
            return result;
        };
        // D6 — checked BEFORE the tool runs, matched by the `companyRead`
        // tool option rather than an enumerated tool-name list, so any
        // future company-reading tool inherits this budget by construction.
        if (opts?.companyRead) {
            const budget = await consumeCompanyReadBudget(getIntervuPg(), credentialId);
            if (!budget.ok) return finish({ error: budget.error });
        }
        const deps: ToolDeps = {
            uid, search: searchAsTheSite, locationVocabulary, upsert: upsertPursuitCore,
            getBaseResume: getBaseResumeForUser,
            setBaseResume: setBaseResumeForUser,
            findPursuitByJobId,
            saveResumeVersion: saveResumeVersionForPursuit,
            getPreferences: getAgentPreferences,
            setPreferences: setAgentPreferences,
            listApplications: listPursuitsForUser,
            consumeRecordBudget: (count) => consumeRecordBudget(getAgentStore(), credentialId, count),
            getCompanyPageData,
            getCompanyExhaust,
            searchCompanies: (query, limit) => searchCompanies(getExhaustPg(), query, limit),
        };
        try {
            return finish(await run(deps, input));
        } catch (error) {
            captureMcpToolCall({
                tool: name, uid, durationMs: Date.now() - startedAt,
                isError: true, errorType: "exception", clientName, sessionId,
            });
            throw error;
        }
    };
}

/** Every tool's job read, with the reads the site adds after the bare search
 *  (`site-search.ts`): description places, and a filled description for an
 *  id lookup. No client IP is passed, so no IP location default applies. */
const searchAsTheSite = siteSearch({
    search: (params) => searchJobs(params),
    hydrate: (id) => hydrateJobDescription(id, null),
    rowPlaces: (hits, opts) => withPlaceRestrictions(hits, opts),
    wholePlace: withDescriptionPlace,
});

/**
 * One handler per catalog entry. Typed as a mapped type over `McpToolName`
 * rather than inferred — a spec added to `MCP_TOOL_SPECS`
 * (src/lib/agent/mcp-tool-specs.ts) with no matching handler here (or vice
 * versa) is a TYPECHECK error, so there is no runtime tool-name list to keep
 * in sync by hand. That check only proves each entry's callback accepts the
 * INPUT SHAPE its own catalog key's spec declares — it does not prove the
 * RIGHT tool is bound to that key: `get_job`/`save_job`/`mark_applied` all
 * share `jobIdInput`, so a handler swapped between those three keys would
 * still typecheck here and is a correctness bug this mapped type can't catch.
 */
const handlers: { [K in McpToolName]: CatalogHandler<K> } = {
    search_jobs: withDeps("search_jobs", toolSearchJobs),
    for_you: withDeps("for_you", toolForYou),
    get_job: withDeps("get_job", toolGetJob),
    save_job: withDeps("save_job", toolSaveJob),
    mark_applied: withDeps("mark_applied", toolMarkApplied),
    get_resume: withDeps("get_resume", toolGetResume),
    save_resume_variant: withDeps("save_resume_variant", toolSaveResumeVariant),
    get_resume_variant: withDeps("get_resume_variant", toolGetResumeVariant),
    set_resume: withDeps("set_resume", toolSetResume),
    get_applications: withDeps("get_applications", toolGetApplications),
    get_preferences: withDeps("get_preferences", toolGetPreferences),
    set_preferences: withDeps("set_preferences", toolSetPreferences),
    get_company: withDeps("get_company", toolGetCompany, { companyRead: true }),
    get_company_timeline: withDeps("get_company_timeline", toolGetCompanyTimeline, { companyRead: true }),
    search_companies: withDeps("search_companies", toolSearchCompanies, { companyRead: true }),
};

/**
 * Registers one catalog entry. A generic helper rather than inlining the
 * `server.registerTool` call in the loop below: with `name` typed as the
 * whole `McpToolName` union (as it is inside a `for...of` over
 * `Object.keys`), `registerTool`'s own generic inference can't correlate
 * `MCP_TOOL_SPECS[name]`'s inputSchema with `handlers[name]`'s parameter
 * type across that union (it silently infers an empty schema and rejects
 * every real handler). Pinning `name` to one generic `K` per call fixes the
 * union problem, but inference still can't reach through the indexed-access
 * types on a generic K, so both type arguments of the selected overload
 * (`registerTool<OutputArgs, InputArgs>`) are given explicitly rather than
 * cast: the first slot is `OutputArgs`, filled with a placeholder
 * (`config.outputSchema` is never set, so its actual value is unused) — the
 * second slot is the real `InputArgs`, `(typeof MCP_TOOL_SPECS)[K]["inputSchema"]`.
 * `handlers`' own declared type above is what actually keeps
 * `MCP_TOOL_SPECS[K]` and `handlers[K]` honest against each other.
 */
function registerCatalogTool<K extends McpToolName>(server: McpServer, name: K): void {
    server.registerTool<z.ZodObject<z.ZodRawShape>, (typeof MCP_TOOL_SPECS)[K]["inputSchema"]>(name, MCP_TOOL_SPECS[name], handlers[name]);
}

const mcpHandler = createMcpHandler(
    (server) => {
        for (const name of Object.keys(MCP_TOOL_SPECS) as McpToolName[]) {
            registerCatalogTool(server, name);
        }
    },
    { serverInfo: { name: "velai-agent", version: "1.0.0" } }
);

/**
 * Best-effort JSON-RPC method/tool label for the rate limiter's accepted-
 * call log line (`checkRateLimit`'s `label` param) — reads a CLONED request
 * so the original body stream stays intact for `mcpHandler` to parse for
 * real below. A GET (the Streamable HTTP SSE stream) or DELETE (session
 * terminate) carries no JSON-RPC envelope, so those just log their HTTP
 * method; a malformed/unparseable POST body falls back to "unknown" rather
 * than throwing — this is diagnostic labeling, never a validation gate.
 */
async function mcpCallLabel(request: Request): Promise<string> {
    if (request.method !== "POST") return request.method;
    try {
        const body = await request.clone().json();
        if (body?.method === "tools/call" && typeof body?.params?.name === "string") {
            return `tools/call:${body.params.name}`;
        }
        if (typeof body?.method === "string") return body.method;
    } catch {
        // Not JSON, or an unparseable body — fall through to "unknown".
    }
    return "unknown";
}

/**
 * Authenticates the bearer secret (manual/access credential kinds only — a
 * refresh credential must never authorize a resource call), rate-limits by
 * credential id, then hands off to the stateless MCP handler with
 * `request.auth` set so tool callbacks can resolve `uid` (see `withDeps`).
 */
async function handleMcpRequest(request: Request): Promise<Response> {
    const secret = extractBearerToken(request);
    if (!secret) return unauthorizedResponse();

    const credential = await verifySecret(getAgentStore(), secret);
    if (!credential || !AUTHORIZED_CREDENTIAL_KINDS.has(credential.kind)) {
        return unauthorizedResponse();
    }

    const label = await mcpCallLabel(request);
    const clientName = mcpClientName(request.headers.get("user-agent"));
    const sessionId = request.headers.get("mcp-session-id") ?? undefined;
    const rate = checkRateLimit(credential.id, undefined, undefined, label);
    if (!rate.ok) {
        // A 429 never reaches `withDeps`, so it is counted here — the one
        // way to see, per account and per client, how often the hourly cap
        // is what an agent hits, rather than learning it from support mail.
        captureMcpToolCall({
            tool: mcpToolFromLabel(label), uid: credential.uid, durationMs: 0,
            isError: true, errorType: "rate_limited", clientName, sessionId,
        });
        return rateLimitedResponse(rate.retryAfterSec);
    }

    request.auth = {
        token: secret,
        clientId: credential.clientId ?? credential.id,
        scopes: [],
        // `clientName` / `sessionId` ride along for telemetry only (see
        // `withDeps`); `uid` / `credentialId` are the identity the tools use.
        extra: { uid: credential.uid, credentialId: credential.id, clientName, sessionId },
    };
    return mcpHandler(request);
}

export { handleMcpRequest as GET, handleMcpRequest as POST, handleMcpRequest as DELETE };
