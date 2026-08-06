import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { createSession, getSession, putSignal, deleteSession } from '../../src/lib/viewer/session-store';
import { VIEWER_SESSION_TTL_MS } from '../../src/lib/viewer/sessions';

// Only possible since the store went in-process: the Firestore version could
// not be unit-tested at all (Admin SDK in the module graph), so the doorbell's
// persistence had zero direct coverage.

describe('viewer session store', () => {
  it('round-trips a session through create, signal, and delete', async () => {
    const created = await createSession('user-a');
    assert.equal((await getSession(created.id))?.uid, 'user-a');

    await putSignal(created.id, 'host', { sdp: 'v=0 host' });
    await putSignal(created.id, 'guest', { sdp: 'v=0 guest' });
    const after = await getSession(created.id);
    assert.equal(after?.host?.sdp, 'v=0 host');
    assert.equal(after?.guest?.sdp, 'v=0 guest');

    await deleteSession(created.id);
    assert.equal(await getSession(created.id), null);
  });

  it('returns null for a session that never existed', async () => {
    assert.equal(await getSession('never-created'), null);
  });

  it('drops a signal for a deleted session instead of resurrecting it', async () => {
    // The Firestore merge-write quietly re-created a ghost document in this
    // race; the phone would then see a session with no owner.
    const s = await createSession('user-a');
    await deleteSession(s.id);
    await putSignal(s.id, 'host', { sdp: 'v=0' });
    assert.equal(await getSession(s.id), null);
  });

  it('sweeps sessions whose TTL passed without the phone ever connecting', async () => {
    const t0 = 1_000_000;
    const abandoned = await createSession('user-a', t0);
    // A later create, after the first session's TTL, must clear the corpse —
    // links that are sent but never opened cannot be allowed to accumulate.
    await createSession('user-b', t0 + VIEWER_SESSION_TTL_MS + 1);
    assert.equal(await getSession(abandoned.id), null);
  });

  it('does not sweep a session that is still live', async () => {
    const t0 = 2_000_000;
    const live = await createSession('user-a', t0);
    await createSession('user-b', t0 + VIEWER_SESSION_TTL_MS - 1);
    assert.equal((await getSession(live.id))?.id, live.id);
    await deleteSession(live.id);
  });
});
