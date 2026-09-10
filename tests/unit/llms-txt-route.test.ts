import { describe, it } from 'node:test'; import assert from 'node:assert/strict';

// getSiteUrl() throws when NEXT_PUBLIC_SITE_URL is unset — set it before any
// import that could reach it at call time, same convention as
// agent-tools.test.ts:14. AGENT_ISSUER_URL is deliberately left unset so
// AGENT.issuer() takes its https://velai.app default.
process.env.NEXT_PUBLIC_SITE_URL = 'https://intervuhq.com';

import { GET } from '../../src/app/llms.txt/route';
import { MCP_TOOL_SPECS, searchJobsInput } from '../../src/lib/agent/mcp-tool-specs';
import { AGENT } from '../../src/lib/agent/config';
import { getSiteUrl } from '../../src/lib/seo/constants';

describe('GET /llms.txt', () => {
  it('returns 200 text/plain', async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.startsWith('text/plain'));
  });

  it('names every MCP_TOOL_SPECS tool and every search_jobs param — generated, not hand-copied', async () => {
    const body = await (await GET()).text();
    for (const name of Object.keys(MCP_TOOL_SPECS)) {
      assert.ok(body.includes(name), `missing tool "${name}"`);
    }
    // The "other case" the generic-fix rule requires: not just the 14 tool
    // names, but every field of one tool's wire schema, so a filter added to
    // searchJobsInput later shows up here without touching this test.
    for (const param of Object.keys(searchJobsInput.shape)) {
      assert.ok(body.includes(param), `missing search_jobs param "${param}"`);
    }
  });

  it('advertises the real MCP endpoint and never the retired intervu.cc domain', async () => {
    const body = await (await GET()).text();
    assert.ok(body.includes(`${AGENT.issuer()}/api/mcp`));
    assert.ok(!body.includes('intervu.cc'));
  });

  it('states the result cap and search depth cap', async () => {
    const body = await (await GET()).text();
    assert.ok(body.includes(`${AGENT.RATE_LIMIT} calls/hour`));
    assert.ok(body.includes(`${AGENT.RESULT_CAP} results per search_jobs page`));
    assert.ok(body.includes(`default ${AGENT.SEARCH_DEFAULT_LIMIT}`));
    assert.ok(body.includes(`${AGENT.SEARCH_DEPTH_CAP} results per query`));
    assert.ok(body.includes(`${AGENT.DAILY_RECORD_BUDGET}-record daily budget`));
    assert.ok(body.includes(`${AGENT.DAILY_COMPANY_READ_BUDGET}-call daily budget`));
  });

  it('links to the site\'s /connect page via getSiteUrl()', async () => {
    const body = await (await GET()).text();
    assert.ok(body.includes(`${getSiteUrl()}/connect`));
  });
});
