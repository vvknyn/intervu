import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { newSessionId, authorizeSession, VIEWER_SESSION_TTL_MS } from '../../src/lib/viewer/sessions';

const OWNER = 'user-a';
const NOW = 1_000_000;
const live = { uid: OWNER, expiresAt: NOW + VIEWER_SESSION_TTL_MS };

describe('viewer session ids', () => {
  it('mints unguessable ids that do not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSessionId()));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.ok(id.length >= 22, `id too short: ${id}`);
  });
});

describe('viewer session TTL', () => {
  it('is 15 minutes', () => {
    assert.equal(VIEWER_SESSION_TTL_MS, 15 * 60 * 1000);
  });

  it('admits the owner right up to the boundary and refuses them at it', () => {
    assert.equal(authorizeSession(live, OWNER, live.expiresAt - 1).ok, true);
    assert.equal(authorizeSession(live, OWNER, live.expiresAt).ok, false);
  });
});

describe('authorizeSession', () => {
  it('admits the owner of a live session and hands back the session itself', () => {
    // Returning it here is what lets callers use it without a non-null
    // assertion, so the guarantee is checked by the compiler, not by hand.
    assert.deepEqual(authorizeSession(live, OWNER, NOW), { ok: true, session: live });
  });

  it('refuses an unauthenticated caller before looking at the session', () => {
    // 401, not 404: "log in" is actionable, and the phone page turns this
    // into a login prompt rather than an "it ended" dead end.
    assert.deepEqual(authorizeSession(live, null, NOW), { ok: false, status: 401, error: 'unauthorized' });
  });

  it('refuses a session that does not exist', () => {
    assert.deepEqual(authorizeSession(null, OWNER, NOW), { ok: false, status: 404, error: 'not_found' });
  });

  it('refuses another account with a response indistinguishable from a missing session', () => {
    // The id is a capability. A 403 here would confirm to a holder of a
    // leaked link that the link is REAL and merely belongs to someone else;
    // 404 tells them nothing. The owner never sees this branch.
    assert.deepEqual(
      authorizeSession(live, 'user-b', NOW),
      authorizeSession(null, 'user-b', NOW),
    );
  });

  it('refuses an expired session even for its owner', () => {
    assert.deepEqual(
      authorizeSession(live, OWNER, live.expiresAt + 1),
      { ok: false, status: 404, error: 'not_found' },
    );
  });
});
