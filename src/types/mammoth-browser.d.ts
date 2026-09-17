/**
 * mammoth ships no types for either its main entry or this browser bundle
 * (no @types/mammoth package exists). `lib/index.js`'s plain `exports.x =`
 * assignments are structurally inferable by `allowJs`, so the bare
 * `import("mammoth")` used server-side (src/actions/resume.ts) needs no
 * shim. `mammoth.browser.js` is a browserify UMD bundle — opaque to that
 * inference — so `src/lib/local-ai/extract-in-browser.ts` needs this one,
 * scoped to exactly the API it calls.
 */
declare module "mammoth/mammoth.browser.js" {
    export function extractRawText(input: {
        arrayBuffer: ArrayBuffer;
    }): Promise<{ value: string; messages: unknown[] }>;
}
