import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the REAL SSRF guard (tsx resolves the @/ path alias from tsconfig).
import { assertSafeFetchUrl, isBlockedIp, UnsafeUrlError } from '@/lib/url-safety';

async function expectBlocked(url: string) {
    await assert.rejects(
        () => assertSafeFetchUrl(url),
        (e: unknown) => e instanceof UnsafeUrlError,
        `expected ${url} to be BLOCKED`,
    );
}

async function expectAllowed(url: string) {
    // Should resolve to a URL and NOT throw.
    const parsed = await assertSafeFetchUrl(url);
    assert.ok(parsed instanceof URL, `expected ${url} to be ALLOWED`);
}

describe('assertSafeFetchUrl — SSRF guard', () => {
    it('ALLOWS a normal public https URL', async () => {
        // example.com resolves to public IPs (real DNS lookup).
        await expectAllowed('https://example.com');
    });

    it('ALLOWS a literal public IP (no DNS needed)', async () => {
        await expectAllowed('https://1.1.1.1/');
    });

    it('BLOCKS http://localhost', async () => {
        await expectBlocked('http://localhost');
    });

    it('BLOCKS a *.localhost host', async () => {
        await expectBlocked('http://api.localhost/internal');
    });

    it('BLOCKS http://127.0.0.1 (loopback)', async () => {
        await expectBlocked('http://127.0.0.1');
    });

    it('BLOCKS http://169.254.169.254 (cloud metadata)', async () => {
        await expectBlocked('http://169.254.169.254/latest/meta-data/');
    });

    it('BLOCKS http://10.0.0.5 (private 10/8)', async () => {
        await expectBlocked('http://10.0.0.5');
    });

    it('BLOCKS http://192.168.1.1 (private 192.168/16)', async () => {
        await expectBlocked('http://192.168.1.1');
    });

    it('BLOCKS http://172.16.5.4 (private 172.16/12)', async () => {
        await expectBlocked('http://172.16.5.4');
    });

    it('BLOCKS IPv6 loopback [::1]', async () => {
        await expectBlocked('http://[::1]:8080/');
    });

    it('BLOCKS IPv6 unique-local [fc00::1]', async () => {
        await expectBlocked('http://[fc00::1]/');
    });

    it('BLOCKS IPv4-mapped IPv6 of a private addr', async () => {
        await expectBlocked('http://[::ffff:127.0.0.1]/');
    });

    it('BLOCKS file:///etc/passwd (non-http scheme)', async () => {
        await expectBlocked('file:///etc/passwd');
    });

    it('BLOCKS gopher:// (non-http scheme)', async () => {
        await expectBlocked('gopher://evil.example.com/');
    });

    it('BLOCKS an explicit-content domain', async () => {
        await expectBlocked('https://pornhub.com/');
    });

    it('BLOCKS a malformed URL', async () => {
        await expectBlocked('not a url');
    });
});

describe('isBlockedIp — range checks', () => {
    it('flags loopback / private / link-local v4', () => {
        for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '0.0.0.0']) {
            assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
        }
    });

    it('does NOT flag public v4', () => {
        for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '172.15.0.1']) {
            assert.equal(isBlockedIp(ip), false, `${ip} should be allowed`);
        }
    });

    it('flags loopback / unique-local / link-local v6', () => {
        for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1']) {
            assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
        }
    });

    it('does NOT flag public v6', () => {
        for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888']) {
            assert.equal(isBlockedIp(ip), false, `${ip} should be allowed`);
        }
    });
});
