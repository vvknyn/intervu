import { describe, it, beforeEach, afterEach } from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isTailnetAddress, tailnetReady, MARKER_PATH, setup, TAILNET_TIMEOUT_MS } from '../../openclaw/scripts/viewer/tailnet.mjs';

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

  const ONLINE_IOS_STATUS = JSON.stringify({ Peer: { a: { OS: 'iOS', Online: true } } });
  const NO_PEER_STATUS = JSON.stringify({ Peer: {} });

  it('skips the install step when tailscale is already on PATH', async () => {
    const calls: string[][] = [];
    const run = scriptedRun({
      'which tailscale': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
    }, calls);

    await setup({ run, markerPath, sleepImpl: async () => {} });

    assert.ok(!calls.some((c) => c[0] === 'brew' || (c[0] === 'sh' && c.join(' ').includes('install.sh'))),
      'must not attempt to install what is already there');
  });

  it('scrapes the auth URL from tailscale up\'s output and prints it', async () => {
    const run = scriptedRun({
      'which tailscale': { code: 0 },
      'tailscale up': { code: 0, stdout: 'To authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123\n\n' },
      'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
    });

    await setup({ run, markerPath, sleepImpl: async () => {} });

    assert.ok(logs.some((l) => l === 'TAILNET-AUTH-URL: https://login.tailscale.com/a/abc123'), logs.join('\n'));
  });

  it('writes the marker only once a mobile peer is Online, not before', async () => {
    let statusCalls = 0;
    const run = scriptedRun({
      'which tailscale': { code: 0 },
      'tailscale up': { code: 0 },
    });
    const runWithProgressiveStatus = async (cmd: string, args: string[], opts?: { onStdout?: (c: string) => void }) => {
      if (cmd === 'tailscale' && args[0] === 'status') {
        statusCalls++;
        return { code: 0, stdout: statusCalls < 3 ? NO_PEER_STATUS : ONLINE_IOS_STATUS, stderr: '' };
      }
      return run(cmd, args, opts);
    };

    assert.equal(existsSync(markerPath), false);
    await setup({ run: runWithProgressiveStatus, markerPath, sleepImpl: async () => {} });

    assert.ok(statusCalls >= 3, 'must keep polling until a mobile peer is online');
    assert.equal(existsSync(markerPath), true);
    assert.ok(logs.includes('TAILNET-READY'));
  });

  it('accepts an android peer, not only iOS', async () => {
    const run = scriptedRun({
      'which tailscale': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: JSON.stringify({ Peer: { a: { OS: 'android', Online: true } } }) },
    });
    await setup({ run, markerPath, sleepImpl: async () => {} });
    assert.equal(existsSync(markerPath), true);
  });

  it('times out instead of hanging when no mobile peer ever comes online', async () => {
    const run = scriptedRun({
      'which tailscale': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: NO_PEER_STATUS },
    });

    await assert.rejects(() => setup({ run, markerPath, sleepImpl: async () => {}, deadlineMs: 1 }));

    assert.equal(existsSync(markerPath), false);
    assert.ok(errors.includes('TAILNET-TIMEOUT'));
  });

  it('installs via brew on darwin when tailscale is missing', async () => {
    const calls: string[][] = [];
    const run = scriptedRun({
      'which tailscale': { code: 1 },
      'brew install tailscale': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
    }, calls);

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'darwin' });

    assert.ok(calls.some((c) => c.join(' ') === 'brew install tailscale'));
  });

  it('installs via the curl|sh installer on non-darwin platforms', async () => {
    const calls: string[][] = [];
    const run = scriptedRun({
      'which tailscale': { code: 1 },
      'sh -c curl -fsSL https://tailscale.com/install.sh | sh': { code: 0 },
      'tailscale up': { code: 0 },
      'tailscale status --json': { code: 0, stdout: ONLINE_IOS_STATUS },
    }, calls);

    await setup({ run, markerPath, sleepImpl: async () => {}, platform: 'linux' });

    assert.ok(calls.some((c) => c[0] === 'sh' && c.join(' ').includes('install.sh')));
  });

  it('default TAILNET_TIMEOUT_MS is ten minutes', () => {
    assert.equal(TAILNET_TIMEOUT_MS, 10 * 60 * 1000);
  });
});
