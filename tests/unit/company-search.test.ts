import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { normalizeCompanySearchQuery, searchCompanies } from '../../src/lib/companies/company-search';
import type { Queryable } from '../../src/lib/pg/pool';

describe('normalizeCompanySearchQuery', () => {
  it('trims and wraps plain text as a substring ILIKE pattern', () => {
    assert.equal(normalizeCompanySearchQuery('  stripe  '), '%stripe%');
  });

  it('escapes ILIKE wildcard characters (%, _, \\) so they match literally, not as wildcards', () => {
    assert.equal(normalizeCompanySearchQuery('100%_done\\x'), '%100\\%\\_done\\\\x%');
  });

  it('a caller cannot widen the match past their own literal substring by typing wildcard characters', () => {
    // If '%' were left unescaped, a query of just '%' would match everything
    // — the escaped form must retain it as a literal char to search for.
    const pattern = normalizeCompanySearchQuery('%');
    assert.equal(pattern, '%\\%%');
  });
});

/** Records the query text/params it received and returns fixed rows — good
 *  enough to prove `searchCompanies`'s SQL shape and result mapping without
 *  a live Postgres connection. */
function fakePg(rows: Array<{ company_domain: string; payload: Record<string, unknown> }>): {
  pg: Queryable;
  calls: Array<{ text: string; params: unknown[] }>;
} {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    pg: {
      async query<R>(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        return { rows: rows as unknown as R[] };
      },
    },
  };
}

describe('searchCompanies', () => {
  it('passes the normalized pattern and limit as bind params, never string-interpolated', async () => {
    const { pg, calls } = fakePg([]);
    await searchCompanies(pg, 'Acme', 20);
    assert.match(calls[0].text, /\$1/);
    assert.match(calls[0].text, /\$2/);
    assert.equal(calls[0].params[0], '%Acme%');
    assert.equal(calls[0].params[1], 20);
  });

  it('filters to data_type = company_profile and matches against name OR domain', async () => {
    const { pg, calls } = fakePg([]);
    await searchCompanies(pg, 'x', 1);
    assert.match(calls[0].text, /data_type = 'company_profile'/);
    assert.match(calls[0].text, /payload->>'name' ILIKE \$1/);
    assert.match(calls[0].text, /company_domain ILIKE \$1/);
  });

  it('maps a full payload to a CompanySearchHit', async () => {
    const { pg } = fakePg([
      {
        company_domain: 'acme.com',
        payload: { name: 'Acme Corp', industries: ['software', 'saas'], hq_country: 'US', total_jobs: 12 },
      },
    ]);
    const [hit] = await searchCompanies(pg, 'acme', 20);
    assert.deepEqual(hit, {
      domain: 'acme.com',
      name: 'Acme Corp',
      industries: ['software', 'saas'],
      hqCountry: 'US',
      openRolesHint: 12,
    });
  });

  it('falls back to the domain as name, and reports honest nulls, when the payload is missing those fields', async () => {
    const { pg } = fakePg([{ company_domain: 'noname.io', payload: {} }]);
    const [hit] = await searchCompanies(pg, 'noname', 20);
    assert.equal(hit.name, 'noname.io');
    assert.equal(hit.hqCountry, null);
    assert.equal(hit.openRolesHint, null);
    assert.deepEqual(hit.industries, []);
  });
});
