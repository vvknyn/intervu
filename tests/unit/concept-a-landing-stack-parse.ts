import assert from "node:assert/strict";

const STACK_TESTID = 'data-testid="concept-a-postcard-stack"';

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
