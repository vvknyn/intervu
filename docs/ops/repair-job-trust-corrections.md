# Job trust corrections (Meili repair)

Read-path corrections for mis-keyed company domains and salary currency ship with the app via `normalizePublicJob` → `applyTrustCorrections` (`src/lib/jobs/trust-corrections.ts`).

For documents already indexed in Meili, run the one-shot repair on Contabo:

```bash
CREDS=$(ssh subspace@194.163.147.154 'set -a; . /opt/jobs-sync/.env; set +a; printf "%s|%s" "$MEILI_URL" "$MEILI_MASTER_KEY"')
npx tsx scripts/repair-job-trust-corrections-meili.mjs \
  --host="${CREDS%%|*}" --key="${CREDS##*|}" --expect-host=meili-box
npx tsx scripts/repair-job-trust-corrections-meili.mjs \
  --host="${CREDS%%|*}" --key="${CREDS##*|}" --expect-host=meili-box --apply
```

Upstream ingest (`/opt/jobs-sync/sync.mjs`) must be fixed separately or bad values may return on the next sync.

`salary_currency` is not filterable on the live `jobs` index. The script does not filter on it. Currency candidates are the docs already returned by the domain queries, plus searchable hits for company text together with a CAD marker (`Toronto-Dominion` + `CAD`, `TD Bank` + `Canadian dollars`). `jobNeedsTrustCorrection` / `applyTrustCorrections` decide in JS, including when `CAD` is glued to the next word (`$115,200 CADTD`) and when `salary_min` / `salary_max` are null. Dry-run is the default; `--apply` PUTs partial `{id, company_domain?, salary_currency?}` batches (this Meili returns 405 for PATCH).

## SERP vs detail

SERP/list Meili hits omit `description`, so CAD salary display on the list requires this Meili repair (or upstream writing correct `salary_currency`). Job detail still corrects via the read path when `description` is present. Domain remap works on SERP without `description`.
