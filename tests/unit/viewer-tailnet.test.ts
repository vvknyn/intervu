import { describe, it, beforeEach, afterEach } from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isTailnetAddress, isTailnetConnection, tailnetReady, MARKER_PATH, setup, TAILNET_TIMEOUT_MS } from '../../openclaw/scripts/viewer/tailnet.mjs';

describe('isTailnetAddress', () => {
  it('accepts the edges of the 100.64.0.0/10 range', () => {
    assert.equal(isTailnetAddress('100.64.0.0'), true);
    assert.equal(isTailnetAddress('100.111.232.96'), true);
    assert.equal(isTailnetAddress('100.127.255.255'), true);
  });

  it('rejects addresses just outside the range', () => {
    assert.equal(isTailnetAddress('100.63.255.255'), false);
    assert.equal(isTailnetAddress('100.128.0.0'), false);
    assert.equal(isTailnetAddress('192.168.1.1'), false);
  });

  it('rejects malformed input rather than throwing', () => {
    assert.equal(isTailnetAddress('not-an-ip'), false);
    assert.equal(isTailnetAddress(''), false);
  });
});

describe('isTailnetConnection', () => {
  // D12: the product installs on OTHER people's networks. Control (not just
  // watching) is only honored over the tailnet link, and this is the one
  // predicate that decides it for an inbound connection's local address.
  it('accepts a plain tailnet-range local address', () => {
    assert.equal(isTailnetConnection('100.111.232.96'), true);
  });

  it('refuses a plain LAN local address', () => {
    assert.equal(isTailnetConnection('192.168.1.42'), false);
  });

  it('strips the IPv4-mapped-in-IPv6 prefix before checking, both ways', () => {
    assert.equal(isTailnetConnection('::ffff:100.111.232.96'), true);
    assert.equal(isTailnetConnection('::ffff:192.168.1.42'), false);
  });

  it('refuses a missing local address rather than throwing', () => {
    assert.equal(isTailnetConnection(undefined), false);
    assert.equal(isTailnetConnection(null), false);
    assert.equal(isTailnetConnection(''), false);
  });
});

describe('tailnetReady / MARKER_PATH', () => {
  it('MARKER_PATH lives under ~/.openclaw', () => {
    assert.match(MARKER_PATH, /\.openclaw[\\/]viewer-tailnet-ready$/);
  });

  it('reflects whatever is at MARKER_PATH', () => {
    // Read-only check against the real path — does not create or remove it,
    // so this test is honest about state left by a previous real setup run.
    assert.equal(tailnetReady(), existsSync(MARKER_PATH));
  });
});

describe('setup()', () => {
  let dir: string;
  let markerPath: string;
  let logs: string[];
  let errors: string[];
  let realLog: typeof console.log;
  let realError: typeof console.error;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'viewer-tailnet-'));
    markerPath = join(dir, 'viewer-tailnet-ready');
    logs = []; errors = [];
    realLog = console.log; realError = console.error;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  });

  afterEach(() => {
    console.log = realLog; console.error = realError;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Scripts a `run` stub: `responses` maps "<cmd> <args...>" to a canned result. */
  function scriptedRun(responses: Record<string, { code: number; stdout?: string; stderr?: string }>, calls: string[][] = []) {
    return async (cmd: string, args: string[], opts?: { onStdout?: (chunk: string) => void }) => {
      calls.push([cmd, ...args]);
      const key = [cmd, ...args].join(' ');
      const res = responses[key] ?? { code: 1, stdout: '', stderr: `unscripted call: ${key}` };
      if (res.stdout) opts?.onStdout?.(res.stdout);
      return { code: res.code, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
    };
  }

  /** Scripts a run stub where the FIRST call to `tailscale status --json`
   *  (the capability probe) returns unparseable output — nothing installed,
   *  no socket to talk to — forcing setup() down the install/daemon-start
   *  path. Every later call, including status polls once `up` has run, is
   *  served by `responses` exactly like scriptedRun. */
  function scriptedRunWithFailingProbe(responses: Record<string, { code: number; stdout?: string; stderr?: string }>, calls: string[][] = []) {
    let statusCalls = 0;
    const inner = scriptedRun(responses, calls);
    return async (cmd: string, args: string[], opts?: { onStdout?: (chunk: string) => void }) => {
      if (cmd === 'tailscale' && args[0] === 'status') {
        statusCalls++;
        if (statusCalls === 1) {
          calls.push([cmd, ...args]);
          return { code: 1, stdout: '', stderr: 'failed to connect to local tailscaled' };
        }
      }
      return inner(cmd, args, opts);
    };
  }

  const ONLINE_IOS_STATUS = JSON.stringify({ Peer: { a: { OS: 'iOS', Online: true } } });
  const NO_PEER_STATUS = JSON.stringify({ Peer: {} });
  const RUNNING_STATUS_IOS_PEER = JSON.stringify({ BackendState: 'Running', Peer: { a: { OS: 'iOS', Online: true } } });
  const RUNNING_STATUS_NO_PEER = JSON.stringify({ BackendState: 'Running', Peer: {} });

  // Every fixture here returns parseable JSON from the probe, so setup()
  // never reaches install/daemon-start for any of these — only
  // `tailscale status --json` and `tailscale up` are in play.
  const DARWIN_BASE = {
    'tailscale up': { code: 0 },
    'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
  };

  it('probe succeeds (parseable status, whatever installed it) → neither install nor daemon-start run — the reported bug: an App Store/standalone macOS install has no brew formula', async () => {
    const calls: string[][] = [];
    const run = scriptedRun({
      'tailscale status --json': { code: 0, stdout: RUNNING_STATUS_IOS_PEER },
    }, calls);

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' });

    assert.ok(!calls.some((c) => c[0] === 'which'), 'must not check the install method when the tailnet is already usable');
    assert.ok(!calls.some((c) => c.join(' ') === 'brew services start tailscale'), 'must not touch brew services when already usable');
    assert.ok(!calls.some((c) => c.join(' ').startsWith('brew install')), 'must not attempt to install what is already there');
    assert.equal(existsSync(markerPath), true);
  });

  it('an already-Running node skips tailscale up (and its auth-URL step) and goes straight to the peer wait', async () => {
    const calls: string[][] = [];
    let statusCalls = 0;
    const run = async (cmd: string, args: string[], opts?: { onStdout?: (chunk: string) => void }) => {
      calls.push([cmd, ...args]);
      if (cmd === 'tailscale' && args[0] === 'status') {
        statusCalls++;
        return { code: 0, stdout: statusCalls === 1 ? RUNNING_STATUS_NO_PEER : ONLINE_IOS_STATUS, stderr: '' };
      }
      return { code: 1, stdout: '', stderr: `unscripted call: ${[cmd, ...args].join(' ')}` };
    };

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' });

    assert.ok(!calls.some((c) => c.join(' ') === 'tailscale up'), 'an already-Running node needs no re-auth');
    assert.ok(!logs.some((l) => l.startsWith('TAILNET-AUTH-URL')), 'no auth URL to print when already authenticated');
    assert.equal(existsSync(markerPath), true);
  });

  it('scrapes the auth URL from tailscale up\'s output and prints it', async () => {
    const run = scriptedRun({
      ...DARWIN_BASE,
      'tailscale up': { code: 0, stdout: 'To authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123\n\n' },
    });

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' });

    assert.ok(logs.some((l) => l === 'TAILNET-AUTH-URL: https://login.tailscale.com/a/abc123'), logs.join('\n'));
  });

  it('when the probe fails, starts the daemon via brew services before calling tailscale up, on darwin', async () => {
    const calls: string[][] = [];
    const run = scriptedRunWithFailingProbe({
      'which tailscale': { code: 0 },
      'brew services start tailscale': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
    }, calls);

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' });

    const daemonIdx = calls.findIndex((c) => c.join(' ') === 'brew services start tailscale');
    const upIdx = calls.findIndex((c) => c.join(' ') === 'tailscale up');
    assert.ok(daemonIdx !== -1, 'must start the daemon');
    assert.ok(upIdx !== -1, 'must call tailscale up');
    assert.ok(daemonIdx < upIdx, 'the daemon must be started before tailscale up is attempted');
  });

  it('writes the marker only once a mobile peer is Online, not before', async () => {
    let statusCalls = 0;
    const run = scriptedRun(DARWIN_BASE);
    const runWithProgressiveStatus = async (cmd: string, args: string[], opts?: { onStdout?: (c: string) => void }) => {
      if (cmd === 'tailscale' && args[0] === 'status') {
        statusCalls++;
        return { code: 0, stdout: statusCalls < 3 ? NO_PEER_STATUS : ONLINE_IOS_STATUS, stderr: '' };
      }
      return run(cmd, args, opts);
    };

    assert.equal(existsSync(markerPath), false);
    await setup({ run: runWithProgressiveStatus, markerPath, sleepImpl: async () => {}, platform: 'darwin' });

    assert.ok(statusCalls >= 3, 'must keep polling until a mobile peer is online');
    assert.equal(existsSync(markerPath), true);
    assert.ok(logs.includes('TAILNET-READY'));
  });

  it('accepts an android peer, not only iOS', async () => {
    const run = scriptedRun({
      ...DARWIN_BASE,
      'tailscale status --json': { code: 0, stdout: JSON.stringify({ Peer: { a: { OS: 'android', Online: true } } }) },
    });
    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' });
    assert.equal(existsSync(markerPath), true);
  });

  it('times out instead of hanging when no mobile peer ever comes online', async () => {
    const run = scriptedRun({
      ...DARWIN_BASE,
      'tailscale status --json': { code: 0, stdout: NO_PEER_STATUS },
    });

    await assert.rejects(() => setup({ run, markerPath, sleepImpl: async () => {}, deadlineMs: 1, platform: 'darwin' }));

    assert.equal(existsSync(markerPath), false);
    assert.ok(errors.includes('TAILNET-TIMEOUT'));
  });

  it('installs via brew on darwin when the probe fails and tailscale is missing', async () => {
    const calls: string[][] = [];
    const run = scriptedRunWithFailingProbe({
      'which tailscale': { code: 1 },
      'brew install tailscale': { code: 0 },
      'brew services start tailscale': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
    }, calls);

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' });

    assert.ok(calls.some((c) => c.join(' ') === 'brew install tailscale'));
  });

  it('probe fails on a Linux-shaped environment → uses the official install script, not brew', async () => {
    const calls: string[][] = [];
    const run = scriptedRunWithFailingProbe({
      'which tailscale': { code: 1 },
      'sh -c curl -fsSL https://tailscale.com/install.sh | sh': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
    }, calls);

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'linux' });

    assert.ok(calls.some((c) => c[0] === 'sh' && c.join(' ').includes('install.sh')));
    assert.ok(!calls.some((c) => c[0] === 'brew'), 'brew services is a darwin-only step');
  });

  it('fails loudly, without ever polling for a peer, when the probe fails and starting the daemon itself then fails', async () => {
    // A different failing STEP than the motivating bug — proves the fix is
    // "any non-zero step fails loudly," not a one-off patch for tailscale up.
    const calls: string[][] = [];
    const run = scriptedRunWithFailingProbe({
      'which tailscale': { code: 0 },
      'brew services start tailscale': { code: 1, stderr: 'Service not found' },
    }, calls);

    await assert.rejects(() => setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' }));

    assert.equal(calls.filter((c) => c.join(' ').startsWith('tailscale status')).length, 1,
      'must not fall through to polling for a peer beyond the initial probe');
    assert.ok(errors.some((e) => e.includes('daemon')), errors.join('\n'));
    assert.ok(!errors.includes('TAILNET-TIMEOUT'), 'a daemon-start failure is knowable immediately, not a timeout');
  });

  it('throws immediately, without waiting out the 10-minute timeout, when tailscale up exits non-zero', async () => {
    // The "OTHER case": proves the fix generalizes to ANY failure of
    // `tailscale up` itself (e.g. a rejected auth), not just the
    // daemon-missing one.
    const calls: string[][] = [];
    const run = scriptedRun({
      ...DARWIN_BASE,
      'tailscale up': { code: 1, stderr: 'logged out' },
    }, calls);

    const start = Date.now();
    await assert.rejects(() => setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin', deadlineMs: TAILNET_TIMEOUT_MS }));

    assert.ok(Date.now() - start < 1000, 'must fail immediately, not after waiting out the deadline');
    assert.equal(calls.filter((c) => c.join(' ').startsWith('tailscale status')).length, 1,
      'must not fall through to polling for a peer beyond the initial probe');
    assert.ok(errors.some((e) => e.includes('tailscale up')), errors.join('\n'));
    assert.ok(!errors.includes('TAILNET-TIMEOUT'), 'a failed `up` is knowable immediately, not a timeout');
  });

  it('default TAILNET_TIMEOUT_MS is ten minutes', () => {
    assert.equal(TAILNET_TIMEOUT_MS, 10 * 60 * 1000);
  });
});
