import { describe, it, after } from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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

// D10: a deploy replaces the container mid-session — a process restart, not
// data loss. Each "instance" below is a genuinely separate module
// evaluation (cache-busting dynamic import) with the globalThis key deleted
// first, so its top-level `??=` really does re-run and, in file mode, really
// does reload from disk instead of reusing the still-warm Map — the same
// gap a real redeploy leaves.
describe('viewer session store — file-backed (D10)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-session-store-'));
  const file = join(dir, 'sessions.json');
  after(() => rmSync(dir, { recursive: true, force: true }));

  async function freshStore() {
    delete (globalThis as { __viewerSessions?: unknown }).__viewerSessions;
    return import(`../../src/lib/viewer/session-store?instance=${Math.random()}`);
  }

  it('a session created before a restart is visible after it', async () => {
    process.env.VIEWER_SESSION_FILE = file;
    try {
      const before = await freshStore();
      const created = await before.createSession('user-a');

      const after = await freshStore();
      assert.equal((await after.getSession(created.id))?.uid, 'user-a');
    } finally {
      delete process.env.VIEWER_SESSION_FILE;
    }
  });

  it('a signal written before a restart is readable after it', async () => {
    process.env.VIEWER_SESSION_FILE = file;
    try {
      const before = await freshStore();
      const created = await before.createSession('user-b');
      await before.putSignal(created.id, 'host', { sdp: 'v=0 restart' });

      const after = await freshStore();
      assert.equal((await after.getSession(created.id))?.host?.sdp, 'v=0 restart');
    } finally {
      delete process.env.VIEWER_SESSION_FILE;
    }
  });

  it('sweeps expired sessions out of the file, not just out of memory', async () => {
    process.env.VIEWER_SESSION_FILE = file;
    try {
      const t0 = 3_000_000;
      const before = await freshStore();
      const abandoned = await before.createSession('user-a', t0);
      await before.createSession('user-b', t0 + VIEWER_SESSION_TTL_MS + 1);

      const after = await freshStore();
      assert.equal(await after.getSession(abandoned.id), null);
    } finally {
      delete process.env.VIEWER_SESSION_FILE;
    }
  });

  it('a deleted session stays deleted across a restart', async () => {
    process.env.VIEWER_SESSION_FILE = file;
    try {
      const before = await freshStore();
      const s = await before.createSession('user-c');
      await before.deleteSession(s.id);

      const after = await freshStore();
      assert.equal(await after.getSession(s.id), null);
    } finally {
      delete process.env.VIEWER_SESSION_FILE;
    }
  });

  it('never touches disk when the env var is unset', async () => {
    delete process.env.VIEWER_SESSION_FILE;
    const before = readdirSync(dir);
    const store = await freshStore();
    const s = await store.createSession('user-d');
    await store.putSignal(s.id, 'host', { sdp: 'v=0' });
    await store.deleteSession(s.id);
    assert.deepEqual(readdirSync(dir), before, 'no file should appear in an unrelated directory when unconfigured');
  });
});

/**
 * persist()'s write-failure handling needs a REAL fresh module evaluation —
 * SESSION_FILE is a top-level `const` read once from the env — and this
 * FILE already imports session-store.ts statically above, which freezes
 * that constant (to `undefined`, the real ambient env) the moment the file
 * loads, before any test body runs. Verified directly: a dynamic
 * `import(specifier + '?x=' + Math.random())` of the same module, even run
 * back-to-back with no static import anywhere in sight, still returns the
 * SAME module object under this repo's tsx/Node combination — the
 * query-string cache-busting the D10 suite above relies on for its own
 * "restart" simulation does not actually re-run top-level module code here.
 * Spawning a genuinely separate process is the only way to get a first-ever,
 * uncontaminated module evaluation that observes THIS test's env var.
 */
describe('persist() failure handling — real process isolation', () => {
  it('does not throw when the file write fails — persistence degrades to in-memory only, logged once naming the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'viewer-session-store-persist-'));
    const badFile = join(dir, 'missing-parent-dir', 'sessions.json');
    const script = join(dir, 'probe.mjs');
    const storeSpecifier = new URL('../../src/lib/viewer/session-store.ts', import.meta.url).href;
    writeFileSync(script, `
      const errors = [];
      console.error = (...args) => errors.push(args.join(' '));
      const store = await import(${JSON.stringify(storeSpecifier)});
      const created = await store.createSession('user-e');
      const readBack = await store.getSession(created.id);
      await store.putSignal(created.id, 'host', { sdp: 'v=0' });
      process.stdout.write(JSON.stringify({ uid: readBack && readBack.uid, errors }));
    `);

    const out = execFileSync('npx', ['tsx', script], {
      encoding: 'utf8',
      env: { ...process.env, VIEWER_SESSION_FILE: badFile },
    });
    const result = JSON.parse(out.trim().split('\n').pop()!);

    assert.equal(result.uid, 'user-e', 'in-memory store must still work when the file write fails');
    assert.ok(result.errors.some((e: string) => e.includes(badFile)), `expected a loud error naming ${badFile}, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.length, 1, 'must log the failure once (createSession + putSignal both persist), not once per write');

    rmSync(dir, { recursive: true, force: true });
  });
});
