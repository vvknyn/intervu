import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { unauthorizedResponse, toolResult } from '../../src/app/api/mcp/route';
import {
  searchJobsInput, getResumeInput, saveResumeVariantInput, getResumeVariantInput, setResumeInput,
  getPreferencesInput, setPreferencesInput, MCP_TOOL_SPECS,
} from '../../src/lib/agent/mcp-tool-specs';
import { AGENT } from '../../src/lib/agent/config';
import { EXPERIENCE_LEVELS, EMPLOYMENT_TYPES } from '../../src/lib/agent/facets';
import { JOB_SORT_MODES, YEARS_EXPERIENCE_BUCKETS, PANEL_FACET_KEYS } from '../../src/lib/jobs/types';

// Bearer extraction moved to src/lib/agent/http.ts — see agent-http.test.ts.
// The credential-kind gate moved to src/lib/agent/tokens.ts — see agent-tokens.test.ts.

describe('mcp route: 401 wire contract', () => {
  it('unauthorizedResponse carries the exact body and WWW-Authenticate challenge', async () => {
    const res = unauthorizedResponse();
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
    assert.equal(
      res.headers.get('WWW-Authenticate'),
      `Bearer resource_metadata="${AGENT.issuer()}/.well-known/oauth-protected-resource"`
    );
  });
  // rateLimitedResponse itself now lives in (and is tested by) rate-limit.test.ts —
  // it's shared by this route and both /api/oauth/* routes, not mcp-route-specific.
});

describe('mcp route: tool result wire wrapping', () => {
  it('wraps a plain success payload without isError', () => {
    const result = toolResult({ hits: [], total: 0 });
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), { hits: [], total: 0 });
  });
  it('flags isError when the payload carries an error key', () => {
    const result = toolResult({ error: 'job not found' });
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { error: 'job not found' });
  });
  it('FOLDED — flags isError for search_jobs\' unavailable:true shape even with no sibling error key', () => {
    const result = toolResult({ hits: [], total: 0, unavailable: true, note: 'search backend unavailable' });
    assert.equal(result.isError, true);
  });
  it('does not flag isError for unavailable:false', () => {
    const result = toolResult({ hits: [], total: 0, unavailable: false });
    assert.equal(result.isError, undefined);
  });
});

describe('mcp route: search_jobs wire schema (Task 12 filters + cursor)', () => {
  it('accepts every new filter plus cursor together', () => {
    const res = searchJobsInput.safeParse({
      query: 'engineer',
      location: 'Canada',
      remote_only: true,
      experience_level: 'senior',
      employment_type: 'full_time',
      salary_min: 150000,
      cursor: 'abc123',
    });
    assert.equal(res.success, true);
  });

  it('accepts every real experience_level value from EXPERIENCE_LEVELS', () => {
    for (const v of EXPERIENCE_LEVELS) {
      assert.equal(searchJobsInput.safeParse({ experience_level: v }).success, true);
    }
  });

  it('rejects an experience_level value outside the real corpus vocabulary', () => {
    assert.equal(searchJobsInput.safeParse({ experience_level: 'staff' }).success, false);
  });

  it('accepts every real employment_type value from EMPLOYMENT_TYPES', () => {
    for (const v of EMPLOYMENT_TYPES) {
      assert.equal(searchJobsInput.safeParse({ employment_type: v }).success, true);
    }
  });

  it('rejects an employment_type value outside the real corpus vocabulary', () => {
    assert.equal(searchJobsInput.safeParse({ employment_type: 'freelance' }).success, false);
  });

  it('rejects a negative salary_min', () => {
    assert.equal(searchJobsInput.safeParse({ salary_min: -1 }).success, false);
  });

  it('rejects a non-integer salary_min', () => {
    assert.equal(searchJobsInput.safeParse({ salary_min: 100.5 }).success, false);
  });

  it('rejects an over-length location string (>128 chars)', () => {
    assert.equal(searchJobsInput.safeParse({ location: 'x'.repeat(129) }).success, false);
  });

  it('accepts visa_sponsorship_only (G7, Grok UX wave)', () => {
    assert.equal(searchJobsInput.safeParse({ visa_sponsorship_only: true }).success, true);
    assert.equal(searchJobsInput.safeParse({ visa_sponsorship_only: false }).success, true);
  });

  it('rejects a non-boolean visa_sponsorship_only', () => {
    assert.equal(searchJobsInput.safeParse({ visa_sponsorship_only: 'yes' }).success, false);
  });

  it('rejects an over-length cursor string (>128 chars)', () => {
    assert.equal(searchJobsInput.safeParse({ cursor: 'x'.repeat(129) }).success, false);
  });

  it('every new field stays optional (an empty object still parses)', () => {
    assert.equal(searchJobsInput.safeParse({}).success, true);
  });

  it('accepts every real sort value from JOB_SORT_MODES', () => {
    for (const v of JOB_SORT_MODES) {
      assert.equal(searchJobsInput.safeParse({ sort: v }).success, true);
    }
  });

  it('rejects a sort value outside JOB_SORT_MODES', () => {
    assert.equal(searchJobsInput.safeParse({ sort: 'oldest' }).success, false);
  });

  it('accepts every real years_experience value from YEARS_EXPERIENCE_BUCKETS', () => {
    for (const v of YEARS_EXPERIENCE_BUCKETS) {
      assert.equal(searchJobsInput.safeParse({ years_experience: v }).success, true);
    }
  });

  it('rejects a years_experience value outside YEARS_EXPERIENCE_BUCKETS', () => {
    assert.equal(searchJobsInput.safeParse({ years_experience: '20+' }).success, false);
  });

  it('accepts a facets object keyed by every real PANEL_FACET_KEYS entry', () => {
    for (const key of PANEL_FACET_KEYS) {
      assert.equal(searchJobsInput.safeParse({ facets: { [key]: ['x'] } }).success, true);
    }
  });

  it('accepts a facets object with two different panel keys at once', () => {
    const res = searchJobsInput.safeParse({ facets: { tech_stack: ['python'], location_country: ['Canada'] } });
    assert.equal(res.success, true);
  });

  it('rejects a facets key NOT in PANEL_FACET_KEYS — a real FacetKey (ghost_badge) with its own bespoke boolean control, not a generic picker', () => {
    assert.equal(searchJobsInput.safeParse({ facets: { ghost_badge: ['clear'] } }).success, false);
  });

  it('rejects a facets key that is not a FacetKey at all', () => {
    assert.equal(searchJobsInput.safeParse({ facets: { not_a_real_key: ['x'] } }).success, false);
  });

  it('rejects an empty-string facet value — two different keys, so this is a class fix, not one spot patch', () => {
    assert.equal(searchJobsInput.safeParse({ facets: { tech_stack: [''] } }).success, false);
    assert.equal(searchJobsInput.safeParse({ facets: { work_type: [''] } }).success, false);
  });
});

describe('mcp route: get_resume wire schema (MCP resume tools)', () => {
  it('accepts an empty object — get_resume needs no input, uid comes from deps', () => {
    assert.equal(getResumeInput.safeParse({}).success, true);
  });

  it('security: a uid/user_id field on the input is silently stripped, never accepted as identity', () => {
    const parsed = getResumeInput.parse({ uid: 'attacker-controlled-uid', user_id: 'also-attacker' } as unknown);
    assert.deepEqual(parsed, {});
  });
});

describe('mcp route: save_resume_variant wire schema (MCP resume tools)', () => {
  const valid = { job_id: 'job-1', resume_text: 'My tailored resume', label: 'Acme v1' };

  it('accepts a well-formed input', () => {
    assert.equal(saveResumeVariantInput.safeParse(valid).success, true);
  });

  it('rejects a missing job_id', () => {
    assert.equal(saveResumeVariantInput.safeParse({ resume_text: valid.resume_text, label: valid.label }).success, false);
  });

  it('rejects an empty resume_text', () => {
    assert.equal(saveResumeVariantInput.safeParse({ ...valid, resume_text: '' }).success, false);
  });

  it('rejects an empty label', () => {
    assert.equal(saveResumeVariantInput.safeParse({ ...valid, label: '' }).success, false);
  });

  it('DoS/cost-amplification guard: rejects resume_text longer than AGENT.RESUME_TEXT_MAX_CHARS', () => {
    assert.equal(AGENT.RESUME_TEXT_MAX_CHARS, 50_000);
    const tooLong = { ...valid, resume_text: 'x'.repeat(AGENT.RESUME_TEXT_MAX_CHARS + 1) };
    assert.equal(saveResumeVariantInput.safeParse(tooLong).success, false);
  });

  it('accepts resume_text right at the cap', () => {
    const atCap = { ...valid, resume_text: 'x'.repeat(AGENT.RESUME_TEXT_MAX_CHARS) };
    assert.equal(saveResumeVariantInput.safeParse(atCap).success, true);
  });

  it('security: a uid/user_id field on the input is silently stripped, never accepted as identity', () => {
    const parsed = saveResumeVariantInput.parse({ ...valid, uid: 'attacker-controlled-uid', user_id: 'also-attacker' } as unknown);
    assert.deepEqual(parsed, valid);
  });
});

describe('mcp route: get_resume_variant wire schema (MCP resume tools)', () => {
  it('accepts a well-formed input', () => {
    assert.equal(getResumeVariantInput.safeParse({ job_id: 'job-1' }).success, true);
  });

  it('rejects a missing job_id', () => {
    assert.equal(getResumeVariantInput.safeParse({}).success, false);
  });

  it('security: a uid/user_id field on the input is silently stripped, never accepted as identity', () => {
    const parsed = getResumeVariantInput.parse({ job_id: 'job-1', uid: 'attacker-controlled-uid', user_id: 'also-attacker' } as unknown);
    assert.deepEqual(parsed, { job_id: 'job-1' });
  });
});

describe('mcp route: set_resume wire schema (MCP resume tools)', () => {
  it('accepts resume_text alone — resume_data and label are both optional', () => {
    assert.equal(setResumeInput.safeParse({ resume_text: 'My resume text' }).success, true);
  });

  it('accepts resume_text with a permissive resume_data object and a label', () => {
    const res = setResumeInput.safeParse({
      resume_text: 'My resume text',
      resume_data: { profile: { name: 'Ada' }, experience: [] },
      label: 'chat upload',
    });
    assert.equal(res.success, true);
  });

  it('rejects an empty resume_text', () => {
    assert.equal(setResumeInput.safeParse({ resume_text: '' }).success, false);
  });

  it('rejects a missing resume_text', () => {
    assert.equal(setResumeInput.safeParse({}).success, false);
  });

  it('DoS/cost-amplification guard: rejects resume_text longer than AGENT.RESUME_TEXT_MAX_CHARS — the SAME cap save_resume_variant uses', () => {
    assert.equal(AGENT.RESUME_TEXT_MAX_CHARS, 50_000);
    const tooLong = { resume_text: 'x'.repeat(AGENT.RESUME_TEXT_MAX_CHARS + 1) };
    assert.equal(setResumeInput.safeParse(tooLong).success, false);
  });

  it('accepts resume_text right at the cap', () => {
    const atCap = { resume_text: 'x'.repeat(AGENT.RESUME_TEXT_MAX_CHARS) };
    assert.equal(setResumeInput.safeParse(atCap).success, true);
  });

  it('rejects a resume_data that is not an object (e.g. a plain string masquerading as one)', () => {
    const res = setResumeInput.safeParse({ resume_text: 'text', resume_data: 'not an object' });
    assert.equal(res.success, false);
  });

  it('is permissive at the wire level: a structurally malformed resume_data (missing every real ResumeData field) still parses here — the strict shape check lives only in setBaseResumeForUser', () => {
    const res = setResumeInput.safeParse({ resume_text: 'text', resume_data: { garbage: true } });
    assert.equal(res.success, true);
  });

  it('security: a uid/user_id field on the input is silently stripped, never accepted as identity', () => {
    const parsed = setResumeInput.parse({ resume_text: 'text', uid: 'attacker-controlled-uid', user_id: 'also-attacker' } as unknown);
    assert.deepEqual(parsed, { resume_text: 'text' });
  });
});

describe('mcp route: get_preferences wire schema', () => {
  it('accepts an empty object — get_preferences needs no input, uid comes from deps', () => {
    assert.equal(getPreferencesInput.safeParse({}).success, true);
  });

  it('security: a uid/user_id field on the input is silently stripped, never accepted as identity', () => {
    const parsed = getPreferencesInput.parse({ uid: 'attacker-controlled-uid', user_id: 'also-attacker' } as unknown);
    assert.deepEqual(parsed, {});
  });
});

describe('mcp route: set_preferences wire schema', () => {
  it('an empty patch is valid — a no-op set', () => {
    assert.equal(setPreferencesInput.safeParse({}).success, true);
  });

  it('accepts a well-formed search-only patch', () => {
    const res = setPreferencesInput.safeParse({ search: { location: 'NYC', remoteOnly: true } });
    assert.equal(res.success, true);
  });

  it('accepts a well-formed answers-only patch, including custom', () => {
    const res = setPreferencesInput.safeParse({
      answers: { workAuthorization: 'US citizen', custom: { visa: 'no sponsorship needed' } },
    });
    assert.equal(res.success, true);
  });

  it('rejects an oversize search string field (>500 chars)', () => {
    const res = setPreferencesInput.safeParse({ search: { location: 'x'.repeat(600) } });
    assert.equal(res.success, false);
  });

  it('rejects more than PREFERENCES_CUSTOM_ANSWERS_MAX custom entries', () => {
    const custom = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`q${i}`, 'a']));
    assert.equal(AGENT.PREFERENCES_CUSTOM_ANSWERS_MAX, 40);
    assert.equal(setPreferencesInput.safeParse({ answers: { custom } }).success, false);
  });

  it('accepts exactly PREFERENCES_CUSTOM_ANSWERS_MAX custom entries', () => {
    const custom = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`q${i}`, 'a']));
    assert.equal(setPreferencesInput.safeParse({ answers: { custom } }).success, true);
  });

  it('rejects an experienceLevel value outside the real corpus vocabulary', () => {
    assert.equal(setPreferencesInput.safeParse({ search: { experienceLevel: 'staff' } }).success, false);
  });

  it('security: a uid/user_id field on the input is silently stripped, never accepted as identity', () => {
    const parsed = setPreferencesInput.parse({
      search: { location: 'NYC' }, uid: 'attacker-controlled-uid', user_id: 'also-attacker',
    } as unknown);
    assert.equal('uid' in parsed, false);
    assert.equal('user_id' in parsed, false);
  });
});

describe('mcp route: MCP_TOOL_SPECS catalog (Slice 3 — one tool list)', () => {
  it('registers exactly 16 tools (tailor_resume is the 16th)', () => {
    assert.equal(Object.keys(MCP_TOOL_SPECS).length, 16);
  });

  it('every spec carries a real ZodObject inputSchema, not a raw shape', () => {
    for (const [name, spec] of Object.entries(MCP_TOOL_SPECS)) {
      assert.ok('shape' in spec.inputSchema, `${name}'s inputSchema is not a ZodObject`);
    }
  });
});
