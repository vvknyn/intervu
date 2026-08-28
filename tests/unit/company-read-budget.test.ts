import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import {
  decideCompanyReadBudget, consumeCompanyReadBudget, companyReadBudgetExceededMessage,
} from '../../src/lib/agent/company-read-budget';
import { AGENT } from '../../src/lib/agent/config';
import type { Queryable } from '../../src/lib/pg/pool';

/** Minimal in-memory stand-in for `intervu.company_read_budgets`, mirroring
 *  `readState`/`writeState`'s SELECT-by-id / UPSERT-by-id shape — good
 *  enough to exercise `consumeCompanyReadBudget`'s real read-decide-write
 *  cycle without a live Postgres connection (no PG-backed fixture exists in
 *  this repo for this seam). */
function fakePg(): Queryable {
  const rows = new Map<string, { used: number; window_start: string }>();
  return {
    async query<R>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
      if (text.startsWith('SELECT')) {
        const [credentialId] = params as [string];
        const row = rows.get(credentialId);
        return { rows: (row ? [row] : []) as R[] };
      }
      const [credentialId, used, windowStartMs] = params as [string, number, number];
      rows.set(credentialId, { used, window_start: new Date(windowStartMs).toISOString() });
      return { rows: [] as R[] };
    },
  };
}

describe('decideCompanyReadBudget — pure decision (UTC calendar-day boundary)', () => {
  const utcMidnight = Date.UTC(2026, 7, 27);

  it('allows when used is under cap, same UTC day', () => {
    const d = decideCompanyReadBudget({ used: 49, windowStart: utcMidnight }, utcMidnight + 60_000, 50);
    assert.equal(d.allowed, true);
    assert.equal(d.used, 49);
    assert.equal(d.remaining, 1);
    assert.equal(d.windowStart, utcMidnight);
  });

  it('denies exactly at the cap boundary — used === cap', () => {
    const d = decideCompanyReadBudget({ used: 50, windowStart: utcMidnight }, utcMidnight + 60_000, 50);
    assert.equal(d.allowed, false);
    assert.equal(d.remaining, 0);
  });

  it('denies once used exceeds the cap', () => {
    const d = decideCompanyReadBudget({ used: 51, windowStart: utcMidnight }, utcMidnight + 60_000, 50);
    assert.equal(d.allowed, false);
  });

  it('rolls over to a fresh window (used reset to 0) once UTC midnight has passed — even by 1ms', () => {
    const d = decideCompanyReadBudget({ used: 50, windowStart: utcMidnight }, utcMidnight + 86_400_000, 50);
    assert.equal(d.allowed, true);
    assert.equal(d.used, 0);
    assert.equal(d.windowStart, utcMidnight + 86_400_000);
  });

  it('does NOT roll over merely because 24h have elapsed within the SAME UTC day\'s worth of ms — it keys on the calendar day, not a rolling window', () => {
    // 23h59m59s after yesterday's midnight is still "yesterday" — a rolling
    // 24h window (record-budget.ts's semantics) would already have expired
    // this; the calendar-day boundary must not.
    const d = decideCompanyReadBudget({ used: 50, windowStart: utcMidnight }, utcMidnight + 86_399_999, 50);
    assert.equal(d.allowed, false);
    assert.equal(d.windowStart, utcMidnight);
  });

  it('a brand-new credential (windowStart 0) is treated as an already-expired window, never denied', () => {
    const now = Date.UTC(2026, 7, 27, 12);
    const d = decideCompanyReadBudget({ used: 0, windowStart: 0 }, now, 50);
    assert.equal(d.allowed, true);
    assert.equal(d.windowStart, Date.UTC(2026, 7, 27));
  });

  it('resetAt is exactly windowStart + one day, regardless of what time of day `now` falls at', () => {
    const now = Date.UTC(2026, 7, 27, 17, 42);
    const d = decideCompanyReadBudget({ used: 0, windowStart: 0 }, now, 50);
    assert.equal(d.resetAt, Date.UTC(2026, 7, 28));
  });
});

describe('companyReadBudgetExceededMessage', () => {
  it('names the amount already spent, the cap, and the exact UTC reset time', () => {
    const msg = companyReadBudgetExceededMessage(50, Date.UTC(2026, 7, 28), 50);
    assert.match(msg, /50 of 50 company reads/);
    assert.match(msg, /2026-08-28T00:00:00\.000Z/);
  });
});

describe('consumeCompanyReadBudget — persisted per-credential daily budget', () => {
  it('fails OPEN (always ok, unbudgeted) when the identity PG seam is unconfigured', async () => {
    const r = await consumeCompanyReadBudget(null, 'cred-a');
    assert.equal(r.ok, true);
  });

  it('accumulates usage across calls and blocks once the cap is exceeded', async () => {
    const pg = fakePg();
    const now = Date.UTC(2026, 7, 27, 10);
    for (let i = 0; i < AGENT.DAILY_COMPANY_READ_BUDGET; i++) {
      const r = await consumeCompanyReadBudget(pg, 'cred-b', now);
      assert.equal(r.ok, true, `read ${i + 1}/${AGENT.DAILY_COMPANY_READ_BUDGET} should be allowed`);
    }
    const denied = await consumeCompanyReadBudget(pg, 'cred-b', now);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.ok(denied.error.includes(String(AGENT.DAILY_COMPANY_READ_BUDGET)));
  });

  it('SURVIVES A SIMULATED PROCESS RESTART — a fresh call sees state a previous process already persisted', async () => {
    const pg = fakePg();
    const now = Date.UTC(2026, 7, 27, 10);
    await pg.query(
      `INSERT INTO intervu.company_read_budgets (credential_id, used, window_start, updated_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), now())`,
      ['cred-restart', AGENT.DAILY_COMPANY_READ_BUDGET, Date.UTC(2026, 7, 27)],
    );
    const result = await consumeCompanyReadBudget(pg, 'cred-restart', now);
    assert.equal(result.ok, false);
  });

  it('resets after UTC midnight — a call the next calendar day succeeds again', async () => {
    const pg = fakePg();
    const now = Date.UTC(2026, 7, 27, 23, 0);
    for (let i = 0; i < AGENT.DAILY_COMPANY_READ_BUDGET; i++) await consumeCompanyReadBudget(pg, 'cred-c', now);
    assert.equal((await consumeCompanyReadBudget(pg, 'cred-c', now)).ok, false);
    const nextDay = await consumeCompanyReadBudget(pg, 'cred-c', Date.UTC(2026, 7, 28, 1));
    assert.equal(nextDay.ok, true);
  });

  it('does not share budget across different credential ids — no cross-user leakage', async () => {
    const pg = fakePg();
    const now = Date.UTC(2026, 7, 27, 10);
    for (let i = 0; i < AGENT.DAILY_COMPANY_READ_BUDGET; i++) await consumeCompanyReadBudget(pg, 'cred-d', now);
    assert.equal((await consumeCompanyReadBudget(pg, 'cred-d', now)).ok, false);
    const other = await consumeCompanyReadBudget(pg, 'cred-e', now);
    assert.equal(other.ok, true);
  });
});
