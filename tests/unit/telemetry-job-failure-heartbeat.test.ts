import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Queryable } from "@/lib/pg/pool";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";

/**
 * Two independent things are under test here, matching the two halves of
 * the 2026-09-04 fix:
 *
 * 1. `writeHeartbeat`'s `onlyIfOlderThanSeconds` guard (heartbeat.ts) — a
 *    pure SQL-shape check against a fake `Queryable`, same pattern
 *    tests/unit/rollup-fetch.test.ts uses. No DB needed: this proves the
 *    guard clause + param are actually emitted in same-clock form
 *    (`now() - make_interval(secs => $N)`, never a bare comparison
 *    against a client-supplied timestamp), and relies on Postgres's
 *    documented `ON CONFLICT DO UPDATE ... WHERE` semantics for the
 *    runtime guarantee (not re-provable without a live server).
 *
 * 2. `deploy/run-telemetry-job.sh`'s decision to invoke the recorder at
 *    all, and only when the child exits non-zero — an end-to-end run of
 *    the REAL wrapper script, with `node_modules/.bin/tsx` and `timeout`
 *    replaced by fake shims (per the task brief: "stub the write command
 *    ... prefer that over requiring a live PG"). The fake tsx dispatches
 *    on which script path it was asked to run and simulates
 *    scripts/record-job-failure.ts's guarded upsert against a flat file
 *    standing in for intervu.job_heartbeats — this proves the WRAPPER's
 *    call/no-call decision and the $elapsed value it passes through, not
 *    Postgres's own guard evaluation (see #1's caveat).
 */

const WRAPPER = path.join(process.cwd(), "deploy", "run-telemetry-job.sh");

function fakeDb(): { db: Queryable; calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <R>(text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows: [] as R[] };
    },
  };
  return { db, calls };
}

describe("writeHeartbeat onlyIfOlderThanSeconds guard (heartbeat.ts)", () => {
  it("emits the plain unconditional upsert when no guard is passed (unchanged for existing callers)", async () => {
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", 7, true);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].text.includes("where"), "no guard means no WHERE clause");
    assert.deepEqual(calls[0].params, ["some-job", 7, true]);
  });

  it("appends a same-clock last_run_at WHERE guard and its param when onlyIfOlderThanSeconds is passed", async () => {
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", null, false, { onlyIfOlderThanSeconds: 42 });
    assert.equal(calls.length, 1);
    assert.match(
      calls[0].text,
      /where intervu\.job_heartbeats\.last_run_at < now\(\) - make_interval\(secs => \$4\)/,
      "threshold must be derived by the DB from now() on its own clock, not compared against a client timestamp",
    );
    assert.deepEqual(calls[0].params, ["some-job", null, false, 42]);
  });

  it("never emits a bare last_run_at comparison against a client-supplied value (guards against reintroducing the cross-clock bug)", async () => {
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", null, false, { onlyIfOlderThanSeconds: 99 });
    assert.equal(calls.length, 1);
    assert.ok(
      !/last_run_at\s*<\s*\$\d+/.test(calls[0].text),
      "last_run_at must only ever be compared against now() - make_interval(...), never a bare $N " +
        "placeholder — a bare form would mean an app-box timestamp is being sent in as a param, " +
        "reintroducing the cross-clock skew bug",
    );
  });
});

describe("run-telemetry-job.sh supervisor failure heartbeat", () => {
  // Bash source embedded as plain strings (never template literals) so `$`
  // and `${...}` inside the shim reach the file as literal bash, not JS
  // interpolation.
  const FAKE_TIMEOUT_SH = [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    'while [[ "$1" == --* ]]; do shift; done',
    "shift",
    'exec "$@"',
    "",
  ].join("\n");

  // Dispatches on the script path it's told to run. For the job itself
  // (scripts/*.ts), behavior is driven by $FAKE_JOB_BEHAVIOR. For the
  // recorder (scripts/record-job-failure.ts), it simulates the exact
  // guarded-upsert semantics writeHeartbeat's onlyIfOlderThanSeconds
  // implements — comparing an existing row's last_run_at against
  // now() - elapsed, both sides derived from THIS box's clock (standing in
  // for the DB's own now()), against a flat "job|ok|last_run_at" file
  // standing in for intervu.job_heartbeats — proving the wrapper's
  // call/no-call decision and the $elapsed value it forwards, not
  // Postgres itself.
  const FAKE_TSX_SH = [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    'script="$1"; shift',
    'case "$script" in',
    "  scripts/record-job-failure.ts)",
    '    job="$1"; elapsed="$2"',
    '    printf \'record-job-failure %s %s\\n\' "$job" "$elapsed" >> "$FAKE_CALL_LOG"',
    "    existing_ts=0",
    '    line="$(grep "^${job}|" "$FAKE_HEARTBEATS_FILE" | tail -1 || true)"',
    '    if [[ -n "$line" ]]; then existing_ts="$(printf \'%s\' "$line" | cut -d\'|\' -f3)"; fi',
    '    threshold=$(( $(date +%s) - elapsed ))',
    "    if (( existing_ts < threshold )); then",
    '      grep -v "^${job}|" "$FAKE_HEARTBEATS_FILE" > "$FAKE_HEARTBEATS_FILE.tmp" 2>/dev/null || true',
    '      mv "$FAKE_HEARTBEATS_FILE.tmp" "$FAKE_HEARTBEATS_FILE"',
    '      printf \'%s|false|%s\\n\' "$job" "$(date +%s)" >> "$FAKE_HEARTBEATS_FILE"',
    "    fi",
    "    exit 0",
    "    ;;",
    "  scripts/*.ts)",
    '    job="$(basename "$script" .ts)"',
    '    printf \'job %s\\n\' "$job" >> "$FAKE_CALL_LOG"',
    '    case "${FAKE_JOB_BEHAVIOR:-success}" in',
    "      success) exit 0 ;;",
    "      fail-no-heartbeat) exit 1 ;;",
    "      fail-with-heartbeat)",
    '        grep -v "^${job}|" "$FAKE_HEARTBEATS_FILE" > "$FAKE_HEARTBEATS_FILE.tmp" 2>/dev/null || true',
    '        mv "$FAKE_HEARTBEATS_FILE.tmp" "$FAKE_HEARTBEATS_FILE"',
    '        printf \'%s|true|%s\\n\' "$job" "$(date +%s)" >> "$FAKE_HEARTBEATS_FILE"',
    "        exit 1",
    "        ;;",
    "      self-kill) kill -9 $$ ;;",
    "      *) exit 1 ;;",
    "    esac",
    "    ;;",
    "esac",
    "",
  ].join("\n");

  function setupRoot(): { root: string; heartbeatsFile: string; callLog: string; envFile: string } {
    const root = mkdtempSync(path.join(tmpdir(), "run-telemetry-job-test-"));
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    mkdirSync(path.join(root, "bin"), { recursive: true });

    writeFileSync(path.join(root, "scripts", "fake-job.ts"), "// stub — never actually executed, only its existence is checked\n");
    writeFileSync(path.join(root, "scripts", "record-job-failure.ts"), "// stub — never actually executed, only its existence is checked\n");

    const tsxPath = path.join(root, "node_modules", ".bin", "tsx");
    writeFileSync(tsxPath, FAKE_TSX_SH);
    chmodSync(tsxPath, 0o755);

    const timeoutPath = path.join(root, "bin", "timeout");
    writeFileSync(timeoutPath, FAKE_TIMEOUT_SH);
    chmodSync(timeoutPath, 0o755);

    const envFile = path.join(root, "env");
    writeFileSync(envFile, "BATCH_PG_URL=postgres://fake-test-host/fake\n");

    const heartbeatsFile = path.join(root, "heartbeats.txt");
    writeFileSync(heartbeatsFile, "");
    const callLog = path.join(root, "calls.txt");
    writeFileSync(callLog, "");

    return { root, heartbeatsFile, callLog, envFile };
  }

  function runWrapper(
    root: string,
    behavior: "success" | "fail-no-heartbeat" | "fail-with-heartbeat" | "self-kill",
    heartbeatsFile: string,
    callLog: string,
    envFile: string,
  ): number {
    try {
      execFileSync(WRAPPER, ["fake-job"], {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
          INTERVU_ROOT: root,
          INTERVU_JOB_ENV_FILE: envFile,
          INTERVU_JOB_LOG: path.join(root, "run.log"),
          INTERVU_JOB_LOCK: path.join(root, "run.lock"),
          INTERVU_JOB_INSTALL_LOCK: path.join(root, "install.lock"),
          INTERVU_JOB_TIMEOUT: "5",
          FAKE_JOB_BEHAVIOR: behavior,
          FAKE_HEARTBEATS_FILE: heartbeatsFile,
          FAKE_CALL_LOG: callLog,
        },
      });
      return 0;
    } catch (err) {
      const e = err as { status: number | null };
      return e.status ?? -1;
    }
  }

  function readRow(heartbeatsFile: string, job: string): { ok: string } | undefined {
    const lines = readFileSync(heartbeatsFile, "utf8").split("\n").filter(Boolean);
    const row = lines.filter((l) => l.startsWith(`${job}|`)).at(-1);
    if (!row) return undefined;
    const [, ok] = row.split("|");
    return { ok };
  }

  function readCalls(callLog: string): string[] {
    return readFileSync(callLog, "utf8").split("\n").filter(Boolean);
  }

  it("records a failure heartbeat when the child exits non-zero without writing one itself", () => {
    const { root, heartbeatsFile, callLog, envFile } = setupRoot();
    try {
      const rc = runWrapper(root, "fail-no-heartbeat", heartbeatsFile, callLog, envFile);
      assert.equal(rc, 1);
      assert.ok(
        readCalls(callLog).some((c) => c.startsWith("record-job-failure ")),
        "wrapper must invoke the recorder on a bare non-zero exit",
      );
      const row = readRow(heartbeatsFile, "fake-job");
      assert.ok(row, "expected a heartbeat row after a bare non-zero exit");
      assert.equal(row!.ok, "false");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records a failure heartbeat when the child is killed by a signal, not just a plain non-zero exit", () => {
    const { root, heartbeatsFile, callLog, envFile } = setupRoot();
    try {
      const rc = runWrapper(root, "self-kill", heartbeatsFile, callLog, envFile);
      assert.equal(rc, 137, "128 + SIGKILL(9) — proves this is a signal death, not an ordinary exit(1)");
      const row = readRow(heartbeatsFile, "fake-job");
      assert.ok(row, "expected a heartbeat row after a signal kill");
      assert.equal(row!.ok, "false");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not clobber a heartbeat the child already wrote for this run", () => {
    const { root, heartbeatsFile, callLog, envFile } = setupRoot();
    try {
      const rc = runWrapper(root, "fail-with-heartbeat", heartbeatsFile, callLog, envFile);
      assert.equal(rc, 1);
      assert.ok(
        readCalls(callLog).some((c) => c.startsWith("record-job-failure ")),
        "wrapper must still attempt the recorder on non-zero exit — the guard, not the call site, is what protects the row",
      );
      const row = readRow(heartbeatsFile, "fake-job");
      assert.ok(row);
      assert.equal(row!.ok, "true", "the child's own row must survive, not be overwritten by the supervisor's guess");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes no failure heartbeat when the child exits zero", () => {
    const { root, heartbeatsFile, callLog, envFile } = setupRoot();
    try {
      const rc = runWrapper(root, "success", heartbeatsFile, callLog, envFile);
      assert.equal(rc, 0);
      assert.ok(
        !readCalls(callLog).some((c) => c.startsWith("record-job-failure ")),
        "wrapper must not invoke the recorder on a clean exit",
      );
      assert.equal(readRow(heartbeatsFile, "fake-job"), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
