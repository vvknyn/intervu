import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseFrontMatter, loadCampaign, renderCampaign, type CampaignRecipient, type CampaignSender } from "@/lib/marketing/campaign";

const SITE_URL = "https://velai.app";

const RECIPIENT: CampaignRecipient = {
  email: "person@example.com",
  firstName: "Riley",
  unsubscribeUrl: `${SITE_URL}/unsubscribe?token=abc.def`,
};

const SENDER: CampaignSender = {
  name: "velai",
  postalAddress: "123 Main St, Springfield",
};

describe("parseFrontMatter", () => {
  it("splits a --- delimited block from the markdown body", () => {
    const { data, body } = parseFrontMatter("---\nsubject: Hi\npreheader: There\n---\n\n## Body\n\ntext");
    assert.deepEqual(data, { subject: "Hi", preheader: "There" });
    assert.equal(body, "## Body\n\ntext");
  });

  it("treats content with no front matter as pure body", () => {
    const { data, body } = parseFrontMatter("just some text\nmore text");
    assert.deepEqual(data, {});
    assert.equal(body, "just some text\nmore text");
  });
});

describe("loadCampaign", () => {
  it("loads the real 2026-09-updates content file with required fields", () => {
    const campaign = loadCampaign("2026-09-updates");
    assert.equal(campaign.name, "2026-09-updates");
    assert.ok(campaign.subject.length > 0);
    assert.ok(campaign.preheader.length > 0);
    assert.match(campaign.bodyMarkdown, /\{\{firstName\}\}/);
  });

  it("throws a loud error for a campaign file that doesn't exist, never returns a fake campaign", () => {
    assert.throws(() => loadCampaign("does-not-exist"));
  });
});

describe("renderCampaign", () => {
  const campaign = {
    name: "test",
    subject: "Hi {{firstName}}",
    preheader: "For you, {{firstName}}",
    bodyMarkdown: "Hello {{firstName}}, here's what's new.\n\n[Link](https://velai.app/jobs)",
  };

  it("substitutes {{firstName}} in subject, preheader and body — no unrendered tokens remain", () => {
    const result = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.equal(result.subject, "Hi Riley");
    assert.ok(result.html.includes("Hello Riley"));
    assert.ok(result.text.includes("Hello Riley"));
    assert.ok(!result.html.includes("{{"));
    assert.ok(!result.text.includes("{{"));
  });

  it("falls back to 'there' when firstName is null (not a blank or the literal token)", () => {
    const anonymous: CampaignRecipient = { ...RECIPIENT, firstName: null };
    const result = renderCampaign(campaign, anonymous, SENDER, SITE_URL);
    assert.equal(result.subject, "Hi there");
    assert.ok(!result.html.includes("{{"));
  });

  it("carries the unsubscribe URL into both html and text", () => {
    const result = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.ok(result.html.includes(RECIPIENT.unsubscribeUrl));
    assert.ok(result.text.includes(RECIPIENT.unsubscribeUrl));
  });

  it("renders the configured sender name + postal address in the CAN-SPAM footer", () => {
    const result = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.ok(result.html.includes("velai"));
    assert.ok(result.html.includes("123 Main St, Springfield"));
    assert.ok(!result.html.includes("not configured"));
  });

  it("leaves the sender block out when no name or address is configured, and keeps the reason line", () => {
    const noSender: CampaignSender = { name: null, postalAddress: null };
    const result = renderCampaign(campaign, RECIPIENT, noSender, SITE_URL);
    assert.ok(!result.html.includes("not configured"));
    assert.ok(!result.text.includes("not configured"));
    assert.ok(result.html.includes("Why you got this: you have a Velai account."));
    assert.ok(result.text.includes("Why you got this: you have a Velai account."));
    assert.doesNotMatch(result.html, /<p style="margin:0 0 4px;"><\/p>/);
    // No rule above a lone reason line; the footer's own rule follows it.
    assert.match(result.html, /<div style="margin-top:24px;font-family:/);
  });
});

describe("renderCampaign: pictures, links and the button", () => {
  const campaign = {
    name: "test",
    subject: "Hi",
    preheader: "Pre",
    bodyMarkdown: [
      "Read [the post](/blog/a?x=1&y=2).",
      "",
      "![Three roles marked Strong, Good and Outside](/blog/a/shot.png)",
      "",
      '[Set up your matches](/jobs?setup=open "button")',
      "",
      "Vivek\\",
      "Founder, Velai",
    ].join("\n"),
  };

  it("resolves site paths against the site and styles links in the brand colour", () => {
    const { html, text } = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.ok(html.includes(`href="${SITE_URL}/blog/a?x=1&amp;y=2" style="color:`));
    assert.ok(text.includes(`the post (${SITE_URL}/blog/a?x=1&y=2)`));
  });

  it("draws a picture full width with its alt text, and leaves it out of the plain text", () => {
    const { html, text } = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.match(html, /<img src="https:\/\/velai\.app\/blog\/a\/shot\.png" alt="Three roles marked Strong, Good and Outside" width="536" style="[^"]*max-width:536px;height:auto/);
    assert.ok(!text.includes("shot.png"));
    assert.ok(!text.includes("!["));
  });

  it("turns a paragraph that is one link titled button into the brand button", () => {
    const { html, text } = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.match(html, /<td bgcolor="#0E9F4E"[^>]*>\s*<a href="https:\/\/velai\.app\/jobs\?setup=open"[^>]*>Set up your matches<\/a>/);
    assert.ok(!html.includes('title="button"'));
    assert.ok(text.includes(`Set up your matches (${SITE_URL}/jobs?setup=open)`));
  });

  it("keeps a backslash line break as a <br> and a plain line break in text", () => {
    const { html, text } = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.ok(html.includes("Vivek<br>\nFounder, Velai"));
    assert.ok(text.includes("Vivek\nFounder, Velai"));
  });
});

describe("the 2026-10-whats-new campaign", () => {
  it("loads, and every picture it shows is in public/", async () => {
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    const campaign = loadCampaign("2026-10-whats-new");
    const pictures = [...campaign.bodyMarkdown.matchAll(/!\[[^\]]+\]\((\/[^)\s]+)\)/g)].map((m) => m[1]);
    assert.equal(pictures.length, 3);
    for (const src of pictures) assert.ok(existsSync(path.join(process.cwd(), "public", src)), src);
    const { html } = renderCampaign(campaign, RECIPIENT, SENDER, SITE_URL);
    assert.ok(html.includes(">Set up your matches</a>"));
    assert.ok(html.includes("utm_campaign=2026-10-whats-new"));
    assert.ok(!html.includes("{{"));
  });
});
