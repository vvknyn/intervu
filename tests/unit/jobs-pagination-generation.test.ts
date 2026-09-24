import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobsPaginationGeneration } from '../../src/lib/jobs/pagination-generation';

describe('JobsPaginationGeneration', () => {
    it('resets to page one and blocks load-more while first page is active', () => {
        const guard = new JobsPaginationGeneration();
        const generation = guard.beginFirstPage();

        assert.deepEqual(guard.snapshot(), {
            generation,
            pagesLoaded: 1,
            firstPageActive: true,
            loadMoreActive: false,
        });
        assert.equal(guard.beginLoadMore(30), null);

        assert.equal(guard.finishFirstPage(generation, true), true);
        assert.deepEqual(guard.beginLoadMore(30), {
            generation,
            page: 1,
            offset: 30,
        });
    });

    it('offset override supports deeper first-page limits', () => {
        const guard = new JobsPaginationGeneration();
        const gen = guard.beginFirstPage();
        assert.equal(guard.finishFirstPage(gen, true), true);
        const ticket = guard.beginLoadMore(20, 60);
        assert.deepEqual(ticket, {
            generation: gen,
            page: 1,
            offset: 60,
        });
    });

    it('rejects an old A load-more response after A to B to A', () => {
        const guard = new JobsPaginationGeneration();

        const firstA = guard.beginFirstPage();
        guard.finishFirstPage(firstA, true);
        const staleA = guard.beginLoadMore(30);
        assert.ok(staleA);

        const generationB = guard.beginFirstPage();
        guard.finishFirstPage(generationB, true);
        const secondA = guard.beginFirstPage();
        guard.finishFirstPage(secondA, true);

        assert.notEqual(staleA.generation, secondA);
        assert.equal(guard.isCurrentGeneration(staleA.generation), false);
        assert.equal(guard.isCurrentGeneration(secondA), true);
        assert.equal(guard.canApplyLoadMore(staleA), false);
        assert.equal(guard.completeLoadMore(staleA), false);
    });

    it('invalidates active load-more and resets pagination when a new first page starts', () => {
        const guard = new JobsPaginationGeneration();
        const first = guard.beginFirstPage();
        guard.finishFirstPage(first, true);
        const stale = guard.beginLoadMore(30);
        assert.ok(stale);

        const next = guard.beginFirstPage();

        assert.equal(guard.canApplyLoadMore(stale), false);
        assert.equal(guard.endLoadMore(stale), false);
        assert.deepEqual(guard.snapshot(), {
            generation: next,
            pagesLoaded: 1,
            firstPageActive: true,
            loadMoreActive: false,
        });
    });

    it('does not let a stale first-page completion settle the current generation', () => {
        const guard = new JobsPaginationGeneration();
        const stale = guard.beginFirstPage();
        const current = guard.beginFirstPage();

        assert.equal(guard.finishFirstPage(stale, true), false);
        assert.equal(guard.snapshot().firstPageActive, true);
        assert.equal(guard.finishFirstPage(current, true), true);
        assert.equal(guard.snapshot().firstPageActive, false);
    });

    it('invalidates pending work when search becomes idle', () => {
        const guard = new JobsPaginationGeneration();
        const stale = guard.beginFirstPage();

        const idleGeneration = guard.invalidate();

        assert.notEqual(idleGeneration, stale);
        assert.equal(guard.finishFirstPage(stale, true), false);
        assert.deepEqual(guard.snapshot(), {
            generation: idleGeneration,
            pagesLoaded: 1,
            firstPageActive: false,
            loadMoreActive: false,
        });
    });

    it('keeps pagination locked when the current first page fails', () => {
        const guard = new JobsPaginationGeneration();
        const generation = guard.beginFirstPage();

        assert.equal(guard.finishFirstPage(generation, false), true);
        assert.equal(guard.snapshot().firstPageActive, false);
        assert.equal(guard.beginLoadMore(30), null);
    });
});
