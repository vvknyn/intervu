# Market Trends page — TrueUp-inspired stats surface (2026-07-29)

## Why
Vivek: "analyze trueup.io and get our site to be like theirs... especially with the map stats" (+ pointed at /trends and /tech-situation-monitor). intervu today has ZERO market-stats surface — search is the homepage, nothing aggregates the corpus.

## TrueUp teardown (evidence: curl'd HTML + JS chunks, Jul 29 00:20-00:35 EDT; Cloudflare blocked 7/10 page fetches)
- Positioning: "The CareerOS for people in tech" / "Don't miss your dream tech job". Social proof: "165,000+ members". Stat framing: "We scan **265,031** top tech jobs in real time" — precise number, "real time" claim.
- **No literal geographic map anywhere** (verified: no mapbox/leaflet/maplibre/d3-geo/topojson in home HTML, fetched pages, or the situation-monitor's 6 lazy JS chunks; one lone "highcharts" string in monitor chunks). "Top Tech Ecosystems" = numbered RANKED LIST (#1 SF Bay Area, #2 NYC, #3 Beijing) → /locations.
- Surfaces (210 routes in build manifest): /trends, /locations, /countries + /country/[id], /regions, /remote-index, /tech-stats, /tech-jobs-overview, /job-category-trends, /layoffs, /big-tech-hiring, /tech-situation-monitor ("Real-time global tech situation monitor — tech hubs, job data, stock prices, layoffs, prediction markets" — client-rendered dashboard).
- Everything is ranked lists / card grids with counters (e.g. /job-boards cards: "Remote — 32,712 open jobs", "FAANG+ — 35,724 jobs / 26 cos"). /companies: "9,000+ company profiles".
- SEO taxonomy: flat slugs /austin /berlin /ai /fintech + /SLUG/companies + /co/SLUG. Static export (Next pages router) behind Cloudflare.

## Our counter-position
They scan 265k curated jobs at 9k companies. We observe **1.57M active listings** (2.92M all-time) across **41.8k boards** scraped from companies' own career pages, with observation history (first_seen, close events, ghost badges). We don't out-curate them — we out-scale and out-truth them.

## Phase 1 (this PR): `/trends` route on intervu
Components (match existing intervu design system; NO new chart library — stat tiles, ranked lists, CSS proportion bars):
1. **Hero stat band** — live jobs now, companies tracked, jobs observed all-time. Numbers from live Meili (corpus-count.ts pattern), never hardcoded.
2. **Top locations** — ranked countries + cities by live job count (Meili facet distribution on location_country / location_city). TrueUp-style numbered list, counts + proportion bars. Each row links into the jobs search with that place filter applied.
3. **Ghost radar, market-wide** — ghost_badge facet distribution: N flagged of M live.
4. **Posting freshness bands** — CONFIRMED feasible: `posted_ts` and `vacancy_status` are live filterables (probed Jul 29 00:35). Buckets 7d/30d/60d/older via ranged filters, facet-sum counting.

## Probe results (live meili-box, Jul 29 00:35 EDT)
- Total docs 1,887,801 (/stats, exact; isIndexing:true — embed backfill running). maxValuesPerFacet=300.
- filterableAttributes: id, employment_type, experience_level, ghost_badge, location_city, location_country, location_state, posted_ts, salary_max, salary_min, source, vacancy_status, visa_sponsorship, work_type.
- ghost_badge: clear 1,427,501 / caution 337,220 / unscored 79,562 / likely_ghost 43,518.
- Top countries: US 700,401; India 32,368; Canada 31,824; Germany 27,074; UK 23,278 … **"London" 5,948 as a country value** → country field polluted by city names as a CLASS → ISO-3166 validation with "Unclassified" rollup, never per-name special-cases. City facet far worse ("US" 36,446, "Unknown" 23,068, "2 Locations" 18,414) → cities DEFERRED to pipeline cleanup.
- Facet query 7.1s under embed-backfill CPU load (plain filters 28–42ms) → ISR caching mandatory, zero per-visitor Meili calls.
- ⚠️ INFRA: every intervu worktree's .env.local still pointed MEILISEARCH_HOST at the OLD box (contabo-trace-worker…, now 502) — live is https://meili-box.tail7daa8b.ts.net. Fixed in this worktree only; siblings (intervu, intervu-hybrid, intervu-search-journey) still stale.

## Constraints / gotchas
- Meili live index settings owned by /opt/jobs-sync/sync.mjs on Contabo — in-repo JOBS_INDEX_SETTINGS is declared schema, can drift. Adding NEW fields/facets = box-side change, out of scope for Phase 1. Phase 1 uses ONLY facets that the live index already serves (probe-verified).
- corpus-count.ts documents Meili's 100k maxTotalHits cap — total counts must come from uncapped facet-distribution sums, not estimatedTotalHits naïvely (follow its approach).
- Meili box: 0 errors at 100 req/20s historically; page must cache aggregates server-side (revalidate ~15min) — never per-visitor facet storms.
- Deploy: feature → staging → main via PR, `npm run promote`, then `npx vercel --prod`. intervu CI dead (GitHub billing) — merge needs --admin.

## Phase 2 (not this PR)
SVG world choropleth by country (static ISO lookup, no geocoding service), /trends/locations/<country> SEO pages, live change-feed section from company_change_events (public projection — safe), posting-age histogram if field added to box-side sync.
