import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Queryable } from "@/lib/pg/pool";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";

/**
 * Two independent things are under test here, matching the two halves of
 * the 2026-09-04 fix that replaced the clock-derived `onlyIfOlderThanSeconds`
 * guard with an exact-run-identity `onlyIfNotFromRun` guard:
 *
 * 1. `writeHeartbeat`'s `onlyIfNotFromRun` guard (heartbeat.ts) — a pure
 *    SQL-shape check against a fake `Queryable`, same pattern
 *    tests/unit/rollup-fetch.test.ts uses. No DB needed: this proves the
 *    guard clause + params are actually emitted in identity form
 *    (`run_id is distinct from $N`, never a clock comparison), that run_id
 *    resolution (explicit param vs INTERVU_RUN_ID env fallback vs null)
 *    works, and that an empty-string run id is rejected loudly rather than
 *    silently disabling the guard.
 *
 * 2. `deploy/run-telemetry-job.sh`'s decision to invoke the recorder at
 *    all, and only when the child exits non-zero, PLUS the four run-identity
 *    outcomes enumerated in heartbeat.ts's module doc — an end-to-end run of
 *    the REAL wrapper script, with `node_modules/.bin/tsx` and `timeout`
 *    replaced by fake shims. The fake tsx dispatches on which script path it
 *    was asked to run and simulates scripts/record-job-failure.ts's guarded
 *    upsert against a flat file standing in for intervu.job_heartbeats
 *    (fields: `job|ok|run_id`) — this proves the WRAPPER's call/no-call
 *    decision and which run id it mints/exports, and reproduces Postgres's
 *    `run_id is distinct from $n` predicate in bash against that flat
 *    file's stored state, which is the only way to exercise all four
 *    conflict outcomes without a live server (see #1's caveat: a fake
 *    Queryable can prove the SQL shape but cannot itself decide an
 *    ON CONFLICT DO UPDATE outcome).
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

describe("writeHeartbeat onlyIfNotFromRun guard (heartbeat.ts)", () => {
  const savedRunId = process.env.INTERVU_RUN_ID;
  beforeEach(() => {
    delete process.env.INTERVU_RUN_ID;
  });
  afterEach(() => {
    if (savedRunId === undefined) delete process.env.INTERVU_RUN_ID;
    else process.env.INTERVU_RUN_ID = savedRunId;
  });

  it("emits the plain unconditional upsert when no guard is passed, run_id null with no env var set (unchanged shape for existing callers)", async () => {
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", 7, true);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].text.includes("where"), "no guard means no WHERE clause");
    assert.deepEqual(calls[0].params, ["some-job", 7, true, null]);
  });

  it("falls back to process.env.INTERVU_RUN_ID when runId is omitted (ordinary job-script call sites need no code change)", async () => {
    process.env.INTERVU_RUN_ID = "roll-up-telemetry-1000-222";
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", 3, true);
    assert.deepEqual(calls[0].params, ["some-job", 3, true, "roll-up-telemetry-1000-222"]);
  });

  it("uses an explicitly passed runId over the environment (how tests inject it)", async () => {
    process.env.INTERVU_RUN_ID = "env-run-id";
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", 3, true, undefined, "explicit-run-id");
    assert.deepEqual(calls[0].params, ["some-job", 3, true, "explicit-run-id"]);
  });

  it("appends a run_id-identity WHERE guard and its param when onlyIfNotFromRun is passed", async () => {
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", null, false, { onlyIfNotFromRun: "run-42" }, "run-42");
    assert.equal(calls.length, 1);
    assert.match(
      calls[0].text,
      /where intervu\.job_heartbeats\.run_id is distinct from \$5/,
      "the guard must compare run identity, not a clock reading",
    );
    assert.deepEqual(calls[0].params, ["some-job", null, false, "run-42", "run-42"]);
  });

  it("never emits a clock-derived last_run_at comparison (guards against reintroducing the elapsed-seconds bug)", async () => {
    const { db, calls } = fakeDb();
    await writeHeartbeat(db, "some-job", null, false, { onlyIfNotFromRun: "run-99" }, "run-99");
    assert.ok(
      !/make_interval|last_run_at\s*[<>]/.test(calls[0].text),
      "last_run_at must never again be compared against a duration or timestamp — only run_id identity",
    );
  });

  it("rejects an empty-string run id in the guard rather than silently disabling it", async () => {
    const { db, calls } = fakeDb();
    await assert.rejects(
      () => writeHeartbeat(db, "some-job", null, false, { onlyIfNotFromRun: "" }, "run-1"),
      /empty string/,
    );
    assert.equal(calls.length, 0, "the rejected call must never reach the database");
  });

  it("rejects INTERVU_RUN_ID exported-but-empty rather than writing an empty-string run_id (the case that surfaced the clobber: child stamps run_id='', supervisor's onlyIfNotFromRun:'RUN-Z' guard then sees '' is distinct from 'RUN-Z' and overwrites the child's row)", async () => {
    process.env.INTERVU_RUN_ID = "";
    const { db, calls } = fakeDb();
    await assert.rejects(() => writeHeartbeat(db, "some-job", 999, true), /identity/);
    assert.equal(calls.length, 0, "the rejected call must never reach the database");
  });

  it("rejects an explicit runId of '' passed positionally, same as the env-var case", async () => {
    const { db, calls } = fakeDb();
    await assert.rejects(() => writeHeartbeat(db, "some-job", 3, true, undefined, ""), /identity/);
    assert.equal(calls.length, 0, "the rejected call must never reach the database");
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
  // (scripts/*.ts), behavior is driven by $FAKE_JOB_BEHAVIOR; when it writes
  // its own heartbeat it stamps $INTERVU_RUN_ID, exactly like the real
  // writeHeartbeat's env fallback would for an in-process job script. For
  // the recorder (scripts/record-job-failure.ts), it simulates the exact
  // guarded-upsert semantics writeHeartbeat's onlyIfNotFromRun implements —
  // `run_id is distinct from $n` — against a flat "job|ok|run_id" file
  // standing in for intervu.job_heartbeats. This proves the wrapper's
  // call/no-call decision and all four run-identity outcomes from
  // heartbeat.ts's module doc, not Postgres's own conflict evaluation (see
  // the top-of-file caveat).
  const FAKE_TSX_SH = [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    'script="$1"; shift',
    'case "$script" in',
    "  scripts/record-job-failure.ts)",
    '    job="$1"',
    '    run_id="${INTERVU_RUN_ID:-}"',
    '    if [[ -z "$run_id" ]]; then echo "INTERVU_RUN_ID is not set" >&2; exit 1; fi',
    '    printf \'record-job-failure %s %s\\n\' "$job" "$run_id" >> "$FAKE_CALL_LOG"',
    '    existing_run=""',
    '    line="$(grep "^${job}|" "$FAKE_HEARTBEATS_FILE" | tail -1 || true)"',
    '    if [[ -n "$line" ]]; then existing_run="$(printf \'%s\' "$line" | cut -d\'|\' -f3)"; fi',
    '    if [[ "$existing_run" != "$run_id" ]]; then',
    '      grep -v "^${job}|" "$FAKE_HEARTBEATS_FILE" > "$FAKE_HEARTBEATS_FILE.tmp" 2>/dev/null || true',
    '      mv "$FAKE_HEARTBEATS_FILE.tmp" "$FAKE_HEARTBEATS_FILE"',
    '      printf \'%s|false|%s\\n\' "$job" "$run_id" >> "$FAKE_HEARTBEATS_FILE"',
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
    '        printf \'%s|true|%s\\n\' "$job" "${INTERVU_RUN_ID:-}" >> "$FAKE_HEARTBEATS_FILE"',
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

  function readRow(heartbeatsFile: string, job: string): { ok: string; runId: string } | undefined {
    const lines = readFileSync(heartbeatsFile, "utf8").split("\n").filter(Boolean);
    const row = lines.filter((l) => l.startsWith(`${job}|`)).at(-1);
    if (!row) return undefined;
    const [, ok, runId] = row.split("|");
    return { ok, runId: runId ?? "" };
  }

  function readCalls(callLog: string): string[] {
    return readFileSync(callLog, "utf8").split("\n").filter(Boolean);
  }

  it("case 1 — no prior row, child writes nothing: plain insert", () => {
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
      assert.ok(row!.runId.length > 0, "the inserted row must carry the run's id");
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

  it("case 2/4 — child already wrote a row for THIS run: supervisor declines, does not clobber it", () => {
    const { root, heartbeatsFile, callLog, envFile } = setupRoot();
    try {
      const rc = runWrapper(root, "fail-with-heartbeat", heartbeatsFile, callLog, envFile);
      assert.equal(rc, 1);
      const calls = readCalls(callLog);
      const recorderCall = calls.find((c) => c.startsWith("record-job-failure "));
      assert.ok(recorderCall, "wrapper must still attempt the recorder on non-zero exit — the guard, not the call site, is what protects the row");
      const supervisorRunId = recorderCall!.split(" ")[2];
      const row = readRow(heartbeatsFile, "fake-job");
      assert.ok(row);
      assert.equal(row!.ok, "true", "the child's own row must survive, not be overwritten by the supervisor's write");
      assert.equal(row!.runId, supervisorRunId, "the surviving row and the supervisor's guard param share the same run id — that identity match is WHY the guard declined, not luck");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("case 3a — prior row from an OLDER run, child writes nothing this run: supervisor updates it", () => {
    const { root, heartbeatsFile, callLog, envFile } = setupRoot();
    try {
      writeFileSync(heartbeatsFile, "fake-job|true|some-older-run-id\n");
      const rc = runWrapper(root, "fail-no-heartbeat", heartbeatsFile, callLog, envFile);
      assert.equal(rc, 1);
      const row = readRow(heartbeatsFile, "fake-job");
      assert.ok(row);
      assert.equal(row!.ok, "false", "the stale row from an older run must be replaced by this run's terminal state");
      assert.notEqual(row!.runId, "some-older-run-id", "the row must now carry THIS run's id, not the older one");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("case 3b — prior row with no run_id (pre-migration row), child writes nothing this run: supervisor updates it", () => {
    const { root, heartbeatsFile, callLog, envFile } = setupRoot();
    try {
      writeFileSync(heartbeatsFile, "fake-job|true|\n");
      const rc = runWrapper(root, "fail-no-heartbeat", heartbeatsFile, callLog, envFile);
      assert.equal(rc, 1);
      const row = readRow(heartbeatsFile, "fake-job");
      assert.ok(row);
      assert.equal(row!.ok, "false", "a NULL run_id must count as distinct-from, same as any other run's id");
      assert.ok(row!.runId.length > 0, "the row must now carry THIS run's id");
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
