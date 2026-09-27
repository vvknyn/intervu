import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    AUTH_RETRY_BODY,
    AUTH_RETRY_BUTTON_LABEL,
    AUTH_RETRY_HEADLINE,
} from "../../src/lib/auth/auth-retry-copy";
import {
    RESUME_PAGE_HEADLINE,
    RESUME_SIGNED_OUT_EMPTY_TITLE,
} from "../../src/lib/jobs/resume-privacy-copy";
import {
    TRACKER_PAGE_SUBCOPY,
    TRACKER_PRIMARY_CTA,
} from "../../src/lib/pursuits/tracker-voice-copy";
import { pursuitRowMetaItems } from "../../src/lib/pursuits/tracker-display";
import type { Pursuit } from "../../src/lib/pursuits/types";

const ROOT = join(__dirname, "..", "..");
const TOPBAR = join(ROOT, "src/components/layout/TopBar.tsx");
const IMPORT_MODAL = join(ROOT, "src/components/resume-builder/ResumeImportModal.tsx");

/** Tailwind spacing steps off the 4/8 rhythm — fresh `g` flag per scan. */
function findOffRhythmClasses(src: string): string[] {
    const re =
        /\b(?:gap|p|px|py|pt|pb|pl|pr|m|mx|my|ml|mr|mt|mb|left|right|top|bottom|scroll-pl|scroll-px)-(?:0\.5|1\.5|2\.5|3\.5|5\.5|6\.5|7\.5|9\.5|10\.5|11\.5)\b/g;
    return [...src.matchAll(re)].map((m) => m[0]);
}

function sliceBetween(src: string, start: string, end: string): string {
    const from = src.indexOf(start);
    assert.notStrictEqual(from, -1, `start marker ${start} not found`);
    const to = src.indexOf(end, from + start.length);
    assert.notStrictEqual(to, -1, `end marker ${end} not found after ${start}`);
    return src.slice(from, to);
}

function topBarAuthButtonBlock(src: string, testId: string, occurrence: number): string {
    let from = 0;
    let idx = -1;
    for (let i = 0; i <= occurrence; i++) {
        idx = src.indexOf(`data-testid="${testId}"`, from);
        assert.notStrictEqual(idx, -1, `${testId} occurrence ${i} missing`);
        from = idx + 1;
    }
    return src.slice(Math.max(0, idx - 160), idx + 480);
}

function signedOutTopBarBranches(src: string): { lean: string; marketing: string } {
    const leanStart = src.indexOf(") : leanSurface ?");
    assert.notStrictEqual(leanStart, -1, "leanSurface branch missing");
    const marketingStart = src.indexOf(") : (", leanStart);
    assert.notStrictEqual(marketingStart, -1, "marketing branch missing");
    const marketingEnd = src.indexOf("                    )}", marketingStart);
    assert.notStrictEqual(marketingEnd, -1, "marketing branch end missing");
    return {
        lean: src.slice(leanStart, marketingStart),
        marketing: src.slice(marketingStart, marketingEnd),
    };
}

describe("Phase 2 batch 4 — tracker voice", () => {
    it("subcopy carries journey and applicant control in warm voice", () => {
        assert.match(TRACKER_PAGE_SUBCOPY, /from saved to offer/i);
        assert.match(TRACKER_PAGE_SUBCOPY, /You decide what gets sent/i);
        assert.doesNotMatch(TRACKER_PAGE_SUBCOPY, /records|Agent drafts|submissions/i);
    });

    it("yours page wires voice copy and CTA hierarchy (#615 may touch same file on rebase)", () => {
        const src = readFileSync(join(ROOT, "src/app/yours/page.tsx"), "utf8");
        assert.match(src, /TRACKER_PAGE_SUBCOPY/);
        assert.match(src, /tracker-track-role-cta/);
        assert.match(src, /variant="ghost"/);
        assert.doesNotMatch(src, /Your records — not submissions/);
        assert.equal(TRACKER_PRIMARY_CTA, "Track a role");
    });

    it("pursuitRowMetaItems suppresses 0d-in-tracker and no-résumé dead values", () => {
        const now = Date.parse("2026-06-01T12:00:00.000Z");
        const created = new Date(now).toISOString();
        const p: Pursuit = {
            id: "p1",
            user_id: "u1",
            company_name: "Acme",
            position: "Engineer",
            status: "applied",
            created_at: created,
            updated_at: created,
        };
        assert.deepEqual(pursuitRowMetaItems(p, now), []);
        const older = pursuitRowMetaItems(
            { ...p, created_at: new Date(now - 2 * 86_400_000).toISOString() },
            now,
        );
        assert.ok(older.some((line) => line.includes("d in tracker")));
        assert.ok(!older.some((line) => line.includes("no résumé")));
    });
});

describe("Phase 2 batch 4 — résumé funnel", () => {
    it("signed-out empty title is secondary to the page headline", () => {
        assert.notEqual(RESUME_SIGNED_OUT_EMPTY_TITLE, RESUME_PAGE_HEADLINE);
        const src = readFileSync(join(ROOT, "src/app/resume/page.tsx"), "utf8");
        assert.match(src, /RESUME_SIGNED_OUT_EMPTY_TITLE/);
        const emptyBlock = src.slice(src.indexOf("SignedOutEmptyState"), src.indexOf("function ResumeContent"));
        assert.doesNotMatch(emptyBlock, /title=\{RESUME_PAGE_HEADLINE\}/);
    });

    it("import modal keeps footer parse primary immediately — no gated consent step", () => {
        const src = readFileSync(IMPORT_MODAL, "utf8");
        assert.match(src, /resume-import-parse-primary/);
        assert.match(src, /Download model & parse/);
        assert.match(src, /resume-import-skip-download/);
        assert.doesNotMatch(src, /resume-import-download-parse/);
        assert.doesNotMatch(src, /consentDecided \?/);
        const privacy = sliceBetween(src, "const renderPrivacyConsent", "const renderInputStep");
        assert.doesNotMatch(privacy, /<Button[\s\S]*Download and parse/);
        const footer = sliceBetween(src, 'data-testid="resume-import-parse-primary"', "onClick={handleParse}");
        assert.ok(footer.length > 0);
    });

    it("signed-out upload and skip-download controls meet 44px touch targets", () => {
        const resume = readFileSync(join(ROOT, "src/app/resume/page.tsx"), "utf8");
        const uploadTestId = 'data-testid="resume-signed-out-upload"';
        const uploadIdx = resume.indexOf(uploadTestId);
        assert.notStrictEqual(uploadIdx, -1, uploadTestId);
        const uploadButtonStart = resume.lastIndexOf("<Button", uploadIdx);
        assert.notStrictEqual(uploadButtonStart, -1, "upload Button opener");
        const uploadButtonEnd = resume.indexOf("</Button>", uploadIdx);
        assert.notStrictEqual(uploadButtonEnd, -1, "upload Button closer");
        const uploadButton = resume.slice(uploadButtonStart, uploadButtonEnd);
        assert.match(uploadButton, /size="lg"/);
        assert.match(uploadButton, /min-h-11/);
        assert.match(uploadButton, /resume-signed-out-upload/);

        const modal = readFileSync(IMPORT_MODAL, "utf8");
        const skipTestId = 'data-testid="resume-import-skip-download"';
        const skipIdx = modal.indexOf(skipTestId);
        assert.notStrictEqual(skipIdx, -1, skipTestId);
        const skipButtonStart = modal.lastIndexOf("<Button", skipIdx);
        const skipButtonEnd = modal.indexOf("</Button>", skipIdx);
        const skipButton = modal.slice(skipButtonStart, skipButtonEnd);
        assert.match(skipButton, /min-h-11/);
        assert.match(skipButton, /variant="link"/);
    });
});

describe("Phase 2 batch 4 — auth retry", () => {
    it("body is explanatory and does not duplicate the button label", () => {
        assert.notEqual(AUTH_RETRY_BODY.trim(), AUTH_RETRY_BUTTON_LABEL);
        assert.doesNotMatch(AUTH_RETRY_BODY, /Try again/i);
        assert.equal(AUTH_RETRY_BUTTON_LABEL, "Try again");
    });

    it("client uses copy module — no literal Try again in source", () => {
        const src = readFileSync(join(ROOT, "src/app/auth/retry/auth-retry-client.tsx"), "utf8");
        assert.match(src, /AUTH_RETRY_BODY/);
        assert.match(src, /AUTH_RETRY_BUTTON_LABEL/);
        assert.equal((src.match(/Try again/g) ?? []).length, 0);
        assert.equal(AUTH_RETRY_HEADLINE, "That sign-in link expired");
    });
});

describe("Phase 2 batch 4 — marketing TopBar", () => {
    it("lean /jobs: filled Sign in only; marketing: ghost Sign in + Create account", () => {
        const src = readFileSync(TOPBAR, "utf8");
        const { lean } = signedOutTopBarBranches(src);
        assert.match(lean, /topbar-signin/);
        assert.doesNotMatch(lean, /topbar-create-account/);
        assert.doesNotMatch(lean, /variant="ghost"/);

        const leanSignIn = topBarAuthButtonBlock(src, "topbar-signin", 0);
        assert.doesNotMatch(leanSignIn, /variant="ghost"/);
        assert.match(leanSignIn, /setAuthTab\("login"\)/);

        const marketingSignIn = topBarAuthButtonBlock(src, "topbar-signin", 1);
        assert.match(marketingSignIn, /variant="ghost"/);
        assert.match(marketingSignIn, /setAuthTab\("login"\)/);

        const marketingCreate = topBarAuthButtonBlock(src, "topbar-create-account", 0);
        assert.match(marketingCreate, /Create account/);
        assert.match(marketingCreate, /setAuthTab\("signup"\)/);
        assert.doesNotMatch(marketingCreate, /variant="ghost"/);

        assert.doesNotMatch(src, /topbar-alerts-cta/);
    });

    it("e2e helper targets visible Concept A Sign in before TopBar on lean surfaces", () => {
        const src = readFileSync(join(ROOT, "tests/e2e/helpers/signed-out-auth-entry.ts"), "utf8");
        assert.match(src, /concept-a-sign-in/);
        assert.match(src, /visibleSignInLocator/);
        assert.match(src, /marketingTopBarCreateAccount/);
    });
});

describe("Phase 2 batch 4 — 4/8 rhythm on changed blocks", () => {
    it("batch-4 UI blocks avoid new half-step spacing utilities", () => {
        const yours = readFileSync(join(ROOT, "src/app/yours/page.tsx"), "utf8");
        const kanban = readFileSync(join(ROOT, "src/components/tracker/TrackerKanbanBoard.tsx"), "utf8");
        const importModal = readFileSync(IMPORT_MODAL, "utf8");
        const retry = readFileSync(join(ROOT, "src/app/auth/retry/auth-retry-client.tsx"), "utf8");
        const topbar = readFileSync(TOPBAR, "utf8");

        const scopes: Array<[string, string]> = [
            ["yours header actions", sliceBetween(yours, "tracker-track-role-cta", "TrackerTabs")],
            ["tracker stage rail", sliceBetween(kanban, 'data-testid="tracker-stage-rail"', "</div>")],
            ["import privacy block", sliceBetween(importModal, "const renderPrivacyConsent", "const renderInputStep")],
            [
                "import footer primary",
                sliceBetween(importModal, 'data-testid="resume-import-parse-primary"', "onClick={handleParse}"),
            ],
            ["auth retry panel", retry],
            ["topbar signed-out branches", signedOutTopBarBranches(topbar).lean + signedOutTopBarBranches(topbar).marketing],
        ];

        const offenders: string[] = [];
        for (const [label, block] of scopes) {
            for (const token of findOffRhythmClasses(block)) {
                offenders.push(`${label}: ${token}`);
            }
        }
        assert.deepEqual(offenders, [], `off-rhythm in batch-4 blocks: ${offenders.join("; ")}`);
    });

    it("tracker stage rail uses 44px targets and scroll snap", () => {
        const src = readFileSync(join(ROOT, "src/components/tracker/TrackerKanbanBoard.tsx"), "utf8");
        assert.match(src, /tracker-stage-rail/);
        assert.match(src, /snap-x snap-mandatory/);
        assert.match(src, /min-h-11/);
    });
});
