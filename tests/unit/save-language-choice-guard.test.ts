import test from "node:test";
import assert from "node:assert/strict";
import { saveLanguageChoice } from "../../src/hooks/use-agent-preferences";

test("a languages save before the preferences were read is refused, with no request", async () => {
    // Nothing has been read in this process, so the shared copy is empty: the call must return false without reaching the action.
    assert.equal(await saveLanguageChoice("u1", ["english", "french"]), false);
});
