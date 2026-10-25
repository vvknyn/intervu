import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8");
const MENU = read("src/components/ui/dropdown-menu.tsx");
const ALERT = read("src/components/ui/alert-dialog.tsx");

/** Every className string of a menu ROW primitive (item, checkbox, radio, sub trigger). */
const rowClasses = () =>
  [...MENU.matchAll(/function (DropdownMenu(?:Item|CheckboxItem|RadioItem|SubTrigger))\b[\s\S]*?\n}\n/g)].map((m) => ({
    name: m[1],
    classes: m[0].match(/"([^"]*cursor-default[^"]*)"/)?.[1] ?? "",
  }));

test("every menu row is auto-height, 32px on desktop and 44px at compact width", () => {
  const rows = rowClasses();
  assert.deepEqual(rows.map((r) => r.name).sort(), ["DropdownMenuCheckboxItem", "DropdownMenuItem", "DropdownMenuRadioItem", "DropdownMenuSubTrigger"]);
  for (const { name, classes } of rows) {
    assert.match(classes, /\bmin-h-8\b/, name);
    assert.match(classes, /\bmax-lg:min-h-11\b/, name);
    assert.doesNotMatch(classes, /(^|\s)h-\d/, `${name} must not fix a height (a helper line would overflow it)`);
  }
});

test("menu content keeps 16px from the viewport edges and never outgrows the space left", () => {
  assert.match(MENU, /collisionPadding = 16/);
  assert.match(MENU, /max-w-\(--radix-dropdown-menu-content-available-width\)/);
});

test("alert dialog buttons step to the 44px control at compact width", () => {
  assert.equal((ALERT.match(/"max-lg:ctl-lg"/g) ?? []).length, 1);
  assert.equal((ALERT.match(/cn\(PHONE_TAP_TARGET, props\.className\)/g) ?? []).length, 2);
});

test("no call site fixes a menu row's height, so the primitive's floor reaches all of them", () => {
  const sites = ["src/app/jobs/JobsContent.tsx", "src/components/layout/AccountMenu.tsx", "src/components/dashboard/StoryList.tsx", "src/components/jobs/JobDetail.tsx"];
  for (const rel of sites) {
    const tags = read(rel).match(/<DropdownMenuItem\b[^>]*>/g) ?? [];
    for (const tag of tags) assert.doesNotMatch(tag, /className="[^"]*(?:^|\s)(?:h|min-h|max-h)-[^"]*"/, `${rel}: ${tag}`);
  }
});
