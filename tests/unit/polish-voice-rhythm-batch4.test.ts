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
        // The primary is the quick read; sealed AI reads only what it misses,
        // with no download or consent step (2026-10-11).
        assert.match(src, /Read my résumé/);
        assert.doesNotMatch(src, /Download model & parse/);
        assert.doesNotMatch(src, /resume-import-use-model/);
        assert.doesNotMatch(src, /resume-import-download-parse/);
        assert.doesNotMatch(src, /consentDecided \?/);
        const privacy = sliceBetween(src, "const renderPrivacyConsent", "const renderInputStep");
        assert.doesNotMatch(privacy, /<Button[\s\S]*Download and parse/);
        const footer = sliceBetween(src, 'data-testid="resume-import-parse-primary"', "onClick={handleParse}");
        assert.ok(footer.length > 0);
    });

    it("signed-out upload and use-model controls take their height from the control scale (44px touch = hit area)", () => {
        const resume = readFileSync(join(ROOT, "src/app/resume/page.tsx"), "utf8");
        const uploadTestId = 'data-testid="resume-signed-out-upload"';
        const uploadIdx = resume.indexOf(uploadTestId);
        assert.notStrictEqual(uploadIdx, -1, uploadTestId);
        const uploadButtonStart = resume.lastIndexOf("<Button", uploadIdx);
        assert.notStrictEqual(uploadButtonStart, -1, "upload Button opener");
        const uploadButtonEnd = resume.indexOf("</Button>", uploadIdx);
        assert.notStrictEqual(uploadButtonEnd, -1, "upload Button closer");
        const uploadButton = resume.slice(uploadButtonStart, uploadButtonEnd);
        // md, the Button default: the 44px step is for fields and the /jobs
        // Search submit only (2026-09-29, tests/unit/control-type.test.ts).
        assert.doesNotMatch(uploadButton, /\bsize="(?:icon-)?lg"/);
        assert.match(uploadButton, /resume-signed-out-upload/);

        const strip = readFileSync(join(ROOT, "src/components/resume-builder/ModelEnhancementStrip.tsx"), "utf8");
        const skipTestId = 'data-testid="resume-model-skip"';
        const skipIdx = strip.indexOf(skipTestId);
        assert.notStrictEqual(skipIdx, -1, skipTestId);
        const skipButtonStart = strip.lastIndexOf("<Button", skipIdx);
        const skipButtonEnd = strip.indexOf("</Button>", skipIdx);
        const skipButton = strip.slice(skipButtonStart, skipButtonEnd);
        assert.match(skipButton, /size="link"/);
        assert.doesNotMatch(skipButton, /min-h-/);
        assert.match(skipButton, /variant="link"/);
    });
});

describe("Phase 2 batch 4 — auth retry", () => {
    it("generic honest copy — owner body, distinct Start again button", () => {
        assert.equal(AUTH_RETRY_HEADLINE, "We couldn't finish signing you in");
        assert.equal(
            AUTH_RETRY_BODY,
            "It happens sometimes. Try again and you'll be right back where you were.",
        );
        assert.equal(AUTH_RETRY_BUTTON_LABEL, "Start again");
        assert.notEqual(AUTH_RETRY_BODY.trim(), AUTH_RETRY_BUTTON_LABEL);
        assert.doesNotMatch(AUTH_RETRY_BODY, /Start again/i);
        assert.match(AUTH_RETRY_BODY, /Try again/i);
    });

    it("client uses copy module — no literal retry copy in source", () => {
        const src = readFileSync(join(ROOT, "src/app/auth/retry/auth-retry-client.tsx"), "utf8");
        assert.match(src, /AUTH_RETRY_BODY/);
        assert.match(src, /AUTH_RETRY_BUTTON_LABEL/);
        assert.match(src, /AUTH_RETRY_HEADLINE/);
        assert.doesNotMatch(src, /searchParams\.get\(["']reason["']\)/);
        assert.equal((src.match(/Try again/g) ?? []).length, 0);
        assert.equal((src.match(/Start again/g) ?? []).length, 0);
        assert.equal((src.match(/That sign-in link expired/g) ?? []).length, 0);
    });
});

describe("Phase 2 batch 4 — marketing TopBar", () => {
    it("every signed-out surface (lean /jobs and marketing alike): ghost Sign in + filled Create account", () => {
        const src = readFileSync(TOPBAR, "utf8");
        assert.equal(src.match(/data-testid="topbar-signin"/g)?.length, 1, "exactly one signed-out Sign in — no per-surface variant");
        assert.doesNotMatch(src, /\) : leanSurface \?/, "no lean-surface auth branch");

        const marketingSignIn = topBarAuthButtonBlock(src, "topbar-signin", 0);
        assert.match(marketingSignIn, /variant="ghost"/);
        assert.match(marketingSignIn, /setAuthTab\("login"\)/);

        const marketingCreate = topBarAuthButtonBlock(src, "topbar-create-account", 0);
        assert.match(marketingCreate, /Create account/);
        assert.match(marketingCreate, /setAuthTab\("signup"\)/);
        assert.doesNotMatch(marketingCreate, /variant="ghost"/);

        assert.doesNotMatch(src, /topbar-alerts-cta/);
    });

    it("e2e helper targets the TopBar Sign in on lean surfaces", () => {
        const src = readFileSync(join(ROOT, "tests/e2e/helpers/signed-out-auth-entry.ts"), "utf8");
        assert.match(src, /topbar-signin/);
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
            ["topbar signed-out branches", sliceBetween(topbar, 'authChrome === "pending"', "                    )}")],
        ];

        const offenders: string[] = [];
        for (const [label, block] of scopes) {
            for (const token of findOffRhythmClasses(block)) {
                offenders.push(`${label}: ${token}`);
            }
        }
        assert.deepEqual(offenders, [], `off-rhythm in batch-4 blocks: ${offenders.join("; ")}`);
    });

    it("tracker stage rail is the shared tab primitive", () => {
        const src = readFileSync(join(ROOT, "src/components/tracker/TrackerKanbanBoard.tsx"), "utf8");
        assert.match(src, /tracker-stage-rail/);
        assert.match(src, /<TabNav/);
        assert.match(src, /<TabItem/);
    });
});
