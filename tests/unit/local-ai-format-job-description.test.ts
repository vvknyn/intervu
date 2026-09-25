import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    buildDeterministicJdTemplate,
    buildJdFormatPrompt,
    hashJobDescription,
    jdTemplateHasContent,
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

});
