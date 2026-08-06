import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { formAuditExpression, runFormAudit, auditThenWatch, pickBestWatchUrl } from '../../openclaw/scripts/viewer/audit.mjs';

const CANNED_AUDIT = JSON.stringify({ controls: [], summary: { requiredAndEmpty: [], unansweredQuestions: [] } });

describe('formAuditExpression', () => {
  it('wraps form-audit.js verbatim as an immediately-invoked expression', () => {
    const expr = formAuditExpression();
    // Proves the REAL file's contents are in play, not a stand-in — this
    // string only exists in form-audit.js's own output-shape comment.
    assert.match(expr, /requiredAndEmpty/);
    assert.match(expr, /^\([\s\S]*\)\(\)$/);
  });
});

describe('runFormAudit', () => {
  it('evaluates the form-audit expression and returns whatever the page returns', async () => {
    let seenExpression: string | undefined;
    const evaluate = async (expression: string) => { seenExpression = expression; return CANNED_AUDIT; };
    const result = await runFormAudit(evaluate);
    assert.equal(result, CANNED_AUDIT);
    assert.equal(seenExpression, formAuditExpression());
  });
});

describe('auditThenWatch', () => {
  it('prints the AUDIT line from a stubbed CDP evaluate, then hands off to startWatch', async () => {
    const logged: string[] = [];
    const evaluate = async () => CANNED_AUDIT;
    const startWatch = async () => ({ lanUrl: 'http://lan', tailnetUrl: null, tailnetIsReady: false, watchUrl: null });
    const result = await auditThenWatch(evaluate, startWatch, (line: string) => logged.push(line));
    assert.deepEqual(logged, [`AUDIT: ${CANNED_AUDIT}`]);
    assert.equal(result.lanUrl, 'http://lan');
  });

  it('still prints the AUDIT line even when startWatch (the transports) throws', async () => {
    // The real failure this guards: a dead WebRTC credential or an
    // offline LAN must never retroactively erase an audit already on
    // stdout — watching is a convenience, the audit is not.
    const logged: string[] = [];
    const evaluate = async () => CANNED_AUDIT;
    const startWatch = async () => { throw new Error('no local network address found'); };
    await assert.rejects(
      () => auditThenWatch(evaluate, startWatch, (line: string) => logged.push(line)),
      /no local network address found/,
    );
    assert.deepEqual(logged, [`AUDIT: ${CANNED_AUDIT}`]);
  });

  it('still hands off to startWatch even when the page-side evaluate itself throws', async () => {
    // Symmetric case: a broken audit must not cost the user their watch
    // link either — the two failure modes are independent.
    const evaluate = async () => { throw new Error('page navigated away'); };
    const startWatch = async () => ({ lanUrl: 'http://lan', tailnetUrl: null, tailnetIsReady: false, watchUrl: null });
    const result = await auditThenWatch(evaluate, startWatch, () => {});
    assert.equal(result.lanUrl, 'http://lan');
  });
});

describe('pickBestWatchUrl', () => {
  it('prefers a verified tailnet link over everything else', () => {
    const best = pickBestWatchUrl({ tailnetUrl: 'https://tailnet', tailnetIsReady: true, watchUrl: 'https://doorbell', lanUrl: 'http://lan' });
    assert.equal(best, 'https://tailnet');
  });

  it('falls back to the doorbell link when tailnet is unverified', () => {
    const best = pickBestWatchUrl({ tailnetUrl: 'https://tailnet', tailnetIsReady: false, watchUrl: 'https://doorbell', lanUrl: 'http://lan' });
    assert.equal(best, 'https://doorbell');
  });

  it('falls back to the LAN link when only it is available', () => {
    const best = pickBestWatchUrl({ tailnetUrl: null, tailnetIsReady: false, watchUrl: null, lanUrl: 'http://lan' });
    assert.equal(best, 'http://lan');
  });

  it('returns null when nothing printed at all', () => {
    assert.equal(pickBestWatchUrl({ tailnetUrl: null, tailnetIsReady: false, watchUrl: null, lanUrl: null }), null);
  });
});
