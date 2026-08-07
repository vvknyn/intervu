import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import {
  decideRecordBudget, consumeRecordBudget, recordBudgetExceededMessage,
} from '../../src/lib/agent/record-budget';
import { memoryStore } from '../../src/lib/agent/store';
import { AGENT } from '../../src/lib/agent/config';

describe('decideRecordBudget — pure decision', () => {
  it('allows when used is under cap and preserves the existing window', () => {
    const d = decideRecordBudget({ used: 5, windowStart: 1000 }, 1000 + 60_000, 10);
    assert.equal(d.allowed, true);
    assert.equal(d.used, 5);
    assert.equal(d.windowStart, 1000);
    assert.equal(d.remaining, 5);
  });

  it('denies once used reaches cap', () => {
    const d = decideRecordBudget({ used: 10, windowStart: 1000 }, 1000 + 60_000, 10);
    assert.equal(d.allowed, false);
    assert.equal(d.remaining, 0);
  });

  it('rolls over to a fresh window (used reset to 0) once RECORD_BUDGET_WINDOW_MS has elapsed', () => {
    const windowStart = 1_000_000;
    const now = windowStart + AGENT.RECORD_BUDGET_WINDOW_MS + 1;
    const d = decideRecordBudget({ used: 10, windowStart }, now, 10);
    assert.equal(d.allowed, true);
    assert.equal(d.used, 0);
    assert.equal(d.windowStart, now);
  });

  it('a brand-new credential (windowStart 0, the memoryStore default-missing value) is treated as an already-expired window, never denied', () => {
    const now = 1_700_000_000_000;
    const d = decideRecordBudget({ used: 0, windowStart: 0 }, now, 10);
    assert.equal(d.allowed, true);
    assert.equal(d.windowStart, now);
  });

  it('resetAt is exactly windowStart + RECORD_BUDGET_WINDOW_MS', () => {
    const d = decideRecordBudget({ used: 1, windowStart: 5000 }, 5000 + 10, 10);
    assert.equal(d.resetAt, 5000 + AGENT.RECORD_BUDGET_WINDOW_MS);
  });
});

describe('recordBudgetExceededMessage', () => {
  it('names the amount already spent, the cap, and the exact ISO reset time — actionable for an agent, not a bare 429', () => {
    const msg = recordBudgetExceededMessage(1024, 1_700_000_000_000, 1000);
    assert.match(msg, /1024 of 1000 job records/);
    assert.match(msg, new RegExp(new Date(1_700_000_000_000).toISOString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

describe('consumeRecordBudget — persisted per-credential daily budget', () => {
  it('accumulates usage across multiple calls and blocks once the cap is exceeded', async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    for (let i = 0; i < AGENT.DAILY_RECORD_BUDGET; i++) {
      const r = await consumeRecordBudget(store, 'cred-a', 1, now);
      assert.equal(r.ok, true, `record ${i + 1}/${AGENT.DAILY_RECORD_BUDGET} should be allowed`);
    }
    const denied = await consumeRecordBudget(store, 'cred-a', 1, now);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.ok(denied.error.includes(String(AGENT.DAILY_RECORD_BUDGET)));
  });

  it('counts RECORDS, not calls — a single call returning 20 records consumes 20 in one shot', async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    const first = await consumeRecordBudget(store, 'cred-b', 20, now);
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.remaining, AGENT.DAILY_RECORD_BUDGET - 20);
    // Confirm it's really 20 gone, not 1 call worth — 49 more calls of 20 each
    // (50 total x 20 = 1000) should exactly exhaust a 1000 cap.
    for (let i = 0; i < 49; i++) {
      const r = await consumeRecordBudget(store, 'cred-b', 20, now);
      assert.equal(r.ok, true, `call ${i + 2} should still be ok`);
    }
    const denied = await consumeRecordBudget(store, 'cred-b', 20, now);
    assert.equal(denied.ok, false);
  });

  it('a count <= 0 is always allowed and never touches the store — a zero-hit search is never blocked by an exhausted budget', async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    for (let i = 0; i < AGENT.DAILY_RECORD_BUDGET; i++) await consumeRecordBudget(store, 'cred-zero', 1, now);
    assert.equal((await consumeRecordBudget(store, 'cred-zero', 1, now)).ok, false, 'sanity: budget is exhausted');
    const zero = await consumeRecordBudget(store, 'cred-zero', 0, now);
    assert.equal(zero.ok, true);
  });

  it('SURVIVES A SIMULATED PROCESS RESTART — a brand-new call, first thing this process ever does for this credential, still sees yesterday-persisted usage', async () => {
    // This models a redeploy: a fresh process has no in-memory state at all
    // (unlike rate-limit.ts's module-level `hits` Map, which DOES reset to
    // empty on every deploy). The only thing a fresh process can see is
    // whatever is already sitting in the store — so seed the store directly,
    // bypassing consumeRecordBudget entirely, exactly as if a previous
    // process had written it and then exited.
    const store = memoryStore();
    const now = 1_700_000_000_000;
    await store.set(AGENT.collections.recordBudgets, 'cred-restart', {
      used: AGENT.DAILY_RECORD_BUDGET,
      windowStart: now - 1000,
    });
    const result = await consumeRecordBudget(store, 'cred-restart', 1, now);
    assert.equal(
      result.ok,
      false,
      'an in-memory-only counter would read 0 usage here (never having seen this credential before in this process) and wrongly allow it',
    );
  });

  it('resets after the window boundary — a call more than RECORD_BUDGET_WINDOW_MS after exhaustion succeeds again', async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    for (let i = 0; i < AGENT.DAILY_RECORD_BUDGET; i++) await consumeRecordBudget(store, 'cred-c', 1, now);
    assert.equal((await consumeRecordBudget(store, 'cred-c', 1, now)).ok, false);
    const later = await consumeRecordBudget(store, 'cred-c', 1, now + AGENT.RECORD_BUDGET_WINDOW_MS + 1);
    assert.equal(later.ok, true);
  });

  it('does not share budget across different credential ids — no cross-user leakage', async () => {
    const store = memoryStore();
    const now = 1_700_000_000_000;
    for (let i = 0; i < AGENT.DAILY_RECORD_BUDGET; i++) await consumeRecordBudget(store, 'cred-d', 1, now);
    assert.equal((await consumeRecordBudget(store, 'cred-d', 1, now)).ok, false);
    const other = await consumeRecordBudget(store, 'cred-e', 1, now);
    assert.equal(other.ok, true);
  });
});
