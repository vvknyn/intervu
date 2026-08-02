import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import {
  extractBearerToken, unauthorizedResponse, toolResult, AUTHORIZED_CREDENTIAL_KINDS, searchJobsInput,
} from '../../src/app/api/mcp/route';
import { AGENT } from '../../src/lib/agent/config';

describe('mcp route: bearer extraction', () => {
  it('reads the token out of a well-formed Bearer header', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer abc123' } });
    assert.equal(extractBearerToken(req), 'abc123');
  });
  it('is scheme-case-insensitive', () => {
    const req = new Request('http://x', { headers: { authorization: 'bearer abc123' } });
    assert.equal(extractBearerToken(req), 'abc123');
  });
  it('returns undefined with no Authorization header', () => {
    assert.equal(extractBearerToken(new Request('http://x')), undefined);
  });
  it('returns undefined for a non-Bearer scheme', () => {
    const req = new Request('http://x', { headers: { authorization: 'Basic abc123' } });
    assert.equal(extractBearerToken(req), undefined);
  });
  it('returns undefined for a Bearer scheme with no token', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer' } });
    assert.equal(extractBearerToken(req), undefined);
  });
});

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

describe('mcp route: credential-kind gate (CARRIED FINDING, Task 6)', () => {
  it('authorizes manual and access credentials', () => {
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('manual'), true);
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('access'), true);
  });
  it('does not authorize a refresh credential', () => {
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('refresh'), false);
  });
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

  it('accepts every real experience_level value (entry|mid|senior)', () => {
    for (const v of ['entry', 'mid', 'senior']) {
      assert.equal(searchJobsInput.safeParse({ experience_level: v }).success, true);
    }
  });

  it('rejects an experience_level value outside the real corpus vocabulary', () => {
    assert.equal(searchJobsInput.safeParse({ experience_level: 'staff' }).success, false);
  });

  it('accepts every real employment_type value (full_time|contract)', () => {
    for (const v of ['full_time', 'contract']) {
      assert.equal(searchJobsInput.safeParse({ employment_type: v }).success, true);
    }
  });

  it('rejects an employment_type value outside the real corpus vocabulary', () => {
    assert.equal(searchJobsInput.safeParse({ employment_type: 'internship' }).success, false);
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

  it('rejects an over-length cursor string (>128 chars)', () => {
    assert.equal(searchJobsInput.safeParse({ cursor: 'x'.repeat(129) }).success, false);
  });

  it('every new field stays optional (an empty object still parses)', () => {
    assert.equal(searchJobsInput.safeParse({}).success, true);
  });
});
