import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Exercise the REAL status-token chokepoint (tsx resolves the @/ alias).
import {
  STATUS_PILL,
  STATUS_ICON_CHIP,
  applicationStatusTone,
  difficultyTone,
  ghostBadgeTone,
  type StatusTone,
} from "@/lib/ui/status-tokens";

const ALL_TONES: StatusTone[] = ["saved", "applied", "intv", "offer", "closed"];

describe("applicationStatusTone()", () => {
  it("maps every known application status to the right tone", () => {
    assert.equal(applicationStatusTone("applied"), "applied");
    assert.equal(applicationStatusTone("interviewing"), "intv");
    assert.equal(applicationStatusTone("offer"), "offer");
    // Beyond the surfacing case: both terminal-negative states collapse to `closed`.
    assert.equal(applicationStatusTone("rejected"), "closed");
    assert.equal(applicationStatusTone("withdrawn"), "closed");
  });

  it("falls back to `saved` for an unknown status (never throws)", () => {
    assert.equal(applicationStatusTone("on_hold"), "saved");
    assert.equal(applicationStatusTone(""), "saved");
  });
});

describe("difficultyTone()", () => {
  it("maps the full difficulty scale ascending in heat", () => {
    assert.equal(difficultyTone("junior"), "offer");
    assert.equal(difficultyTone("mid"), "applied");
    assert.equal(difficultyTone("senior"), "intv");
    assert.equal(difficultyTone("staff+"), "closed");
    // Beyond the original component (which only handled junior→staff+):
    // director+ must also resolve, to the hottest tone.
    assert.equal(difficultyTone("director+"), "closed");
  });

  it("falls back to `saved` for an unknown difficulty", () => {
    assert.equal(difficultyTone("principal"), "saved");
  });
});

describe("ghostBadgeTone()", () => {
  it("maps ghost badges to a tone, or null when there is no chip", () => {
    assert.equal(ghostBadgeTone("clear"), "offer");
    assert.equal(ghostBadgeTone("caution"), "intv");
    assert.equal(ghostBadgeTone("likely_ghost"), "intv");
    // Beyond the surfacing case: unscored renders NO chip → null.
    assert.equal(ghostBadgeTone("unscored"), null);
    assert.equal(ghostBadgeTone("garbage"), null);
  });
});

describe("token class maps", () => {
  it("define a token-backed class string for every tone (no raw palette colors)", () => {
    for (const tone of ALL_TONES) {
      const pill = STATUS_PILL[tone];
      const chip = STATUS_ICON_CHIP[tone];
      assert.ok(pill && pill.length > 0, `pill missing for ${tone}`);
      assert.ok(chip && chip.length > 0, `chip missing for ${tone}`);
      // Must reference the design tokens, not bg-blue-100 / text-red-700 etc.
      assert.match(pill, /st-/, `pill for ${tone} should use --st-* tokens`);
      assert.match(chip, /st-/, `chip for ${tone} should use --st-* tokens`);
      assert.doesNotMatch(
        pill,
        /\b(?:bg|text|border)-(?:blue|red|green|purple|amber|emerald|yellow|orange|gray|zinc|neutral|slate)-\d/,
        `pill for ${tone} must not hardcode a raw Tailwind palette color`,
      );
    }
  });

  it("every difficulty tone resolves to a real pill class", () => {
    for (const d of ["junior", "mid", "senior", "staff+", "director+"]) {
      assert.ok(STATUS_PILL[difficultyTone(d)].includes("st-"));
    }
  });
});
