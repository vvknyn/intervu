import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPLY_BUTTON_LABEL } from "@/components/jobs/job-detail-facts";

const JOB_DETAIL = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetail.tsx");
const JOB_PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "[slug]", "page.tsx");
const JOB_DOCUMENT = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetailDocument.tsx");

/**
 * Finds every `job.<field>.length > 0` gate in `src` — the shape a
 * flowing-tag-list section uses to decide whether it has anything to
 * render — whether the field is named directly (`job.tags.length > 0`,
 * the pre-fix bug) or via the shared guard (`visibleTags(job.tags, 16)
 * .length > 0`, the fix). Matches on the SHAPE (any `job.<field>`, any
 * field name) rather than enumerating known section names, so a new
 * sibling section on a different job field is covered automatically.
 */
function findJobArrayLengthGates(src: string): Array<{ raw: string; wrapped: boolean }> {
    const re = /(visibleTags\(job\.\w+(?:,\s*[^)]*)?\)|job\.\w+)\.length\s*>\s*0/g;
    const gates: Array<{ raw: string; wrapped: boolean }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        gates.push({ raw: m[0], wrapped: m[1].startsWith("visibleTags(") });
    }
    return gates;
}

describe("JobDetail guest chrome", () => {
    it("uses one shared Apply label for guests and signed-in users alike", () => {
        // Was: a bare ">Apply<" on the desktop split pane vs. a separately
        // hardcoded "Apply on Company Site" elsewhere in this same file — the
        // exact defect [3] inconsistency this test now guards against. Both
        // sites must read the one exported APPLY_BUTTON_LABEL constant
        // instead of re-typing (a different copy of) its text.
        const src = readFileSync(JOB_DETAIL, "utf8");
        assert.doesNotMatch(src, /Sign in to apply/);
        assert.doesNotMatch(src, />\s*Apply\s*</, "no surface should hardcode a bare, unlabeled Apply string");
        assert.doesNotMatch(src, /"Apply on Company Site"/, "no surface should re-type the label literal instead of importing it");
        assert.match(src, /\{APPLY_BUTTON_LABEL\}/, "every Apply surface must render the shared constant");
        assert.equal(APPLY_BUTTON_LABEL, "Apply on employer site");
    });

    it("save control is the shared row bookmark, not a labeled Save button", () => {
        const src = readFileSync(JOB_DETAIL, "utf8");
        assert.match(src, /RowBookmarkButton/);
        assert.doesNotMatch(src, /goingAfter \? "Saving…" : "Save"/);
    });

    it("the job title is the page heading only on the standalone document", () => {
        // JobDetail mounts inside a page that already owns the h1 (the /jobs
        // masthead, or the company name on /co), so its own title is a
        // section heading, not the page heading. JobDetailDocument is the
        // standalone /jobs/[slug] document and owns the single h1 itself.
        const detail = readFileSync(JOB_DETAIL, "utf8");
        assert.match(
            detail,
            /<h[2-6][^>]*>\{jobTitle\}/,
            "the panel renders the presented (cased, decoded) title as a section heading",
        );
        assert.doesNotMatch(
            detail,
            /<h1\b/,
            "JobDetail only mounts under a page that already owns the h1 (/jobs masthead, /co company name)",
        );

        const doc = readFileSync(JOB_DOCUMENT, "utf8");
        assert.match(
            doc,
            /<h1[^>]*>\{jobTitle\}<\/h1>/,
            "the standalone document's h1 must render the presented title",
        );
        assert.equal(
            (doc.match(/<h1\b/g) ?? []).length,
            1,
            "the standalone document must own exactly one h1",
        );

        const page = readFileSync(JOB_PAGE, "utf8");
        assert.doesNotMatch(page, /<h1[^>]*>\s*\{job\.title\}/);
    });

    it("mounts every job-detail block exactly once (no parallel mobile/desktop copies)", () => {
        // Each block used to be referenced once in a `lg:hidden` mobile stack
        // AND once in a `hidden lg:grid` desktop grid — both mounted, so the
        // served HTML (and every effect inside these blocks) doubled. A
        // single CSS-reordered render must reference each block exactly once.
        const doc = readFileSync(JOB_DOCUMENT, "utf8");
        for (const block of ["heroEl", "applyCardEl", "receiptEl", "postingEl", "employerCardEl", "aiBoxEl"]) {
            const uses = doc.match(new RegExp(`\\{${block}\\}`, "g")) ?? [];
            assert.equal(uses.length, 1, `{${block}} must be referenced exactly once — a second reference re-mounts the block`);
        }
        // relatedEl is the one block that legitimately renders in two
        // different reading-order positions (closed vs. open jobs), but the
        // two uses must be mutually exclusive on `closed`, never both mounted.
        const relatedUses = doc.match(/\{relatedEl\}/g) ?? [];
        assert.equal(relatedUses.length, 2, "{relatedEl} must appear in exactly two guarded positions");
        assert.match(doc, /\{closed && <div[^>]*>\{relatedEl\}<\/div>\}/, "one relatedEl use must be gated on closed");
        assert.match(doc, /\{!closed && <div[^>]*>\{relatedEl\}<\/div>\}/, "the other relatedEl use must be gated on !closed");
    });

    it("every flowing-tag-list section gates on visibleTags, not a raw array's .length", () => {
        // Was: `job.tags && job.tags.length > 0` — true even when every entry
        // decodes to a blank string, which rendered "Keywords from the
        // posting" (or "Must-have skills") as a heading over nothing. One
        // guard (`visibleTags(...).length > 0`) now covers every sibling
        // section instead of each one re-deriving its own raw-array check.
        //
        // Detection is by SHAPE, not by naming "tags"/"must_have_skills": any
        // `job.<field>.length > 0` gate (bare or visibleTags-wrapped) is a
        // flowing-tag-list render, whatever the field is called — so a third
        // sibling section added later, on a different job field, is covered
        // by construction instead of needing this test updated by hand.
        for (const [label, file] of [
            ["JobDetailDocument.tsx", JOB_DOCUMENT],
            ["JobDetail.tsx", JOB_DETAIL],
        ] as const) {
            const src = readFileSync(file, "utf8");
            const gates = findJobArrayLengthGates(src);
            assert.ok(gates.length > 0, `${label}: expected at least one job.<field>.length gate, found none — is the scanner still matching this file's shape?`);
            for (const gate of gates) {
                assert.ok(gate.wrapped, `${label}: unwrapped raw-array gate found (must route through visibleTags): ${gate.raw}`);
            }
        }
    });

    it("negative fixture: the same gate-shape scan flags an unwrapped tag section, proving it isn't vacuously true", () => {
        const unwrapped = `
            {job.certifications && job.certifications.length > 0 && (
                <div>{job.certifications.join(" · ")}</div>
            )}
        `;
        const gates = findJobArrayLengthGates(unwrapped);
        assert.equal(gates.length, 1);
        assert.throws(() => {
            for (const gate of gates) {
                assert.ok(gate.wrapped, `unwrapped raw-array gate found: ${gate.raw}`);
            }
        }, /unwrapped raw-array gate found/);
    });
});
