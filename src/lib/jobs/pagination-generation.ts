export interface LoadMoreTicket {
    generation: number;
    page: number;
    offset: number;
}

export interface PaginationGenerationSnapshot {
    generation: number;
    pagesLoaded: number;
    firstPageActive: boolean;
    loadMoreActive: boolean;
}

/**
 * Coordinates first-page and infinite-scroll requests without relying on a
 * reversible query signature. Every first-page search advances a monotonic
 * generation, immediately resets pagination, and invalidates older tickets.
 */
export class JobsPaginationGeneration {
    private generation = 0;
    private pagesLoaded = 1;
    private firstPageActive = false;
    private firstPageReady = false;
    private activeLoadMore: LoadMoreTicket | null = null;

    beginFirstPage(): number {
        this.generation += 1;
        this.pagesLoaded = 1;
        this.firstPageActive = true;
        this.firstPageReady = false;
        this.activeLoadMore = null;
        return this.generation;
    }

    invalidate(): number {
        this.generation += 1;
        this.pagesLoaded = 1;
        this.firstPageActive = false;
        this.firstPageReady = false;
        this.activeLoadMore = null;
        return this.generation;
    }

    finishFirstPage(generation: number, succeeded: boolean): boolean {
        if (generation !== this.generation || !this.firstPageActive) return false;
        this.firstPageActive = false;
        this.firstPageReady = succeeded;
        return true;
    }

    isCurrentGeneration(generation: number): boolean {
        return generation === this.generation;
    }

    beginLoadMore(pageSize: number): LoadMoreTicket | null {
        if (this.firstPageActive || !this.firstPageReady || this.activeLoadMore) return null;
        const ticket = {
            generation: this.generation,
            page: this.pagesLoaded,
            offset: this.pagesLoaded * pageSize,
        };
        this.activeLoadMore = ticket;
        return ticket;
    }

    canApplyLoadMore(ticket: LoadMoreTicket): boolean {
        return ticket.generation === this.generation && this.activeLoadMore === ticket;
    }

    completeLoadMore(ticket: LoadMoreTicket): boolean {
        if (!this.canApplyLoadMore(ticket)) return false;
        this.pagesLoaded += 1;
        return true;
    }

    endLoadMore(ticket: LoadMoreTicket): boolean {
        if (!this.canApplyLoadMore(ticket)) return false;
        this.activeLoadMore = null;
        return true;
    }

    snapshot(): PaginationGenerationSnapshot {
        return {
            generation: this.generation,
            pagesLoaded: this.pagesLoaded,
            firstPageActive: this.firstPageActive,
            loadMoreActive: this.activeLoadMore != null,
        };
    }
}
