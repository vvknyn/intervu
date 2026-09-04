import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { JOB_DOCUMENT_FIELDS } from "../../src/lib/telemetry/job-document-fields";

/**
 * `job-document-fields.ts` is a hand-maintained manifest with no compiler
 * guarantee tying it to `features.ts` (unlike `job-features-columns.ts`,
 * whose `satisfies Record<keyof JobFeatures, true>` covers ALL of
 * `JobFeatures`; this list is a strict SUBSET of `PublicJob`, so that trick
 * doesn't apply here). This test is the thing that actually keeps it honest:
 * it derives the truth by reading `features.ts` as text and extracting every
 * `job.<field>` reference, then asserts the constant and the extractor agree
 * in both directions —
 *  (a) every field the extractor reads is in the constant (else Meili's
 *      `&fields=` projection would silently strip a field the extractor
 *      needs, and every job would report that fact as null forever), and
 *  (b) the constant contains no field the extractor never reads (else that
 *      field buys back none of the wire savings it exists for).
 *
 * Same approach as `tests/unit/telemetry-column-conformance.test.ts`, which
 * parses `telemetry-schema.sql`'s own array literal instead of trusting
 * `column-rules.ts` to already match it.
 */

const FEATURES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/lib/telemetry/features.ts",
);

/**
 * Pure: every distinct `job.<field>` reference in a chunk of TS source.
 * Exercised twice below — once against the real extractor source, once
 * against an inline fixture in the drift-detection test — so the extraction
 * logic itself is proven to catch a missing field, not just to have passed
 * once against today's `features.ts`.
 */
function extractJobFieldReferences(source: string): Set<string> {
  return new Set([...source.matchAll(/\bjob\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g)].map((m) => m[1]!));
}

function loadFeaturesSource(): string {
  try {
    return readFileSync(FEATURES_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `job-document-fields: could not read ${FEATURES_PATH} to determine the fields the extractor ` +
        `actually reads — refusing to silently skip the conformance checks. ${(err as Error).message}`,
    );
  }
}

const REFERENCED_FIELDS = extractJobFieldReferences(loadFeaturesSource());
const CONSTANT_FIELDS = JOB_DOCUMENT_FIELDS as readonly string[];

if (REFERENCED_FIELDS.size === 0) {
  throw new Error(
    "job-document-fields: extracted 0 job.<field> references out of features.ts — the extractor's " +
      "coding style has changed (e.g. now destructures `job` instead of dotted access); update " +
      "extractJobFieldReferences to match it rather than letting every assertion below vacuously pass.",
  );
}

for (const field of REFERENCED_FIELDS) {
  test(`${field}: referenced by features.ts, present in JOB_DOCUMENT_FIELDS`, () => {
    assert.ok(
      CONSTANT_FIELDS.includes(field),
      `features.ts reads job.${field} but JOB_DOCUMENT_FIELDS omits it — the nightly build's &fields= ` +
        "projection would silently strip it and every job would report it as null forever",
    );
  });
}

for (const field of CONSTANT_FIELDS) {
  test(`${field}: present in JOB_DOCUMENT_FIELDS, actually referenced by features.ts`, () => {
    assert.ok(
      REFERENCED_FIELDS.has(field),
      `JOB_DOCUMENT_FIELDS lists "${field}" but features.ts never reads job.${field} — remove it, it's ` +
        "buying back none of the wire savings the projection exists for",
    );
  });
}

test("extractJobFieldReferences detects drift: an unlisted field in a fixture is reported, not silently accepted", () => {
  const fixture = `
    export function extractSomething(job: PublicJob) {
      return { known: job.title, drifted: job.someUnlistedField };
    }
  `;
  const referenced = extractJobFieldReferences(fixture);
  const missing = [...referenced].filter((field) => !CONSTANT_FIELDS.includes(field));

  assert.deepEqual(
    missing,
    ["someUnlistedField"],
    "extractJobFieldReferences over a fixture with one known + one unlisted job.<field> reference must " +
      "report exactly the unlisted one as missing from JOB_DOCUMENT_FIELDS",
  );
});
