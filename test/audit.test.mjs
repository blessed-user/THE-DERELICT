// The audit verifier must reject every tamper we can think of, and accept the
// untouched fixture. The fixture is a completed practice voyage (one human,
// three house seats) captured by e2e/protocol.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { verifyAudit } from '../shared/audit.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/audit.json', import.meta.url));
const raw = JSON.parse(await readFile(FIXTURE, 'utf8'));

function clone() {
  return structuredClone(raw);
}

async function expectFailure(mutate, pattern) {
  const audit = clone();
  mutate(audit);
  const verdict = await verifyAudit(audit);
  assert.equal(verdict.ok, false, 'tampered audit must not verify');
  assert.ok(verdict.errors.length > 0, 'expected at least one error');
  if (pattern) {
    assert.ok(
      verdict.errors.some((e) => pattern.test(e)),
      `expected an error matching ${pattern}; got:\n${verdict.errors.join('\n')}`,
    );
  }
  return verdict;
}

test('the untouched fixture verifies', async () => {
  const verdict = await verifyAudit(clone());
  assert.deepEqual(verdict.errors, []);
  assert.equal(verdict.ok, true);
});

test('an incomplete audit is rejected', async () => {
  await expectFailure((a) => { a.complete = false; }, /complete/i);
});

test('a card swapped in a revealed hand breaks the root', async () => {
  await expectFailure((a) => {
    a.act1.seats[0].act1HandReveal.cards[0] = a.act1.seats[0].act1HandReveal.cards[0] === 'rock' ? 'paper' : 'rock';
  }, /root|commit/i);
});

test('a play card swapped after commit is rejected', async () => {
  await expectFailure((a) => {
    const play = a.act1.playArchive[0].plays['0'];
    play.reveal.card = play.reveal.card === 'rock' ? 'paper' : 'rock';
  }, /commit|proof|leaf|root|hand/i);
});

test('a tampered inclusion proof is rejected', async () => {
  await expectFailure((a) => {
    a.act1.playArchive[0].plays['0'].reveal.proof[0].hash = '0'.repeat(64);
  }, /proof|leaf|root|hand/i);
});

test('a forged round outcome or star transfer is rejected', async () => {
  await expectFailure((a) => {
    const round = a.act1.rounds[0];
    round.outcome = round.outcome === 'a' ? 'b' : 'a';
    round.transfer = round.transfer === 0 ? 1 : 0;
  }, /round|outcome|transfer|ledger|stars/i);
});

test('a mutated settlement payout is rejected', async () => {
  await expectFailure((a) => {
    a.settlement.payoutZats = 123456789;
  }, /settlement|payout|stake/i);
});

test('a flipped duel card is rejected', async () => {
  await expectFailure((a) => {
    const round = a.finale.rounds[0];
    const side = round.cards.a === 'crown' ? 'a' : 'b';
    round.cards[side] = round.cards[side] === 'crown' ? 'citizen' : 'crown';
  }, /duel|commit|proof|round|outcome/i);
});

test('a mutated duel bet is rejected', async () => {
  await expectFailure((a) => {
    a.finale.rounds[0].bets.a += 1;
  }, /duel|bet|commit|chips|settle/i);
});

test('a changed duel winner is rejected', async () => {
  await expectFailure((a) => {
    a.settlement.winnerSeat = a.settlement.winnerSeat === 0 ? 1 : 0;
  }, /settlement|winner|finale/i);
});
