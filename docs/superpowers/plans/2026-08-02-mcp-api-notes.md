# MCP API verification notes (Task 0)

Decision record for later tasks building `src/app/api/mcp/route.ts` and the
OAuth/tools surface. All claims below are sourced from the actually-installed
package contents (READMEs + `.d.ts`/`.d.mts` declarations), not from memory or
training-data assumptions about MCP packages.

## Decision

**Path taken: the primary 2.x pair, no fallback.**

```
"@modelcontextprotocol/server": "^2.0.0"
"mcp-handler": "^2.1.0"
```

Step 3's fallback (`@modelcontextprotocol/sdk@1.30.0` + a `zod3` alias) was
**not** needed. The 2.x pair serves Next.js App Router route handlers
natively and requires zod v4 — installed `zod@^4.3.6` is not just accepted,
it is a hard peer requirement (see zod verdict below). `@modelcontextprotocol/sdk`
and `redis` are correctly absent from `package.json` — the mcp-handler README
explicitly says to remove them when on the 2.x line (README:98-100, quoted
below), so there is nothing 1.x-shaped left to delete.

## Exact import statements for later tasks

```typescript
// app/api/mcp/route.ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
// server instance passed into the initializer callback is typed McpServer,
// imported from "@modelcontextprotocol/server" only if you need the type
// annotation explicitly (createMcpHandler infers it for you).
```

## (a) Route-handler-creation function + exact signature

File: `node_modules/mcp-handler/dist/index.d.ts` (full file read).

```typescript
declare function createMcpRouteHandler(
  initializeServer: ((server: McpServer) => Promise<void>) | ((server: McpServer) => void),
  options?: McpHandlerOptions
): (request: Request) => Promise<Response>;

export { createMcpRouteHandler as createMcpHandler, ... };
```

`McpHandlerOptions = ServerOptions & { serverInfo?: {name, version}; verboseLogs?: boolean; onEvent?: (event: McpEvent) => void }`.

Quick Start example (README:29-54):

```typescript
// app/api/mcp/route.ts
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const handler = createMcpHandler((server) => {
  server.registerTool(/* ... */);
});

export { handler as GET, handler as POST };
```

README:56-58: "`/api/mcp` is a convention, not a required path. `mcp-handler`
does not inspect the request pathname, so you can place this handler at any
framework route." The returned value is a Web-standard
`(Request) => Promise<Response>` — mount it as both `GET` and `POST` on a
Next.js route handler.

## (b) Tool registration — function, schema format, exact call shape

File: `node_modules/@modelcontextprotocol/server/dist/createMcpHandler-CLhGwQTn.d.mts:3300-3318` (the `McpServer` class, declared at line 3173).

```typescript
registerTool<
  OutputArgs extends StandardSchemaWithJSON,
  InputArgs extends StandardSchemaWithJSON | undefined = undefined
>(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    icons?: Icon[];
    _meta?: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>
): RegisteredTool;
```

A second, `@deprecated` overload at line 3310 accepts a raw `ZodRawShape`
(plain `{ field: z.string() }` object, auto-wrapped in `z.object()`) — do not
use it; use the primary overload with a real `z.object({...})`.

Schema format: **zod object (or any Standard-Schema-compliant validator)**,
not raw JSON Schema. Confirmed by the type constraint `StandardSchemaWithJSON`
(same file, lines 1344-1346) and its doc comment (lines 1339-1340):
"Zod v4, ArkType, and Valibot (via `@valibot/to-json-schema`'s
`toStandardJsonSchema`) all implement both interfaces" — i.e. the SDK wants
an object satisfying both `~standard.validate` (Standard Schema) and
`~standard.jsonSchema` (for `tools/list` advertisement), which `z.object()`
under zod v4 provides directly.

Exact call shape (README:34-51, also mirrored in the .d.ts example at
lines 3279-3297):

```typescript
server.registerTool(
  "roll_dice",
  {
    title: "Roll Dice",
    description: "Roll a dice with a specified number of sides.",
    inputSchema: z.object({ sides: z.number().int().min(2) }),
  },
  async ({ sides }) => {
    const value = 1 + Math.floor(Math.random() * sides);
    return { content: [{ type: "text", text: `🎲 You rolled a ${value}!` }] };
  },
);
```

Companion methods with the identical pattern: `registerPrompt` (`argsSchema`,
lines 3345-3351) and `registerResource` (lines 3264-3269, no schema — URI or
`ResourceTemplate` instead).

## (c) zod v4 compatibility verdict: YES (unconditional, empirically proven)

**Textual evidence (unambiguous, not just "accepted" — required):**
- README:10: `npm install mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4`
- README:13: "`mcp-handler` 2.x requires the MCP SDK v2 packages
  (`@modelcontextprotocol/server` ^2.0.0), zod ^4.2.0, and Node.js 20+."
- `@modelcontextprotocol/server`'s own `package.json` `dependencies` field:
  `"zod": "^4.2.0"` (the SDK depends on zod v4 itself, it doesn't merely tolerate a consumer's zod v4).
- README migration note (README:100-101): "Install `@modelcontextprotocol/server`
  (v2) and `zod@^4`... `inputSchema`/`argsSchema` take a full Standard Schema
  (e.g. `z.object({ ... })`) instead of a raw zod shape."

**Empirical proof (type signatures were not ambiguous, but tested anyway per
brief Step 2c):** wrote a throwaway `.ts` file in a scratch dir (outside this
repo, since deleted) that imported `createMcpHandler` from `mcp-handler` and
`z` from installed `zod@4.3.6`, called
`server.registerTool("empirical_check", { inputSchema: z.object({ sides: z.number().int().min(2) }) }, async ({ sides }) => {...})`,
and type-checked it against this repo's real `node_modules` (via `npx tsc`
with a `paths`-mapped scratch tsconfig, since bare-specifier resolution walks
up from the *importing file's own directory*, not the shell's cwd — running
`npx tsc` from inside the repo on a file living outside it does NOT reach
the repo's `node_modules` by itself, contrary to a naive reading of "run from
within the repo so it resolves node_modules"; confirmed by first getting
`TS2307: Cannot find module 'mcp-handler'` on the unmapped attempt).

- Positive case: `npx tsc --noEmit` (via scratch tsconfig with
  `paths` → this repo's `node_modules/{zod,mcp-handler,@modelcontextprotocol/server}`)
  → **exit code 0**, zero errors. The callback parameter `sides` was inferred
  as `number` (not `any`), proving real Standard-Schema type inference, not
  structural duck-typing.
- Negative control: same file with `const doubled: string = sides * 2`
  (a `number` assigned to a `string`) → **exit code 2**,
  `TS2322: Type 'number' is not assignable to type 'string'` — proves the
  positive result wasn't a false pass from a too-lenient tsconfig.

Both scratch files and the scratch tsconfig were deleted after the test; no
scratch artifacts remain in this repo or on disk.

**Verdict: zod v4 (installed `^4.3.6`) works — no downgrade, no `zod3` alias,
no `--save-exact`. Step 3's fallback path was not exercised.**

## (d) Stateless-per-request vs. shared server instance

**Per-request-factory model — the SDK's own internal doc comment names it
explicitly.** File: `node_modules/@modelcontextprotocol/server/dist/createMcpHandler-CLhGwQTn.d.mts:3182-3187`, on the private field that memoizes
JSON-Schema conversion:

> "Per-tool JSON-converted `inputSchema`, memoized so the SEP-2243
> registration-time scan and the pre-dispatch validation step share one
> conversion instead of paying it twice per request under the
> **per-request-factory `createMcpHandler` model**."

Corroborating evidence: `createMcpHandler`'s `initializeServer` callback
(the `(server) => {...}` you pass in) is invoked to build a `McpServer`
instance per handled request — this is why `registerTool` calls sit inside
that callback rather than at module scope. The mcp-handler README also
states the transport itself is stateless (README:86-87): "2025-era
Streamable HTTP: served via the SDK's stateless legacy fallback... GET/DELETE
session operations answer `405` (serving is stateless)."

**What this means for the Next.js route:** treat the `initializeServer`
callback as re-run on every invocation (cheap: `registerTool` calls only,
no expensive I/O or connection setup inside it). Anything expensive
(DB pool, external API client) must be constructed at module scope
*outside* `createMcpHandler(...)`, not inside the initializer callback,
so it's reused across the serverless function's warm invocations rather
than rebuilt per request.

## (e) Auth hooks: bearer-token → uid

File: `node_modules/mcp-handler/dist/index.d.ts` (full file read).

```typescript
declare function withMcpAuth(
  handler: (req: Request) => Response | Promise<Response>,
  verifyToken: (req: Request, bearerToken?: string) => AuthInfo | undefined | Promise<AuthInfo | undefined>,
  {
    required,
    resourceMetadataPath,
    requiredScopes,
    resourceUrl,
  }?: {
    required?: boolean;
    resourceMetadataPath?: string;
    requiredScopes?: string[];
    resourceUrl?: string;
  }
): (req: Request) => Promise<Response>;
```

Wrap the handler from `createMcpHandler` with `withMcpAuth(handler, verifyToken, opts)`.
`verifyToken(req, bearerToken)` is where the app maps a bearer token to a uid
— return an `AuthInfo` (or `undefined`/throw to reject); `withMcpAuth`
answers `401`/`403` with RFC 9728 `WWW-Authenticate` challenges automatically
when verification fails.

`AuthInfo` shape — file same package, lines 751-778:

```typescript
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: URL;
  extra?: Record<string, unknown>;  // <- put the app's internal uid/user record here
}
```

Inside a tool handler, the verified auth surfaces as `ctx.http?.authInfo`
(same file, lines 2168-2176, on `BaseContext`):

```typescript
http?: {
  /** Information about a validated access token, provided to request handlers. */
  authInfo?: AuthInfo;
};
```

The README's migration note (line 103) confirms the naming: "In handler
callbacks, `extra.authInfo` is now `ctx.http?.authInfo`" (i.e. this replaces
the 1.x `extra.authInfo` shape). `ServerContext` (the type tool-callback `ctx`
params actually receive, line 2181) additionally exposes `ctx.http?.req` —
the raw `globalThis.Request` — for any header the app needs beyond what
`verifyToken` already extracted (lines 2212-2216).

Also available for the RFC 9728 resource-metadata side (not auth itself, but
required plumbing for OAuth-based MCP clients): `protectedResourceHandler`,
`generateProtectedResourceMetadata`, `metadataCorsOptionsRequestHandler` — all
in the same `index.d.ts`.

## Gotchas for later implementers

1. **`registerTool` has two overloads** — the second (raw `ZodRawShape`,
   `.d.mts:3310`) is `@deprecated`. Always pass a real `z.object({...})` to
   `inputSchema`/`outputSchema`, never a bare shape object.
2. **Variadic `.tool()`/`.prompt()`/`.resource()` are gone in 2.x** — only
   `registerTool` / `registerPrompt` / `registerResource` exist
   (README:102).
3. **No Redis, no session IDs, no `basePath`/`streamableHttpEndpoint`/
   `sseEndpoint`/`maxDuration`/`sessionIdGenerator` options** — all removed
   in 2.x (README:105). Mount the handler directly at the desired route;
   don't look for 1.x-era config knobs.
4. **HTTP+SSE transport (2024-11-05) is gone** — only Streamable HTTP
   (README:87). Don't wire up `/sse` or `/message` paths.
5. **`withMcpAuth` is exported twice** — once as `withMcpAuth` and once as
   `experimental_withMcpAuth` (same function, `index.d.ts` export line).
   Prefer the plain `withMcpAuth` name.
6. **TypeScript ≥6.0 note from the SDK's own README** (`@modelcontextprotocol/server/README.md:19`):
   "TypeScript ≥6.0 no longer auto-includes `@types/*` — add
   `"types": ["node"]` to your `tsconfig.json` `compilerOptions`" — check this
   repo's `tsconfig.json` before the route lands if `Buffer`-referencing
   types from the SDK cause a build error.
7. **`createMcpHandler`'s initializer callback re-registers tools per
   request** (see (d) above) — keep it side-effect-free and cheap; do not
   put DB/network client construction inside it.

## Brief-vs-detailed-instructions contradiction check

None found. The task brief (`.superpowers/sdd/2026-08-02-agent-mcp-server/task-0-brief.md`)
and the detailed dispatch instructions describe the same 5 steps; the
detailed version is a strict superset (adds the empirical zod-check
requirement and this notes file's structure) and does not conflict with the
brief's terser wording anywhere.
