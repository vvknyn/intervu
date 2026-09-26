# Job trust corrections (Meili repair)

Read-path corrections for mis-keyed company domains, salary currency, multi-zone salary amount/period fixes, and US TD Bank domain remap ship with the app via `normalizePublicJob` → `applyTrustCorrections` (`src/lib/jobs/trust-corrections.ts`).

For documents already indexed in Meili, run the one-shot repair on Contabo:

```bash
CREDS=$(ssh subspace@194.163.147.154 'set -a; . /opt/jobs-sync/.env; set +a; printf "%s|%s" "$MEILI_URL" "$MEILI_MASTER_KEY"')
npx tsx scripts/repair-job-trust-corrections-meili.mjs \
  --host="${CREDS%%|*}" --key="${CREDS##*|}" --expect-host=meili-box
npx tsx scripts/repair-job-trust-corrections-meili.mjs \
  --host="${CREDS%%|*}" --key="${CREDS##*|}" --expect-host=meili-box --apply
```

Upstream ingest (`/opt/jobs-sync/sync.mjs`) must be fixed separately or bad values may return on the next sync.

`salary_currency` is not filterable on the live `jobs` index. The script does not filter on it. Currency and zone-table amount candidates are the docs already returned by the domain queries, plus searchable hits for company text together with a CAD marker (`Toronto-Dominion` + `CAD`, `TD Bank` + `Canadian dollars`), and postings with multi-zone salary tables (`Zone A CAD gross` in description). `jobNeedsTrustCorrection` / `applyTrustCorrections` decide in JS, including when `CAD` is glued to the next word (`$115,200 CADTD`), when `salary_min` / `salary_max` are null, and when stored amounts are implausible vs a zone-table envelope. Dry-run is the default; `--apply` PUTs partial `{id, company_domain?, salary_currency?, salary_min?, salary_max?, salary_period?}` batches (this Meili returns 405 for PATCH).

## SERP vs detail

SERP/list Meili hits omit `description`, so list-card salary amounts and currency stay wrong until this Meili one-shot (or upstream ingest writes correct values). Job detail still corrects via the read path when `description` is present. Domain remap works on SERP without `description`.
