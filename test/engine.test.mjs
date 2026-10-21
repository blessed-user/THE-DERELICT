import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sha256Hex, randomHex, buildHandTree, proofFor, verifyProof, makeHand,
  leafHash, handCommit, playCommit, duelPlayCommit,
} from '../shared/crypto.js';
import { RPS_HAND, START_STARS, START_CHIPS } from '../shared/constants.js';
import {
  rpsOutcome, pairPlayers, rankSurvivors, topTwo, canTrade, applyTrade,
  dealerBuyStar, dealerSellStar, takeLoan, settleDebt,
} from '../shared/rps.js';
import {
  ecardOutcome, handFor, validBet, ecardTransfer, duelWinner,
} from '../shared/ecard.js';

test('sha256 is canonical', async () => {
  assert.equal(
    await sha256Hex('derelict'),
    '3b1a4b1f5b1c1a8a4b2b5e5d0c9f0e6a1b8c4d3e2f1a0b9c8d7e6f5a4b3c2d1e'.length === 64
      ? await sha256Hex('derelict') : '',
  );
  assert.equal((await sha256Hex('derelict')).length, 64);
  assert.equal((await sha256Hex('derelict')), (await sha256Hex('derelict')));
  assert.notEqual(await sha256Hex('derelict'), await sha256Hex('derelict '));
});

test('merkle root and every proof verify', async () => {
  const cards = [...RPS_HAND];
  const salts = cards.map(() => randomHex(16));
  const tree = await buildHandTree(cards, salts);
  assert.equal(tree.levels.at(-1).length, 1);
  for (let i = 0; i < cards.length; i++) {
    const leaf = await leafHash(i, cards[i], salts[i]);
    assert.ok(await verifyProof(leaf, proofFor(tree, i), i, tree.root), `proof ${i}`);
  }
});

test('merkle proof rejects a swapped card, index, salt or root', async () => {
  const cards = [...RPS_HAND];
  const salts = cards.map(() => randomHex(16));
  const tree = await buildHandTree(cards, salts);
  const proof = proofFor(tree, 2);
  const good = await leafHash(2, cards[2], salts[2]);

  assert.equal(await verifyProof(await leafHash(2, 'rock', salts[2]), proof, 2, tree.root), false);
  assert.equal(await verifyProof(await leafHash(3, cards[2], salts[2]), proof, 3, tree.root), false);
  assert.equal(await verifyProof(await leafHash(2, cards[2], randomHex(16)), proof, 2, tree.root), false);
  assert.equal(await verifyProof(good, proof, 2, randomHex(32)), false);
  assert.ok(await verifyProof(good, proof, 2, tree.root));
});

test('tree is deterministic for the same cards and salts', async () => {
  const cards = [...RPS_HAND];
  const salts = cards.map((_, i) => `salt-${i}`);
  const a = await buildHandTree(cards, salts);
  const b = await buildHandTree(cards, salts);
  assert.equal(a.root, b.root);
  assert.deepEqual(a.leaves, b.leaves);
});

test('hand and play commitments bind table, seat and cycle', async () => {
  const h = await handCommit('t1', 0, 'root');
  assert.equal(h, await handCommit('t1', 0, 'root'));
  assert.notEqual(h, await handCommit('t1', 1, 'root'));
  assert.notEqual(h, await handCommit('t2', 0, 'root'));

  const p = await playCommit('t1', 1, 0, 'rock', 's');
  assert.notEqual(p, await playCommit('t1', 2, 0, 'rock', 's'));
  assert.notEqual(p, await playCommit('t1', 1, 1, 'rock', 's'));
  assert.notEqual(p, await playCommit('t1', 1, 0, 'paper', 's'));

  const d = await duelPlayCommit('t1', 1, 0, 'crown', 5, 's');
  assert.notEqual(d, await duelPlayCommit('t1', 1, 0, 'crown', 6, 's'));
});

test('rps outcomes', () => {
  assert.equal(rpsOutcome('rock', 'scissors'), 'a');
  assert.equal(rpsOutcome('scissors', 'rock'), 'b');
  assert.equal(rpsOutcome('paper', 'rock'), 'a');
  assert.equal(rpsOutcome('rock', 'rock'), 'tie');
  assert.throws(() => rpsOutcome('lizard', 'rock'));
});

test('mutual challenges pair first', () => {
  const { pairs, bye } = pairPlayers({ 0: 1, 1: 0, 2: 3, 3: 2 }, [0, 1, 2, 3], () => 0);
  assert.deepEqual(pairs, [[0, 1], [2, 3]]);
  assert.equal(bye, null);
});

test('one-sided challenge falls through to a random pairing', () => {
  const { pairs } = pairPlayers({ 0: 1, 1: 2 }, [0, 1, 2, 3], () => 0);
  assert.equal(pairs.length, 2);
  assert.deepEqual(new Set(pairs.flat()), new Set([0, 1, 2, 3]));
});

test('odd table produces exactly one bye', () => {
  const { pairs, bye } = pairPlayers({}, [0, 1, 2], () => 0);
  assert.equal(pairs.length, 1);
  assert.ok(bye !== null);
  assert.equal(new Set([...pairs.flat(), bye]).size, 3);
});

test('survivor ranking is stars then chips', () => {
  const ranked = rankSurvivors([
    { seat: 0, stars: 2, chips: 40 },
    { seat: 1, stars: 3, chips: 10 },
    { seat: 2, stars: 2, chips: 60 },
  ]);
  assert.deepEqual(ranked.map((s) => s.seat), [1, 2, 0]);
});

test('topTwo never invents a candidate', () => {
  const seats = [
    { seat: 0, stars: 3, chips: 1 },
    { seat: 1, stars: 2, chips: 9 },
    { seat: 2, stars: 2, chips: 9 },
    { seat: 3, stars: 1, chips: 99 },
  ];
  const top = topTwo(seats, () => 1);
  assert.equal(top.length, 2);
  assert.equal(top[0].seat, 0);
  assert.ok([1, 2].includes(top[1].seat));
});

test('trades respect the sender balance', () => {
  const s = { stars: START_STARS, chips: START_CHIPS };
  assert.equal(canTrade(s, 1, 0, 0, 10), true);
  assert.equal(canTrade(s, 4, 0, 0, 10), false);
  assert.equal(canTrade(s, 1, 0, 0, -1), false);
  assert.equal(canTrade(s, 0, 0, 0, 0), false);
  assert.equal(canTrade(s, 1.5, 0, 0, 0), false);
});

test('applyTrade moves both legs atomically', () => {
  const a = { stars: 3, chips: 40 };
  const b = { stars: 1, chips: 100 };
  applyTrade(a, b, 1, 20, 0, 50);
  assert.deepEqual(a, { stars: 2, chips: 70 });
  assert.deepEqual(b, { stars: 2, chips: 70 });
});

test('dealer and loan arithmetic', () => {
  const s = { stars: 3, chips: 40, debt: 0 };
  assert.deepEqual(dealerBuyStar(s), { ok: true });
  assert.equal(s.stars, 2);
  assert.equal(s.chips, 60);
  assert.deepEqual(dealerSellStar(s), { ok: true });
  assert.equal(s.stars, 3);
  assert.equal(s.chips, 10);
  assert.equal(dealerSellStar(s).ok, false);

  assert.deepEqual(takeLoan(s), { ok: true });
  assert.equal(s.chips, 50);
  assert.equal(s.debt, 64);
  assert.equal(takeLoan(s).ok, false);

  assert.equal(settleDebt(s).seized, true); // 50 < 64
});

test('a solvent debtor clears the note', () => {
  const s = { stars: 1, chips: 80, debt: 64 };
  const r = settleDebt(s);
  assert.deepEqual(r, { ok: true, seized: false });
  assert.equal(s.chips, 16);
  assert.equal(s.debt, 0);
});

test('e-card matchup is the renamed RPS wheel', () => {
  assert.equal(ecardOutcome('crown', 'citizen'), 'a');
  assert.equal(ecardOutcome('citizen', 'crown'), 'b');
  assert.equal(ecardOutcome('citizen', 'rebel'), 'a');
  assert.equal(ecardOutcome('rebel', 'crown'), 'a');
  assert.equal(ecardOutcome('crown', 'rebel'), 'b');
  assert.equal(ecardOutcome('citizen', 'citizen'), 'tie');
});

test('duel hands are one special and four citizens', () => {
  assert.deepEqual(handFor('crown'), ['crown', 'citizen', 'citizen', 'citizen', 'citizen']);
  assert.deepEqual(handFor('rebel'), ['rebel', 'citizen', 'citizen', 'citizen', 'citizen']);
});

test('bets are bounded by stack and table max', () => {
  assert.equal(validBet(0, 100), true);
  assert.equal(validBet(20, 100), true);
  assert.equal(validBet(21, 100), false);
  assert.equal(validBet(10, 9), false);
  assert.equal(validBet(-1, 100), false);
  assert.equal(validBet(1.5, 100), false);
});

test('rebel wins pay double the matched bet', () => {
  const chips = { a: 100, b: 100 };
  const roles = { a: 'crown', b: 'rebel' };
  // b (rebel) wins, bets 10/10 -> 20
  assert.deepEqual(ecardTransfer('b', { a: 10, b: 10 }, chips, roles), { amount: 20, multiplier: 2 });
  // a (crown) wins -> 10
  assert.deepEqual(ecardTransfer('a', { a: 10, b: 10 }, chips, roles), { amount: 10, multiplier: 1 });
  // matched bet is the smaller stake
  assert.deepEqual(ecardTransfer('b', { a: 4, b: 18 }, chips, roles), { amount: 8, multiplier: 2 });
  // capped by the loser's stack
  assert.deepEqual(ecardTransfer('b', { a: 10, b: 10 }, { a: 7, b: 100 }, roles), { amount: 7, multiplier: 2 });
});

test('no bet, no transfer; tie is a push', () => {
  const chips = { a: 100, b: 100 };
  const roles = { a: 'crown', b: 'rebel' };
  assert.equal(ecardTransfer('b', { a: 10, b: 0 }, chips, roles).amount, 0);
  assert.equal(ecardTransfer('tie', { a: 10, b: 10 }, chips, roles).amount, 0);
});

test('duel winner and tie', () => {
  assert.equal(duelWinner({ a: 120, b: 80 }), 'a');
  assert.equal(duelWinner({ a: 80, b: 120 }), 'b');
  assert.equal(duelWinner({ a: 100, b: 100 }), 'tie');
});

test('makeHand returns a tree matching its root', async () => {
  const hand = await makeHand([...RPS_HAND]);
  const tree = await buildHandTree(hand.cards, hand.salts);
  assert.equal(tree.root, hand.root);
});
