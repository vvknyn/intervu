import { describe, it, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { checkRateLimit, _resetRateLimits } from '../../src/lib/agent/rate-limit';
import { AGENT } from '../../src/lib/agent/config';
describe('agent rate limit', () => {
  beforeEach(() => { _resetRateLimits(); });
  it('allows up to RATE_LIMIT calls then denies the next with retryAfterSec > 0', () => {
    const now = 1_000_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) {
      const r = checkRateLimit('cred-a', now);
      assert.equal(r.ok, true, `call ${i + 1} should be ok`);
    }
    const denied = checkRateLimit('cred-a', now);
    assert.equal(denied.ok, false);
    assert.equal(denied.remaining, 0);
    assert.ok(denied.retryAfterSec > 0);
  });
  it('slides the window: after denial, a call at now + RATE_WINDOW_MS + 1 succeeds', () => {
    const now = 2_000_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) checkRateLimit('cred-b', now);
    assert.equal(checkRateLimit('cred-b', now).ok, false);
    const later = checkRateLimit('cred-b', now + AGENT.RATE_WINDOW_MS + 1);
    assert.equal(later.ok, true);
  });
  it('does not share budget across different credentialIds', () => {
    const now = 3_000_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) checkRateLimit('cred-c', now);
    assert.equal(checkRateLimit('cred-c', now).ok, false);
    const other = checkRateLimit('cred-d', now);
    assert.equal(other.ok, true);
  });
});
