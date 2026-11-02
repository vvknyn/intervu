/**
 * Interaction §9 (docs/design-language.md): one behaviour per kind of interaction, modelled on how Claude's phone
 * and desktop apps keep one language. Each test pins a class, not an instance: a new overlay, row or inline action
 * that brings its own motion, header, close, corner or link style fails here.
 *
 * Measured before (2026-11-02, phone, /jobs and sign-in): the three phone drawers opened in 150ms, 500ms and with no
 * animation, under three header layouts; Dialog titles were 18px and Sheet titles 16px; three different × buttons;
 * the combobox never animated out; 41 inline text actions in three styles; rows, chips and tabs gave no press feedback.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(join(ROOT, dir))) {
        const rel = join(dir, name);
        const st = statSync(join(ROOT, rel));
        if (st.isDirectory()) out.push(...tsxFiles(rel));
        else if (rel.endsWith(".tsx")) out.push(rel);
    }
    return out;
}
const APP_FILES = tsxFiles("src").filter((f) => !f.includes("/mock/") && !f.includes("/mocks/") && !f.startsWith("src/components/ui/"));

describe("one motion per kind of overlay", () => {
    const MODAL = ["src/components/ui/sheet.tsx", "src/components/ui/dialog.tsx", "src/lib/toast.tsx"];
    const POP = ["src/components/ui/popover.tsx", "src/components/ui/dropdown-menu.tsx", "src/components/ui/select.tsx", "src/components/ui/combobox.tsx", "src/components/ui/tooltip.tsx"];

    it("every modal surface and its scrim move with motion-modal, and nothing else sets their timing", () => {
        for (const f of MODAL) {
            const src = read(f);
            const animated = src.split("\n").filter((l) => /\banimate-in\b|data-\[state=open\]:animate-in/.test(l));
            assert.ok(animated.length > 0, `${f}: no animated surface found`);
            for (const l of animated) assert.match(l, /\bmotion-modal\b/, `${f}: an animated surface without motion-modal:\n${l.trim()}`);
            assert.doesNotMatch(src, /data-\[state=(open|closed)\]:duration-\d/, `${f}: a fixed duration on a modal surface`);
        }
    });

    it("every popover surface moves with motion-pop", () => {
        for (const f of POP) {
            const src = read(f);
            const animated = src.split("\n").filter((l) => /\banimate-in\b/.test(l));
            assert.ok(animated.length > 0, `${f}: no animated surface found`);
            for (const l of animated) assert.match(l, /\bmotion-pop\b/, `${f}: an animated surface without motion-pop:\n${l.trim()}`);
        }
        // The combobox animated in but never out.
        assert.match(read("src/components/ui/combobox.tsx"), /data-\[exiting\]:animate-out/);
    });

    it("both expanders take one timing", () => {
        assert.match(read("src/components/ui/accordion.tsx"), /motion-expand/);
        const css = read("src/app/globals.css");
        assert.match(css, /details\[data-slot="disclosure"\]::details-content\s*\{[^}]*transition:[^}]*var\(--transition-panel\)/);
    });

    it("no overlay call site sets its own corner or motion", () => {
        const OPEN = /<(SheetContent|DialogContent|AlertDialogContent|PopoverContent|DropdownMenuContent|SelectContent|TooltipContent)\b([\s\S]*?)>/g;
        const BANNED = /(?:^|\s)(?:[a-z-]+:)*(rounded-[a-z0-9[\]()-]+|duration-[^\s"]+|ease-[^\s"]+|animate-[^\s"]+|slide-(?:in|out)-[^\s"]+|zoom-(?:in|out)-[^\s"]+|fade-(?:in|out)-[^\s"]+)/;
        const offenders: string[] = [];
        for (const f of APP_FILES) {
            const src = read(f);
            for (const m of src.matchAll(OPEN)) {
                const tag = m[0];
                if (/glass-exempt:/.test(src.slice(Math.max(0, (m.index ?? 0) - 300), m.index))) continue;
                const cls = /className=(?:"([^"]*)"|\{[^}]*?"([^"]*)")/.exec(tag);
                const value = cls ? cls[1] ?? cls[2] ?? "" : "";
                const hit = BANNED.exec(value);
                if (hit) offenders.push(`${f}: <${m[1]}> ${hit[1]}`);
            }
        }
        assert.deepEqual(offenders, [], "the primitive owns an overlay's corner and motion (Interaction §9)");
    });
});

describe("one drawer: one header, one ×, one title size", () => {
    it("only the primitives draw a grabber: a sheet's header is SheetBar, not a hand-built row", () => {
        const handBuilt = APP_FILES.filter((f) => /<SheetHandle\b/.test(read(f)));
        assert.deepEqual(handBuilt, [], "use <SheetBar> (labelled={false} / onClose when the sheet names or closes itself)");
    });

    it("the Sheet bar's × and the Dialog's × are one class", () => {
        const sheet = read("src/components/ui/sheet.tsx");
        const dialog = read("src/components/ui/dialog.tsx");
        assert.match(sheet, /export const overlayCloseClass\s*=/);
        const closes = [...sheet.matchAll(/<SheetPrimitive\.Close\b[^>]*>/g), ...dialog.matchAll(/<DialogPrimitive\.Close\b[^>]*aria-label="Close"[^>]*>/g)];
        assert.ok(closes.length >= 3, `expected the bar, the default sheet and the dialog ×, found ${closes.length}`);
        for (const c of closes) assert.match(c[0], /overlayCloseClass/, `a × that is not the shared one: ${c[0]}`);
    });

    it("a Dialog title is the Sheet bar's title: 16px semibold, left-aligned at every width", () => {
        const dialog = read("src/components/ui/dialog.tsx");
        assert.match(dialog, /export const dialogTitleClass = "text-base leading-snug font-semibold"/);
        assert.match(read("src/components/ui/sheet.tsx"), /className="line-clamp-2 text-base font-semibold leading-snug text-foreground">\{title\}/);
        assert.doesNotMatch(dialog, /text-center sm:text-left/);
    });
});

describe("one press, one row, one inline action", () => {
    it("everything tapped that is not a Button answers the press", () => {
        const css = read("src/app/globals.css");
        assert.match(css, /@utility press-fill \{[\s\S]*?:active/);
        assert.match(css, /@utility list-row \{[\s\S]*?&:active/);
        for (const f of ["src/components/ui/chip.tsx", "src/components/ui/tabs.tsx", "src/components/ui/disclosure.tsx", "src/components/ui/accordion.tsx", "src/components/layout/MobileTabBar.tsx", "src/components/ui/sheet.tsx"]) {
            assert.match(read(f), /\bpress-fill\b/, `${f} has no press state`);
        }
    });

    it("every tappable list row is a list-row", () => {
        const ROWS: Array<[string, string]> = [
            ["src/components/jobs/JobCard.tsx", "job-row"],
            ["src/app/yours/history/page.tsx", "history-row"],
            ["src/components/jobs/JobDetail.tsx", "related-job-row"],
            ["src/components/tracker/PursuitListRow.tsx", "pursuit-row"],
            ["src/components/follows/FollowAlertsDialog.tsx", "follow-alert-row"],
        ];
        for (const [f, id] of ROWS) assert.match(read(f), /\blist-row\b/, `${f} (${id}) draws its own row`);
    });

    it("an inline text action is text-action, never a hand-mixed colour and underline", () => {
        const offenders: string[] = [];
        for (const f of [...APP_FILES, "src/components/ui/button.tsx", "src/lib/toast.tsx"]) {
            read(f).split("\n").forEach((line, i) => {
                for (const m of line.matchAll(/"([^"\n]*)"/g)) {
                    const toks = m[1].split(/\s+/);
                    if (toks.includes("hover:underline") && (toks.includes("text-brand") || toks.includes("text-live"))) offenders.push(`${f}:${i + 1}`);
                }
            });
        }
        assert.deepEqual(offenders, [], "use `text-action` (globals.css)");
    });
});
