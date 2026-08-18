import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const CSS = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** Relative luminance, 0 (black) → 1 (white). Good enough to order two greys. */
function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The `--token: R G B;` triplets in the first `:root` block, i.e. the light theme. */
function lightToken(name: string): [number, number, number] {
  const m = CSS.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`));
  assert.ok(m, `light theme is missing --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The declaration's value inside the first rule whose selector list contains `selector`. */
function declaration(selector: string, property: string): string {
  const rule = CSS.split("}").find(
    (block) => new RegExp(`(^|,|\\s)\\${selector}\\b`).test(block.split("{")[0] ?? ""),
  );
  assert.ok(rule, `no rule found for ${selector}`);
  const m = rule.match(new RegExp(`${property}:\\s*([^;]+);`));
  assert.ok(m, `${selector} does not declare ${property}`);
  return m[1].trim();
}

function rgbaChannels(value: string): [number, number, number, number] {
  const m = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/);
  assert.ok(m, `not an rgb/rgba colour: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

describe("globals.css glass surfaces", () => {
  // The redesign shipped `border: 1px solid rgba(255, 255, 255, 0.6)` on
  // .glass-panel. Our light ground is slate-50, so that edge was LIGHTER than
  // the page behind it and erased itself — every glass surface (the /jobs
  // search line, the results meta bar, JobDetail, SavedSearchesPanel,
  // BoardVisitBanner) read as a white rectangle on a white page.
  it("draws the light-theme edge darker than the page it sits on", () => {
    const page = luminance(...lightToken("background"));

    for (const selector of [".glass-panel", ".glass-panel-raised"]) {
      const [r, g, b, alpha] = rgbaChannels(declaration(selector, "border"));
      assert.ok(alpha > 0.05, `${selector} border is effectively invisible (alpha ${alpha})`);
      assert.ok(
        luminance(r, g, b) < page,
        `${selector} border is lighter than --background, so it erases its own edge`,
      );
    }
  });

  it("keeps the raised surface separable from the plain one", () => {
    const plain = rgbaChannels(declaration(".glass-panel", "background"));
    const raised = rgbaChannels(declaration(".glass-panel-raised", "background"));
    assert.notEqual(
      luminance(plain[0], plain[1], plain[2]),
      luminance(raised[0], raised[1], raised[2]),
      "the focal surface fills identically to the default one, so it cannot read as focal",
    );
  });
});
