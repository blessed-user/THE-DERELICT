// Table-level regressions for the two privacy/pacing fixes:
// - a connected human is never silently replaced by a house bot at muster
// - an unplayed hand cannot be published through hand_reveal
//
// Timers are disabled so these tests do not wait on wall-clock phase clocks.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Table } from '../server/game.mjs';
import { makeHand, handCommit } from '../shared/crypto.js';

function makeTable() {
  return new Table({ mode: 'practice', timers: false, phaseScale: 1, now: () => 1_000 });
}

test('muster keeps a connected human seat and waits for its hand', async () => {
  const table = makeTable();
  const host = table.addSeat({ playerId: 'p_host' });
  host.connected = true;
  table.addSeat({ playerId: 'p_gone' });
  await table.start();

  await table._musterTimeout();

  assert.equal(table.status, 'muster');
  assert.equal(table.phaseEndsAt, null, 'the clock should hold for a connected human');
  assert.equal(table.seats[0].isBot, false, 'the host must keep their seat');
  assert.equal(table.seats[0].replacedByHouse, false);
  assert.equal(table.seats[1].isBot, true, 'a disconnected seat may be taken by the house');

  const hand = await makeHand(['rock', 'rock', 'paper', 'paper', 'scissors', 'scissors']);
  const commit = await handCommit(table.id, 0, hand.root);
  const ack = await table.action(0, 'hand_commit', { root: hand.root, commit });
  assert.equal(ack.ok, true);
  assert.equal(table.seats[0].act1HandReady, true);

  table._beginAct1();
  assert.equal(table.status, 'act1', 'the table starts once the host seals');
  table.dispose();
});

test('resolve exposes the settled round to each seat', () => {
  const table = makeTable();
  table.addSeat({ connected: true });
  table.addSeat({ connected: true });
  table.status = 'act1';
  table.phase = 'reveal';
  table.cycle = 3;
  table.pairings = [[0, 1]];
  table.plays = {
    0: { reveal: { card: 'rock' } },
    1: { reveal: { card: 'scissors' } },
  };

  table._resolvePlays();

  assert.equal(table.phase, 'resolve');
  const snap = table.snapshotFor(0);
  assert.ok(snap.lastRound, 'the resolving seat must see the round');
  assert.equal(snap.lastRound.outcome, 'a');
  assert.equal(snap.lastRound.cycle, 3);
  assert.deepEqual(snap.lastRound.cards, { a: 'rock', b: 'scissors' });
  assert.equal(snap.lastRound.starsAfter.a, 4);
  assert.equal(snap.lastRound.starsAfter.b, 2);
  assert.equal(table.snapshotFor(1).lastRound.outcome, 'a', 'the opponent sees the same record');

  table.phase = 'trade';
  assert.equal(table.snapshotFor(0).lastRound, null, 'the round is only served during resolve');
  table.dispose();
});

test('Act I closes before an empty cycle when only one seat still holds a card', () => {
  const table = makeTable();
  for (let i = 0; i < 4; i++) table.addSeat({ connected: true });
  table.status = 'act1';
  table.phase = 'resolve';
  table.cycle = 7;
  [0, 1, 0, 0].forEach((left, i) => {
    table.seats[i].alive = true;
    table.seats[i].cardsLeft = left;
  });
  table._beginFinale = async () => {};

  table._afterResolve();

  assert.equal(table.status, 'act1_end', 'a lone card-holder cannot play another cycle');
  assert.equal(table.phase, 'act1_end');
  assert.ok(table.logEntries.some((e) => e.text.includes('NO PAIRS REMAIN')));
  table.dispose();
});

test('Act I keeps running while two seats can still play', () => {
  const table = makeTable();
  for (let i = 0; i < 4; i++) table.addSeat({ connected: true });
  table.status = 'act1';
  table.phase = 'resolve';
  table.cycle = 3;
  [1, 1, 0, 0].forEach((left, i) => {
    table.seats[i].alive = true;
    table.seats[i].cardsLeft = left;
  });

  table._afterResolve();

  assert.equal(table.status, 'act1');
  assert.equal(table.phase, 'trade', 'two card-holders still have a round to play');
  table.dispose();
});

test('hand_reveal is refused while the hand can still be played', async () => {
  const table = makeTable();
  table.addSeat({ connected: true });
  table.status = 'act1';
  table.phase = 'play';
  table.cycle = 1;
  table.seats[0].act1HandRoot = 'a'.repeat(64);

  const act1 = await table.action(0, 'hand_reveal', {
    act: 'act1',
    cards: ['rock', 'paper'],
    salts: ['0'.repeat(32), '1'.repeat(32)],
  });
  assert.equal(act1.ok, false);
  assert.match(act1.error, /stays sealed/);

  table.status = 'finale';
  const duel = await table.action(0, 'hand_reveal', {
    act: 'duel',
    cards: ['crown'],
    salts: ['0'.repeat(32)],
  });
  assert.equal(duel.ok, false);
  assert.match(duel.error, /stays sealed/);

  table.dispose();
});
