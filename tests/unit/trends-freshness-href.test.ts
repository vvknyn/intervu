import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { freshnessBucketJobsHref } from '../../src/components/trends/PostingFreshnessBand';

/**
 * `freshnessBucketJobsHref` is the pure decision behind linking a
 * PostingFreshnessBand row to /jobs. Only the disjoint "7d" bucket (age
 * <= 7d) provably matches url-state.ts's cumulative postedBucket "7d" —
 * every other bucket either overcounts or has no matching PostedBucket
 * value, so it must stay unlinked (see the function's doc comment).
 */
describe('freshnessBucketJobsHref', () => {
  it('links the 7d bucket to postedBucket=7d, the one boundary that provably matches', () => {
    assert.equal(freshnessBucketJobsHref('7d'), '/?posted=7d');
  });

  it('leaves 30d unlinked — cumulative posted=30d would overcount vs. the disjoint 8-30d row', () => {
    assert.equal(freshnessBucketJobsHref('30d'), undefined);
  });

  it('leaves 60d unlinked — no PostedBucket value covers a 31-60-day window', () => {
    assert.equal(freshnessBucketJobsHref('60d'), undefined);
  });

  it('leaves older unlinked — posted=older means >30d, not >60d', () => {
    assert.equal(freshnessBucketJobsHref('older'), undefined);
  });
});
