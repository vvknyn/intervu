import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  SHARE_APP_TEXT,
  SHARE_JOB_TEXT,
  SITE_DESCRIPTION,
} from "../../src/lib/seo/constants";
import {
  INSTRUMENT_META,
  INSTRUMENT_SUPPORT,
} from "../../src/components/marketing/openclaw-content";
import { FOOTER_PROVENANCE_LINE, LANDING_PROVENANCE_LINE } from "../../src/lib/marketing-stats";
import {
  followEmailPrompt,
  followEmailSentLine,
  followEmailVerifiedLine,
  followPersistValueLine,
} from "../../src/lib/follows/persist-copy";
import { GUEST_AUTH_STRINGS } from "../../src/lib/auth/auth-gate-copy";

/**
 * Class guard for the guest-surface rule
 * (docs/specs/2026-08-07-job-seeker-front-door-design.md): copy a logged-out,
 * non-technical visitor sees must promise outcomes in plain words. Machinery
 * vocabulary lives only behind the explicit opt-in doors — the landing AI
 * tabs, /connect, /openclaw. Every new guest-surface string export gets an
 * entry in GUEST_STRINGS; the ban list is the spec's, verbatim.
 */
const BANNED: readonly RegExp[] = [
  /openclaw/i,
  /\bmcp\b/i,
  /\bagents?\b/i,
  /\bskills?\b/i,
  /whatsapp/i,
  /\bconnectors?\b/i,
  /self-host/i,
  /\bai\b/i,
];

const GUEST_STRINGS: Record<string, string> = {
  LANDING_TITLE,
  LANDING_DESCRIPTION,
  SITE_DESCRIPTION,
  SHARE_JOB_TEXT,
  SHARE_APP_TEXT,
  INSTRUMENT_META,
  INSTRUMENT_SUPPORT,
  FOOTER_PROVENANCE_LINE,
  LANDING_PROVENANCE_LINE,
  FOLLOW_PERSIST_VALUE_LINE: followPersistValueLine("Example Co"),
  FOLLOW_EMAIL_PROMPT: followEmailPrompt("Example Co"),
  FOLLOW_EMAIL_SENT_LINE: followEmailSentLine(),
  FOLLOW_EMAIL_VERIFIED_LINE: followEmailVerifiedLine("Example Co"),
  ...GUEST_AUTH_STRINGS,
};

test("guest-surface strings carry no machinery jargon", () => {
  for (const [name, value] of Object.entries(GUEST_STRINGS)) {
    for (const pattern of BANNED) {
      assert.doesNotMatch(value, pattern, `${name} must not match ${pattern}`);
    }
  }
});

/**
 * One owner per fact. The live corpus count is rendered by the count line
 * above the /jobs search box — linked to /trends, and absent rather than
 * guessed when the fetch fails. A fixed string that also states a count is a
 * second owner of the same number: on 2026-08-24 the masthead claim and that
 * line showed the same figure ~90px apart, and nothing stopped them from
 * disagreeing the moment one was fetched and the other wasn't.
 *
 * This runs over the WHOLE guest map rather than the one sentence that
 * surfaced it, so any future claim string inherits the rule.
 */
const CORPUS_COUNT_SHAPE = /\d{1,3}(?:,\d{3})+\+?/;

test("no guest-surface string states the corpus count — the count line owns it", () => {
  for (const [name, value] of Object.entries(GUEST_STRINGS)) {
    assert.doesNotMatch(
      value,
      CORPUS_COUNT_SHAPE,
      `${name} states a count; render it from the live count instead of freezing it into copy`,
    );
  }
});

test("the count-shape guard can actually detect a count", () => {
  // A probe for absence is worthless until it's shown to detect presence —
  // without this, deleting every guest string would make the test above pass.
  assert.match("2,073,043 live roles", CORPUS_COUNT_SHAPE);
  assert.match("100,000+ live roles", CORPUS_COUNT_SHAPE);
  assert.doesNotMatch(LANDING_PROVENANCE_LINE, CORPUS_COUNT_SHAPE);
});
