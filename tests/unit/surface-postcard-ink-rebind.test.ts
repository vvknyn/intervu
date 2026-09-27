import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const JOB_DETAIL = readFileSync(
  join(process.cwd(), "src/components/jobs/JobDetail.tsx"),
  "utf8",
);

describe("surface-postcard paper ink rebinding", () => {
  it("globals.css rebinds semantic foreground tokens on `.surface-paper` prose contexts", () => {
    const block = CSS.match(/\.surface-paper\s*\{[\s\S]*?\}/)?.[0] ?? "";
    assert.ok(block.length > 0, "missing .surface-paper ink block");
    assert.match(block, /--foreground:\s*var\(--surface-postcard-foreground\)/);
    assert.match(block, /--color-foreground:\s*rgb\(var\(--surface-postcard-foreground\)\)/);
    assert.match(block, /--muted-foreground:\s*var\(--surface-postcard-muted\)/);
    assert.match(block, /--color-muted-foreground:\s*rgb\(var\(--surface-postcard-muted\)\)/);
  });

  it("JobDescription uses text-inherit so postcard shells supply paper ink", () => {
    const jd = JOB_DETAIL.match(/export function JobDescription[\s\S]*?^}/m)?.[0] ?? "";
    assert.ok(jd.length > 0, "JobDescription export not found");
    assert.match(jd, /text-inherit/, "JobDescription must inherit ink from its mount (postcard or canvas)");
    assert.doesNotMatch(
      jd,
      /text-foreground/,
      "JobDescription must not pin canvas foreground — that caused near-white prose on cream paper",
    );
  });
});
