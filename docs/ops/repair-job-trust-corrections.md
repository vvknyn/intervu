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

## SERP vs detail

SERP/list Meili hits omit `description`, so CAD salary display on the list requires this Meili repair (or upstream writing correct `salary_currency`). Job detail still corrects via the read path when `description` is present. Domain remap works on SERP without `description`.
