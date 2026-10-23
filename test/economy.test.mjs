// Staked-run bankroll and test-wallet ledger.
//
// These are the two pieces of money arithmetic that must not drift: the
// surviving Act I stack determines the back-room bankroll, and a test wallet
// is a durable ledger rather than a UI number.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { START_CHIPS, ECARD_START_CHIPS } from '../shared/constants.js';
import {
  bankrollZatsFor, duelChipZats, economyCommitmentHash, finalPayoutZats, potZatsFor,
} from '../shared/economy.js';
import { verifyAudit } from '../shared/audit.js';
import { Table } from '../server/game.mjs';
import { Store } from '../server/store.mjs';

const STAKE = 5_000_000; // 0.05 ZEC

function soloTable() {
  const table = new Table({ mode: 'solo', stakeZats: STAKE, timers: false, phaseScale: 1, now: () => 1_000 });
  table.addSeat({ playerId: 'p_human', ua: 'uregtest1human' });
  table.status = 'finale';
  return table;
}

function arrangeFinale(table, { humanChips, humanChipsEnd = humanChips, opponentChips }) {
  const bankrollZats = bankrollZatsFor(humanChipsEnd, STAKE);
  table.seats[0].chips = humanChipsEnd;
  table.finale = {
    a: 0,
    b: -1,
    house: true,
    humanSide: 'a',
    bankrollZats,
    potZats: potZatsFor(bankrollZats),
    roles: { a: 'crown', b: 'rebel' },
    chips: { a: humanChips, b: opponentChips },
    round: 5,
    rounds: [],
    plays: {},
    ready: { a: true, b: true },
    lastRound: null,
    winner: null,
    winnerSeat: null,
    forfeit: null,
    split: false,
  };
  table._finishDuel();
  return table;
}

test('Act I chips carry the fare and the back room rescales them', () => {
  assert.equal(START_CHIPS, 40);
  assert.equal(ECARD_START_CHIPS, 100);
  assert.equal(bankrollZatsFor(40, STAKE), STAKE);
  assert.equal(bankrollZatsFor(32, STAKE), 4_000_000);
  assert.equal(bankrollZatsFor(0, STAKE), 0);
  assert.equal(duelChipZats(4_000_000), 40_000);
  assert.equal(potZatsFor(4_000_000), 8_000_000);
});

test('a winning final stack pays the matched pot, a loss pays nothing', () => {
  const win = { humanSide: 'a', bankrollZats: 4_000_000, chips: { a: 200, b: 0 }, winner: 'a', split: false };
  assert.equal(finalPayoutZats({ mode: 'solo', humanSide: 'a', finale: win }), 8_000_000);

  // The winner takes the matched pot, not merely the chips left on their side
  // of the table. A narrow 120/80 win still returns both bankrolls.
  const narrow = { humanSide: 'a', bankrollZats: 4_000_000, chips: { a: 120, b: 80 }, winner: 'a', split: false };
  assert.equal(finalPayoutZats({ mode: 'solo', humanSide: 'a', finale: narrow }), 8_000_000);

  const split = { humanSide: 'a', bankrollZats: 4_000_000, chips: { a: 100, b: 100 }, winner: 'split', split: true };
  assert.equal(finalPayoutZats({ mode: 'solo', humanSide: 'a', finale: split }), 4_000_000);

  const loss = { humanSide: 'a', bankrollZats: 4_000_000, chips: { a: 80, b: 120 }, winner: 'b', split: false };
  assert.equal(finalPayoutZats({ mode: 'solo', humanSide: 'a', finale: loss }), 0);
  assert.equal(finalPayoutZats({ mode: 'practice', humanSide: 'a', finale: win }), 0);
});

test('settlement pays the surviving stack and the audit re-derives it', async () => {
  const table = soloTable();
  arrangeFinale(table, { humanChips: 200, humanChipsEnd: 32, opponentChips: 0 });

  assert.equal(table.settlement.winnerSeat, 0);
  assert.equal(table.settlement.bankrollZats, 4_000_000);
  assert.equal(table.settlement.potZats, 8_000_000);
  assert.equal(table.settlement.payoutZats, 8_000_000);
  assert.equal(table.settlement.winnerUa, 'uregtest1human');

  const verdict = await verifyAudit(structuredClone(table.audit));
  assert.equal(
    verdict.errors.some((error) => /bankroll|settlement payout|settlement pot/.test(error)),
    false,
    verdict.errors.join('\n'),
  );

  const tampered = structuredClone(table.audit);
  tampered.finale.bankrollZats += 1;
  const bad = await verifyAudit(tampered);
  assert.ok(bad.errors.some((error) => /bankroll/i.test(error)), bad.errors.join('\n'));
  table.dispose();
});

test('economy commitment ignores settlement metadata and hand reveals but binds ledger changes', async () => {
  const table = soloTable();
  arrangeFinale(table, { humanChips: 200, humanChipsEnd: 32, opponentChips: 0 });
  const hash = await economyCommitmentHash(table.audit);
  const laterAudit = structuredClone(table.audit);
  laterAudit.settlement.status = 'paid';
  laterAudit.settlement.txid = 'a'.repeat(64);
  laterAudit.settlement.economyAnchor = { hash, txid: 'b'.repeat(64), status: 'published' };
  laterAudit.complete = !laterAudit.complete;
  laterAudit.log.push({ seq: 100, text: 'later settlement event' });
  laterAudit.act1.seats[0].act1HandReveal = { cards: ['rock'], salts: ['later'] };
  laterAudit.finale.hands = [{ side: 'a', reveal: { cards: ['special'] } }];
  assert.equal(await economyCommitmentHash(laterAudit), hash);

  laterAudit.act1.seats[0].chipsEnd -= 1;
  assert.notEqual(await economyCommitmentHash(laterAudit), hash);
  table.dispose();
});

test('a human who loses the back room receives no settlement', () => {
  const table = soloTable();
  arrangeFinale(table, { humanChips: 80, humanChipsEnd: 32, opponentChips: 120 });
  assert.equal(table.settlement.houseWon, true);
  assert.equal(table.settlement.payoutZats, 0);
  assert.equal(table.settlement.winnerUa, null);
  table.dispose();
});

test('a split returns the human bankroll', () => {
  const table = soloTable();
  arrangeFinale(table, { humanChips: 100, humanChipsEnd: 32, opponentChips: 100 });
  assert.equal(table.settlement.split, true);
  assert.equal(table.settlement.payoutZats, 4_000_000);
  table.dispose();
});

test('the test-wallet ledger debits conditionally and credits by token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derelict-ledger-'));
  const store = new Store(dir);
  try {
    store.recordTestWallet({ token: 'a'.repeat(48), address: 'uregtest1alpha', createdAt: 1 });
    assert.equal(Number(store.testWallet('a'.repeat(48)).balance_zats), 0);
    assert.equal(store.debitTestWallet('a'.repeat(48), 1_000_000), false, 'cannot overdraw');

    assert.equal(store.creditTestWallet('a'.repeat(48), 20_000_000), true);
    assert.equal(Number(store.testWallet('a'.repeat(48)).balance_zats), 20_000_000);
    assert.equal(store.testWalletByAddress('uregtest1alpha').token, 'a'.repeat(48));

    assert.equal(store.debitTestWallet('a'.repeat(48), 5_000_000), true);
    assert.equal(Number(store.testWallet('a'.repeat(48)).balance_zats), 15_000_000);
    assert.equal(store.debitTestWallet('a'.repeat(48), 15_000_001), false, 'cannot overdraw');
    assert.equal(Number(store.testWallet('a'.repeat(48)).balance_zats), 15_000_000);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
