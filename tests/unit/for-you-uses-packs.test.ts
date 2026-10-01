import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FOR_YOU_HOME_SRC = readFileSync(
    join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx"),
    "utf8",
);
const FOR_YOU_DIR = join(__dirname, "../../src/components/jobs/for-you");

test("ForYouHome opens a pack as the stacked role cards, not the list or the postcard coach", () => {
    assert.match(FOR_YOU_HOME_SRC, /from "@\/components\/jobs\/for-you\/RoleStack"/);
    assert.match(FOR_YOU_HOME_SRC, /from "@\/components\/jobs\/for-you\/StackedRoleCard"/);
    assert.match(FOR_YOU_HOME_SRC, /<RoleStack/);
    assert.match(FOR_YOU_HOME_SRC, /<StackedRoleCard/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /<JobCard/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /DeckRoleDetail/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /Why this fits/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /FitReasons/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /Getting around/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /ProgressBar/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /<Kbd/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /<ForYouDeck/);
});

test("ForYouHome does not mount Search-only chrome (ranked header or preference chips)", () => {
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /for-you-result-line/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /for-you-preferences/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /ranked · By fit/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /PreferenceChipStrip/);
    assert.doesNotMatch(FOR_YOU_HOME_SRC, /Edit preferences/);
});

test("ForYouDeck and ForYouPack exist as the dedicated pack surface", () => {
    const files = readdirSync(FOR_YOU_DIR);
    assert.ok(files.includes("ForYouDeck.tsx"), "ForYouDeck.tsx must exist");
    assert.ok(files.includes("ForYouPack.tsx"), "ForYouPack.tsx must exist");
});
