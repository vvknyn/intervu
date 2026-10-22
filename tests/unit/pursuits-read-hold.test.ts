import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterPursuitsReadHold, holdPursuitsRead, releasePursuitsRead } from '../../src/lib/pursuits/read-hold';

const settled = async (p: Promise<void>) => (await Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 30))])) as boolean;

describe('pursuits read hold (I6)', () => {
    it('nothing held: the read goes at once', async () => {
        assert.equal(await settled(afterPursuitsReadHold()), true);
    });
    it('held: the read waits until released, then goes', async () => {
        holdPursuitsRead(10_000);
        const read = afterPursuitsReadHold();
        assert.equal(await settled(read), false);
        releasePursuitsRead();
        assert.equal(await settled(read), true);
        assert.equal(await settled(afterPursuitsReadHold()), true);
    });
    it('a hold that is never released ends at its maximum', async () => {
        holdPursuitsRead(20);
        assert.equal(await settled(afterPursuitsReadHold()), true);
        releasePursuitsRead();
    });
});

describe('non-row server actions queue behind the first search', () => {
    const page = readFileSync(path.join(process.cwd(), 'src/app/jobs/JobsContent.tsx'), 'utf8');
    it('the account-email read waits for firstSearchSettled', () => {
        const at = page.indexOf('void getAccountEmailStateAction()');
        assert.ok(at > 0);
        assert.match(page.slice(at - 300, at), /if \(!firstSearchSettled\) return;/);
    });
    it('the tracker read is held at mount and released on the first search settling', () => {
        assert.match(page, /holdPursuitsRead\(PURSUITS_HOLD_MAX_MS\)/);
        assert.match(page, /if \(!firstSearchSettled\) return;\s*releasePursuitsRead\(\);/);
    });
});
