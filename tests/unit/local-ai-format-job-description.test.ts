import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    buildDeterministicJdTemplate,
    buildJdFormatPrompt,
    hashJobDescription,
    jdSearchIndexSnippet,
    jdTemplateFilledSectionCount,
    jdTemplateFilledSectionCount,
    jdTemplateHasContent,
    jdTemplateIsThin,
    resetJdFormatCacheForTests,
    resolveJdTemplateSync,
    JD_TEMPLATE_LABELS,
    JD_TEMPLATE_ORDER,
} from "../../src/lib/local-ai/format-job-description";

describe("format-job-description (on-device JD template)", () => {
    beforeEach(() => {
        resetJdFormatCacheForTests();
    });

    it("exposes stable emoji section labels for every template key", () => {
        for (const key of JD_TEMPLATE_ORDER) {
            assert.ok(JD_TEMPLATE_LABELS[key].length > 0);
            assert.match(JD_TEMPLATE_LABELS[key], /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
        }
        assert.equal(JD_TEMPLATE_LABELS.hook, "✨ The role");
        assert.equal(JD_TEMPLATE_LABELS.do, "🎯 What you'll do");
        assert.equal(JD_TEMPLATE_LABELS.bring, "🧠 What you bring");
        assert.equal(JD_TEMPLATE_LABELS.nice, "🌱 Nice to have");
        assert.equal(JD_TEMPLATE_LABELS.perks, "🎁 Perks");
    });

    it("maps a classic ATS dump into the shared template buckets", () => {
        const raw = [
            "About the role:",
            "We are hiring a platform engineer to own our API gateway.",
            "",
            "Responsibilities:",
            "- Design and ship gateway features",
            "- Mentor junior engineers",
            "",
            "Requirements:",
            "- 5+ years of TypeScript",
            "- Experience with Kubernetes",
            "",
            "Nice to have:",
            "- Rust familiarity",
            "",
            "Benefits:",
            "- Remote-friendly stipend",
            "- Learning budget",
        ].join("\n");

        const t = buildDeterministicJdTemplate(raw);
        assert.ok(jdTemplateHasContent(t));
        assert.ok(t.hook[0]?.text?.toLowerCase().includes("platform engineer") || t.hook[0]?.text?.toLowerCase().includes("api"));
        assert.ok(t.do.length > 0, "expected do section");
        assert.ok(t.bring.length > 0, "expected bring section");
        assert.ok(t.nice.length > 0, "expected nice section");
        assert.ok(t.perks.length > 0, "expected perks section");
    });

    it("keeps a one-line hook and never returns empty for non-empty source", () => {
        const t = buildDeterministicJdTemplate(
            "Join our team building delightful tools for recruiters worldwide. You will own the roadmap.",
        );
        assert.equal(t.hook.length, 1);
        assert.equal(t.hook[0]?.type, "para");
        assert.ok((t.hook[0]?.text?.length ?? 0) > 10);
        assert.ok(jdTemplateHasContent(t));
    });

    it("hash is stable for identical content and changes when content changes", () => {
        const a = hashJobDescription("Hello world");
        const b = hashJobDescription("Hello world");
        const c = hashJobDescription("Hello world!");
        assert.equal(a, b);
        assert.notEqual(a, c);
    });

    it("resolveJdTemplateSync returns empty for blank input", () => {
        const r = resolveJdTemplateSync("job-1", "   ");
        assert.equal(r.source, "empty");
        assert.equal(jdTemplateHasContent(r.template), false);
    });

    it("buildJdFormatPrompt asks for JSON template and excludes salary/location chrome", () => {
        const prompt = buildJdFormatPrompt("Build APIs. Need 3 years Go. Salary $200k. Location NYC.");
        assert.match(prompt, /Return JSON only/);
        assert.match(prompt, /"hook"/);
        assert.match(prompt, /"do"/);
        assert.match(prompt, /"bring"/);
        assert.match(prompt, /No company name, salary, or location/);
        assert.match(prompt, /Build APIs/);
    });

    it("skips EEO / company-about walls so they do not flood the hook", () => {
        const raw = [
            "About the role:",
            "Own the billing ledger end to end.",
            "",
            "Equal Opportunity:",
            "We are an equal opportunity employer and do not discriminate.",
            "",
            "Responsibilities:",
            "- Ship ledger migrations",
        ].join("\n");
        const t = buildDeterministicJdTemplate(raw);
        const hook = t.hook[0]?.text ?? "";
        assert.doesNotMatch(hook.toLowerCase(), /equal opportunity/);
        assert.ok(t.do.length > 0);
    });

    it("synthesizes a hook when the ATS dump has no About section", () => {
        const t = buildDeterministicJdTemplate(
            "Requirements:\n\n- 5+ years shipping APIs\n\n- Strong TypeScript",
        );
        assert.equal(t.hook.length, 1);
        assert.ok((t.hook[0]?.text?.length ?? 0) > 5);
        assert.ok(t.bring.length > 0);
    });

    it("keeps leftover hook sentences in do instead of discarding a mega-paragraph", () => {
        const raw =
            "Caseware seeks a PM. Own the roadmap end to end. Partner with engineering and design. Need 5 years of B2B SaaS product management.";
        const t = buildDeterministicJdTemplate(raw);
        assert.equal(t.hook.length, 1);
        assert.match(t.hook[0]?.text ?? "", /Caseware seeks a PM/i);
        assert.ok(t.do.length > 0, "expected leftover body folded into do");
        assert.equal(jdTemplateIsThin(t, raw), false);
    });

    it("marks hook-only templates as thin so the postcard can soft-fail", () => {
        const thin = {
            hook: [{ type: "para" as const, text: "A short role pitch only." }],
            do: [],
            bring: [],
            nice: [],
            perks: [],
        };
        assert.equal(jdTemplateIsThin(thin, "A short role pitch only. Lots more body text that was lost in formatting somehow and should trigger soft-fail."), true);
        assert.ok(jdSearchIndexSnippet("Hello world. More detail here about the role and team.").includes("Hello"));
    });

    it("maps Greenhouse whitespace-blank HelloFresh-style dumps into multi-section template (not thin)", () => {
        const raw = [
            "The role",
            " ",
            "HelloFresh's Onboarding squad owns the highest-leverage window in the customer lifecycle: from the moment a prospect converts to the moment they become a settled, loyal customer.",
            " ",
            "We are hiring a Staff Product Manager to lead the Onboarding squad and define the product vision for how HelloFresh guides new customers.",
            " ",
            "What you'll do",
            " ",
            "Own the product vision and strategy for the end-to-end Onboarding experience.",
            "Lead the build and scaling of the Next Best Action framework.",
            " ",
            "What you'll bring",
            " ",
            "Customer Lifecycle Expertise: A deep understanding of subscription dynamics.",
            "Growth Experimentation at Scale: 6+ years of PM experience at Senior or Staff level.",
            " ",
            "What we offer",
            " ",
            "Health & Dental benefits from day 1.",
            "Amazing discounts on weekly meal kits.",
        ].join("\n");
        const t = buildDeterministicJdTemplate(raw);
        assert.equal(jdTemplateIsThin(t, raw), false);
        assert.ok(t.hook.length > 0);
        assert.ok(t.do.length > 0, "expected do section from What you'll do");
        assert.ok(t.bring.length > 0, "expected bring section from What you'll bring");
        assert.ok((t.hook[0]?.text ?? "").includes("HelloFresh"));
    });

    it("does not mark a 2-section 400+ char template thin just because raw is long", () => {
        const body = "We ship gateway features for enterprise customers across regions with strong reliability focus. ".repeat(6);
        const padding = "More body about the platform, reliability, and on-call that pads the source length. ".repeat(30);
        const raw = `About the role:\n${body}\n\nResponsibilities:\n- Ship APIs end to end with clear ownership\n- Mentor junior engineers on the gateway squad\n- Partner with SRE on latency budgets\n\n${padding}`;
        const t = buildDeterministicJdTemplate(raw);
        assert.ok(jdTemplateFilledSectionCount(t) >= 2);
        assert.equal(jdTemplateIsThin(t, raw), false);
    });

});
