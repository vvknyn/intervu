import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { companyLogoUrl } from "@/lib/companies/logo";
import { domainFromLogoFile, proxyLogo } from "@/lib/companies/logo-proxy";

const PNG = new Uint8Array([137, 80, 78, 71]);

function upstream(status: number, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(status === 200 ? PNG : null, { status, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
}

describe("proxyLogo", () => {
  for (const domain of ["cisco.com", "anthropic.com"]) {
    it(`passes a 200 through for ${domain} with long public caching and no cookie`, async () => {
      const calls: string[] = [];
      const res = await proxyLogo(`${domain}.png`, upstream(200, calls));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/png");
      assert.match(res.headers.get("cache-control") ?? "", /^public, .*s-maxage=\d{6,}/);
      assert.equal(res.headers.get("set-cookie"), null);
      assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...PNG]);
      assert.deepEqual(calls, [`https://www.google.com/s2/favicons?domain=${domain}&sz=128`]);
    });
  }

  it("passes upstream 404 through as 404", async () => {
    const res = await proxyLogo("no-favicon.example.com.png", upstream(404));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("answers 502 when upstream errors or is unreachable", async () => {
    assert.equal((await proxyLogo("a.com.png", upstream(500))).status, 502);
    const down = (async () => {
      throw new Error("boom");
    }) as typeof fetch;
    assert.equal((await proxyLogo("a.com.png", down)).status, 502);
  });

  it("rejects non-hostnames with 400 and never calls upstream", async () => {
    const calls: string[] = [];
    for (const file of ["nodots.png", "a.com", "evil.com&domain=x.png", "a b.com.png", "%2e%2e%2f.png", "a.com%00.png", "-a.com.png", "a..com.png", ".png", "%E0%A4%A.png"]) {
      assert.equal((await proxyLogo(file, upstream(200, calls))).status, 400, file);
    }
    assert.deepEqual(calls, []);
  });
});

describe("domainFromLogoFile / companyLogoUrl", () => {
  it("lowercases and round-trips companyLogoUrl for any domain", () => {
    for (const domain of ["cisco.com", "my-co.example.co.uk"]) {
      const file = companyLogoUrl(domain).replace("/logos/", "");
      assert.equal(domainFromLogoFile(file), domain);
    }
    assert.equal(domainFromLogoFile("Cisco.COM.png"), "cisco.com");
  });

  it("is a same-origin .png path a crawler may fetch: no query string, not under /api/", () => {
    for (const domain of ["cisco.com", "my-co.example.co.uk"]) {
      const url = companyLogoUrl(domain);
      assert.equal(url, `/logos/${domain}.png`);
      assert.ok(!url.includes("?"), url);
      assert.ok(!url.startsWith("/api/"), url);
    }
  });
});
