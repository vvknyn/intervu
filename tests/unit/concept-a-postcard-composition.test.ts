import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    CONCEPT_A_POSTCARD_CLASS,
    CONCEPT_A_POSTCARD_STACK_CLASS,
    POSTCARDS,
} from "@/components/onboarding/concept-a-postcards";
import {
    extractPostcardCardFunction,
    extractPostcardStackOpenTag,
} from "./concept-a-landing-stack-parse";

const LANDING = join(__dirname, "../../src/components/onboarding/ConceptALandingFace.tsx");
const GLOBALS = join(__dirname, "../../src/app/globals.css");

/** Owner-approved fan — any drift fails CI until owner re-approves. */
const APPROVED_POSTCARD_LAYOUT = [
    { title: "Remote AI Roles", top: "6%", left: "18%", transform: "rotate(-11deg)", zIndex: 1 },
    { title: "Product Designer", top: "18%", left: "48%", transform: "rotate(8deg)", zIndex: 2 },
    { title: "Growth Marketing Lead", top: "52%", left: "42%", transform: "rotate(12deg)", zIndex: 3 },
    { title: "Data Scientist", top: "58%", left: "8%", transform: "rotate(-7deg)", zIndex: 4 },
    { title: "Software Engineer", top: "26%", left: "20%", transform: "rotate(-3deg)", zIndex: 5 },
] as const;

describe("Concept A landing postcard composition (owner-approved)", () => {
    it("exports exactly five POSTCARDS with frozen geometry and z-order", () => {
        assert.equal(POSTCARDS.length, 5, "fan stays five cards");
        for (let i = 0; i < APPROVED_POSTCARD_LAYOUT.length; i++) {
            const approved = APPROVED_POSTCARD_LAYOUT[i];
            const live = POSTCARDS[i];
            assert.equal(live.title, approved.title, `card ${i} title`);
            assert.equal(live.style.top, approved.top, `card ${i} top`);
            assert.equal(live.style.left, approved.left, `card ${i} left`);
            assert.equal(live.style.transform, approved.transform, `card ${i} transform`);
            assert.equal(live.style.zIndex, approved.zIndex, `card ${i} zIndex`);
        }
    });

    it("renders all five postcards with stable indexed test ids (no mobile hide)", () => {
        const src = readFileSync(LANDING, "utf8");
        assert.match(src, /POSTCARDS\.map\(\(card, index\)/, "map passes index for every card");
        assert.match(src, /data-testid=\{`concept-a-postcard-\$\{index\}`\}/, "root test id per card");
        assert.match(src, /data-testid="concept-a-postcard-stack"/, "stack anchor for e2e");
        assert.doesNotMatch(src, /hidden lg:block/, "must not hide postcards below lg");
        assert.doesNotMatch(src, /CONCEPT_A_MOBILE_HIDDEN/, "must not subset mobile fan");
    });

    it("keeps decorative stack presentational for assistive tech", () => {
        const src = readFileSync(LANDING, "utf8");
        const stackOpen = extractPostcardStackOpenTag(src);
        assert.match(stackOpen, /^<div[\s\S]*>$/, "parses full stack opening element");
        assert.match(stackOpen, /data-testid="concept-a-postcard-stack"/, "stack test id on opening tag");
        assert.match(stackOpen, /\baria-hidden\b/, "stack is aria-hidden");
        assert.match(stackOpen, /role="presentation"/, "stack is presentational");
        assert.match(stackOpen, new RegExp(CONCEPT_A_POSTCARD_STACK_CLASS), "stack uses named layout class");
    });

    it("uses named CSS width/translate contract on mobile; lg restores staging card width", () => {
        const src = readFileSync(LANDING, "utf8");
        const cardFn = extractPostcardCardFunction(src);
        assert.match(cardFn, new RegExp(CONCEPT_A_POSTCARD_CLASS), "PostcardCard uses concept-a-postcard class");
        assert.doesNotMatch(cardFn, /w-\[min\(268px/, "card width must not use arbitrary Tailwind");
        assert.doesNotMatch(cardFn, /sm:w-\[260px\]/, "desktop width belongs in globals.css lg rule");

        const globals = readFileSync(GLOBALS, "utf8");
        const mobileStack = globals.match(/\.concept-a-postcard-stack\s*\{[\s\S]*?\}/)?.[0] ?? "";
        assert.match(mobileStack, /--concept-a-postcard-stack-canvas-width:\s*265px/, "mobile canvas 265px");
        assert.match(mobileStack, /--concept-a-postcard-stack-shift-x:\s*-26px/, "mobile stack shift -26px");
        assert.match(mobileStack, /translateX\(var\(--concept-a-postcard-stack-shift-x\)\)/, "uniform stack translate");

        const mobileCard = globals.match(/\.concept-a-postcard\s*\{[\s\S]*?\}/)?.[0] ?? "";
        assert.match(mobileCard, /--concept-a-postcard-width:\s*253px/, "mobile card width 253px");

        const lgBlock =
            globals.match(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.concept-a-postcard-stack[\s\S]*?\}/)?.[0] ??
            "";
        assert.match(lgBlock, /--concept-a-postcard-stack-shift-x:\s*0/, "lg stack shift reset");
        assert.match(lgBlock, /transform:\s*none/, "lg stack transform none");
        assert.match(lgBlock, /width:\s*unset/, "lg stack width defers to layout utilities");

        const lgCard =
            globals.match(
                /@media \(min-width: 1024px\)\s*\{[\s\S]*?\.concept-a-postcard\s*\{[\s\S]*?\}/,
            )?.[0] ?? "";
        assert.match(lgCard, /--concept-a-postcard-width:\s*260px/, "lg card width 260px (staging sm:w-[260px])");
    });
});
