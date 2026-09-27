import assert from "node:assert/strict";

const STACK_TESTID = 'data-testid="concept-a-postcard-stack"';

/** Balanced scan from `{` at `startIndex` through its closing `}`. */
export function sliceBalancedBraces(source: string, startIndex: number): string {
    const open = source.indexOf("{", startIndex);
    assert.ok(open >= 0, "expected `{` to balance from index");
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return source.slice(open, i + 1);
        }
    }
    throw new Error("unbalanced braces while scanning source");
}

/** Full `function PostcardCard…` through its closing brace (nested-safe). */
export function extractPostcardCardFunction(src: string): string {
    const start = src.indexOf("function PostcardCard");
    assert.ok(start >= 0, "PostcardCard must exist");
    const paramsOpen = src.indexOf("(", start);
    assert.ok(paramsOpen >= 0, "PostcardCard params must open");
    let pDepth = 0;
    let paramsClose = -1;
    for (let i = paramsOpen; i < src.length; i++) {
        const ch = src[i];
        if (ch === "(") pDepth++;
        else if (ch === ")") {
            pDepth--;
            if (pDepth === 0) {
                paramsClose = i;
                break;
            }
        }
    }
    assert.ok(paramsClose >= 0, "PostcardCard params must close");
    const bodyOpen = src.indexOf("{", paramsClose);
    assert.ok(bodyOpen >= 0, "PostcardCard body must open");
    const body = sliceBalancedBraces(src, bodyOpen);
    return src.slice(start, bodyOpen + body.length);
}

/** `export const POSTCARDS = [ … ] as const` block (nested arrays/objects safe). */
export function extractPostcardsConstBlock(src: string): string {
    const marker = "export const POSTCARDS";
    const start = src.indexOf(marker);
    assert.ok(start >= 0, "export const POSTCARDS must exist");
    const arrayStart = src.indexOf("[", start);
    assert.ok(arrayStart >= 0, "POSTCARDS array must open");
    let depth = 0;
    for (let i = arrayStart; i < src.length; i++) {
        const ch = src[i];
        if (ch === "[") depth++;
        else if (ch === "]") {
            depth--;
            if (depth === 0) {
                const tail = src.slice(i);
                const m = tail.match(/^\]\s*as const/);
                assert.ok(m, "POSTCARDS must end with `] as const`");
                return src.slice(start, i + m![0].length);
            }
        }
    }
    throw new Error("unbalanced brackets in POSTCARDS");
}

/** Full opening `<div …>` for the decorative postcard stack, including attrs before/after the test id. */
export function extractPostcardStackOpenTag(src: string): string {
    const idx = src.indexOf(STACK_TESTID);
    assert.ok(idx >= 0, "concept-a-postcard-stack must exist");
    const openStart = src.lastIndexOf("<div", idx);
    assert.ok(openStart >= 0 && openStart < idx, "stack opening <div must precede test id");
    const openEnd = src.indexOf(">", idx);
    assert.ok(openEnd > idx, "stack opening tag must close after test id");
    return src.slice(openStart, openEnd + 1);
}

/** Inner JSX of the stack: from after the opening tag through `{POSTCARDS.map…}`. */
export function extractPostcardStackBody(src: string): string {
    const idx = src.indexOf(STACK_TESTID);
    const openEnd = src.indexOf(">", idx) + 1;
    const mapIdx = src.indexOf("{POSTCARDS.map", openEnd);
    assert.ok(mapIdx >= 0, "POSTCARDS.map must live inside stack");
    const closeIdx = src.indexOf("</div>", mapIdx);
    assert.ok(closeIdx >= 0, "stack closing </div> must follow map");
    return src.slice(openEnd, closeIdx);
}
