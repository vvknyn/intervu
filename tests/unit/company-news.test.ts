/**
 * The company news card (`CompanyIntelligenceGrid`) renders article `title`/
 * `summary` straight from the Subspace news API, which passes through raw
 * RSS/Atom text — live articles arrive with `&#x27;`, `&quot;`, `&amp;` still
 * escaped ("Anthropic&#x27;s", "&quot;Executives"), and rendering that as
 * plain JSX text prints the literal entity instead of the character it
 * encodes. `shapeNewsArticle` is the one place that text is decoded before it
 * ever reaches the card.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeHtmlEntities, shapeNewsArticle } from "@/lib/companies/news";
import type { CompanyNewsArticle } from "@/lib/companies/types";

function article(overrides: Partial<CompanyNewsArticle> = {}): CompanyNewsArticle {
  return {
    title: "Anthropic raises new round",
    url: "https://example.com/article",
    summary: null,
    publisher: "TechCrunch",
    published_at: "2026-08-01T00:00:00Z",
    is_funding_event: false,
    confidence: "high",
    ...overrides,
  };
}

describe("companies/news — decodeHtmlEntities", () => {
  it("decodes the named entities a feed serializer actually leaves behind", () => {
    assert.equal(decodeHtmlEntities("Anthropic&#x27;s new round"), "Anthropic's new round");
    assert.equal(decodeHtmlEntities("&quot;Executives are excited&quot;"), '"Executives are excited"');
    assert.equal(decodeHtmlEntities("R&amp;D spend rose"), "R&D spend rose");
  });

  it("decodes both numeric forms of the same character", () => {
    assert.equal(decodeHtmlEntities("Anthropic&#39;s round"), "Anthropic's round");
    assert.equal(decodeHtmlEntities("Anthropic&#x27;s round"), "Anthropic's round");
  });

  it("leaves plain text with no entities untouched", () => {
    assert.equal(decodeHtmlEntities("Nothing to decode here"), "Nothing to decode here");
  });

  it("leaves an unrecognized entity name as-is rather than guessing", () => {
    assert.equal(decodeHtmlEntities("&notarealentity;"), "&notarealentity;");
  });
});

describe("companies/news — shapeNewsArticle", () => {
  it("decodes entities in both title and summary", () => {
    const shaped = shapeNewsArticle(
      article({
        title: "Anthropic&#x27;s new hire",
        summary: "&quot;Executives are excited&quot; about the move.",
      }),
    );
    assert.equal(shaped.title, "Anthropic's new hire");
    assert.equal(shaped.summary, '"Executives are excited" about the move.');
  });

  it("keeps a null summary null rather than turning it into a string", () => {
    const shaped = shapeNewsArticle(article({ summary: null }));
    assert.equal(shaped.summary, null);
  });

  it("carries every other field through unchanged", () => {
    const shaped = shapeNewsArticle(article({ publisher: "Bloomberg", is_funding_event: true }));
    assert.equal(shaped.publisher, "Bloomberg");
    assert.equal(shaped.is_funding_event, true);
  });
});
