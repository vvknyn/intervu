import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  SITE_DESCRIPTION,
} from "../../src/lib/seo/constants";
import {
  INSTRUMENT_META,
  INSTRUMENT_SUPPORT,
} from "../../src/components/marketing/openclaw-content";
import { FOOTER_PROVENANCE_LINE, marketingClaim } from "../../src/lib/marketing-stats";
import {
  followPersistCta,
  followPersistLine,
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
  INSTRUMENT_META,
  INSTRUMENT_SUPPORT,
  FOOTER_PROVENANCE_LINE,
  MARKETING_CLAIM_NO_STATS: marketingClaim(null),
  MARKETING_CLAIM_WITH_COUNT: marketingClaim({
    liveJobs: { kind: "exact", value: 12345 },
  }),
  FOLLOW_PERSIST_LINE: followPersistLine("Example Co"),
  FOLLOW_PERSIST_CTA: followPersistCta(),
  FOLLOW_PERSIST_VALUE_LINE: followPersistValueLine("Example Co"),
  ...GUEST_AUTH_STRINGS,
};

test("guest-surface strings carry no machinery jargon", () => {
  for (const [name, value] of Object.entries(GUEST_STRINGS)) {
    for (const pattern of BANNED) {
      assert.doesNotMatch(value, pattern, `${name} must not match ${pattern}`);
    }
  }
});
