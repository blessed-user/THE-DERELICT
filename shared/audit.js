// THE DERELICT — independent audit.
//
// Given the JSON served at /api/tables/:id/audit, rebuild every committed
// hand, verify every play's inclusion proof and play commitment, replay the
// star/chip ledger, and recompute the duel. It does not trust the server's
// summary fields; it derives them again.
//
//   node scripts/verify-audit.mjs e2e/audit.json
//
// A complete audit is the point: if a player refuses to reveal an unplayed
// hand, the cryptographic record is incomplete and this verifier says so.

import {
  buildHandTree, handCommit, duelHandCommit, leafHash, verifyProof,
  playCommit, duelPlayCommit,
} from './crypto.js';
import {
  RPS_HAND, START_STARS, START_CHIPS, STAR_DEALER_BUY, STAR_DEALER_SELL,
  LOAN_PRINCIPAL, LOAN_REPAY, ECARD_START_CHIPS, ECARD_ROUNDS,
} from './constants.js';
import { bankrollZatsFor, finalPayoutZats, potZatsFor } from './economy.js';
import { rpsOutcome, rankSurvivors } from './rps.js';
import { handFor, ecardOutcome, ecardTransfer, duelWinner, validBet } from './ecard.js';

const HEX64 = /^[0-9a-f]{64}$/;
const RPS_CARDS = new Set(['rock', 'paper', 'scissors']);

function countCards(cards) {
  const counts = {};
  for (const card of cards) counts[card] = (counts[card] ?? 0) + 1;
  return counts;
}

export async function verifyAudit(audit) {
  const errors = [];
  const warnings = [];
  const err = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!audit || typeof audit !== 'object') return { ok: false, errors: ['not an audit document'], warnings };
  if (audit.version !== 1) err(`unknown audit version ${audit.version}`);
  if (audit.game !== 'the-derelict') err('wrong game');
  if (!audit.act1?.seats?.length) return { ok: false, errors: ['no seats in audit'], warnings };

  const tableId = audit.tableId;
  const seats = audit.act1.seats;
  const seatByNumber = new Map(seats.map((s) => [s.seat, s]));
  const hands = new Map();

  // ---- committed Act I hands ----
  for (const seat of seats) {
    if (!seat.act1HandReveal) {
      if (audit.complete) err(`seat ${seat.seat}: no full-hand reveal`);
      else warn(`seat ${seat.seat}: hand not revealed`);
      continue;
    }
    const { cards, salts } = seat.act1HandReveal;
    if (!Array.isArray(cards) || !Array.isArray(salts) || cards.length !== salts.length) {
      err(`seat ${seat.seat}: malformed hand reveal`);
      continue;
    }
    const tree = await buildHandTree(cards, salts);
    if (tree.root !== seat.act1HandRoot) err(`seat ${seat.seat}: hand root does not rebuild`);
    const commit = await handCommit(tableId, seat.seat, tree.root);
    if (commit !== seat.act1HandCommit) err(`seat ${seat.seat}: hand commitment does not match root`);
    if (cards.length !== RPS_HAND.length) err(`seat ${seat.seat}: hand has ${cards.length} cards, expected ${RPS_HAND.length}`);
    const counts = countCards(cards);
    for (const card of ['rock', 'paper', 'scissors']) {
      if ((counts[card] ?? 0) !== 2) err(`seat ${seat.seat}: hand has ${counts[card] ?? 0} ${card}, expected 2`);
    }
    hands.set(seat.seat, { cards, salts, tree, root: tree.root });
  }

  // ---- every Act I play: commitment, proof, leaf uniqueness ----
  const usedLeaves = new Map(seats.map((s) => [s.seat, new Set()]));
  const archiveByCycle = new Map();
  for (const archive of audit.act1.playArchive ?? []) {
    if (!Number.isInteger(archive.cycle)) { err('play archive cycle is not an integer'); continue; }
    if (archiveByCycle.has(archive.cycle)) err(`cycle ${archive.cycle}: duplicate play archive`);
    archiveByCycle.set(archive.cycle, archive);
    const paired = new Set((archive.pairings ?? []).flat());
    for (const [seatKey, rec] of Object.entries(archive.plays ?? {})) {
      const seat = Number(seatKey);
      if (!seatByNumber.has(seat)) { err(`cycle ${archive.cycle}: unknown seat ${seat}`); continue; }
      if (!paired.has(seat)) err(`cycle ${archive.cycle}: seat ${seat} played but is not paired`);
      if (!rec) continue;
      if (!HEX64.test(rec.commit ?? '')) err(`cycle ${archive.cycle} seat ${seat}: bad play commitment`);
      if (!rec.reveal) { warn(`cycle ${archive.cycle} seat ${seat}: committed without revealing`); continue; }
      const r = rec.reveal;
      if (!RPS_CARDS.has(r.card)) { err(`cycle ${archive.cycle} seat ${seat}: unknown card ${r.card}`); continue; }
      if (!Number.isInteger(r.index) || r.index < 0 || r.index >= RPS_HAND.length) {
        err(`cycle ${archive.cycle} seat ${seat}: bad card index`); continue;
      }
      const expected = await playCommit(tableId, archive.cycle, seat, r.card, r.playSalt);
      if (expected !== rec.commit) err(`cycle ${archive.cycle} seat ${seat}: play commitment mismatch`);
      const hand = hands.get(seat);
      if (!hand) { err(`cycle ${archive.cycle} seat ${seat}: no revealed hand to verify against`); continue; }
      const leaf = await leafHash(r.index, r.card, r.salt);
      if (usedLeaves.get(seat).has(leaf)) err(`cycle ${archive.cycle} seat ${seat}: card leaf reused`);
      usedLeaves.get(seat).add(leaf);
      if (!Array.isArray(r.proof) || !(await verifyProof(leaf, r.proof, r.index, hand.root))) {
        err(`cycle ${archive.cycle} seat ${seat}: card is not in the committed hand`);
      }
    }
  }

  // ---- Act I round outcomes vs. revealed cards ----
  const roundsByCycle = new Map();
  for (const round of audit.act1.rounds ?? []) {
    if (!Array.isArray(round.pair) || round.pair.length !== 2) { err('malformed round pair'); continue; }
    const [a, b] = round.pair;
    if (!seatByNumber.has(a) || !seatByNumber.has(b)) { err(`round cycle ${round.cycle}: unknown seat`); continue; }
    const archive = archiveByCycle.get(round.cycle);
    if (!archive) warn(`cycle ${round.cycle}: round has no play archive`);
    const cardA = round.cards?.a ?? null;
    const cardB = round.cards?.b ?? null;
    for (const [seat, card] of [[a, cardA], [b, cardB]]) {
      if (card == null) {
        const rec = archive?.plays?.[seat];
        if (rec?.reveal) err(`cycle ${round.cycle} seat ${seat}: round hides a revealed card`);
      } else {
        const rec = archive?.plays?.[seat];
        if (!rec?.reveal) err(`cycle ${round.cycle} seat ${seat}: round claims a card with no reveal`);
        else if (rec.reveal.card !== card) err(`cycle ${round.cycle} seat ${seat}: round card disagrees with proof`);
      }
    }
    if (cardA && cardB) {
      const expected = rpsOutcome(cardA, cardB);
      if (round.outcome !== expected) err(`cycle ${round.cycle}: outcome ${round.outcome} but cards give ${expected}`);
      if (expected !== 'tie' && round.transfer !== 1) err(`cycle ${round.cycle}: winning round transfer is ${round.transfer}`);
      if (expected === 'tie' && round.transfer !== 0) err(`cycle ${round.cycle}: tie transfers ${round.transfer}`);
    } else if (cardA || cardB) {
      const present = cardA ? a : b;
      const absent = cardA ? b : a;
      if (round.outcome !== `forfeit-${absent}`) err(`cycle ${round.cycle}: forfeit outcome is ${round.outcome}`);
      if (round.transfer !== 1) err(`cycle ${round.cycle}: forfeit transfer is ${round.transfer}`);
      void present;
    } else if (round.outcome !== 'both-forfeit') {
      err(`cycle ${round.cycle}: both cards missing but outcome is ${round.outcome}`);
    }
    const bucket = roundsByCycle.get(round.cycle) ?? [];
    bucket.push(round);
    roundsByCycle.set(round.cycle, bucket);
  }

  // ---- Act I ledger replay ----
  const ledger = new Map(seats.map((s) => [s.seat, {
    stars: START_STARS, chips: START_CHIPS, debt: 0, alive: true, eliminated: null,
  }]));
  const accepted = new Map();
  for (const seat of seats) {
    for (const trade of seat.history?.trades ?? []) {
      if (!trade.offerId) { err(`seat ${seat.seat}: trade without offerId`); continue; }
      if (!accepted.has(trade.offerId)) accepted.set(trade.offerId, trade);
      else {
        const first = accepted.get(trade.offerId);
        if (JSON.stringify(first.give) !== JSON.stringify(trade.give) ||
            JSON.stringify(first.want) !== JSON.stringify(trade.want)) {
          err(`offer ${trade.offerId}: two seats recorded different terms`);
        }
      }
    }
  }
  const maxCycle = Math.max(
    0,
    ...(audit.act1.rounds ?? []).map((r) => r.cycle ?? 0),
    ...[...accepted.values()].map((t) => t.cycle ?? 0),
    ...seats.flatMap((s) => [
      ...(s.history?.dealer ?? []).map((d) => d.cycle ?? 0),
      ...(s.history?.loans ?? []).map((l) => l.cycle ?? 0),
    ]),
  );

  for (let cycle = 1; cycle <= maxCycle; cycle++) {
    for (const offer of accepted.values()) {
      if ((offer.cycle ?? 0) !== cycle) continue;
      const from = ledger.get(offer.from);
      const to = ledger.get(offer.to);
      if (!from || !to) { err(`offer ${offer.offerId}: unknown seat`); continue; }
      if (!from.alive || !to.alive) err(`offer ${offer.offerId}: executed with a dark seat`);
      from.stars += -offer.give.stars + offer.want.stars;
      from.chips += -offer.give.chips + offer.want.chips;
      to.stars += -offer.want.stars + offer.give.stars;
      to.chips += -offer.want.chips + offer.give.chips;
      if (from.stars < 0 || to.stars < 0 || from.chips < 0 || to.chips < 0) {
        err(`offer ${offer.offerId}: executed into a negative balance`);
      }
    }

    for (const seat of seats) {
      const entry = ledger.get(seat.seat);
      for (const op of seat.history?.dealer ?? []) {
        if (op.cycle !== cycle) continue;
        if (op.op === 'buy_star') { entry.stars -= 1; entry.chips += STAR_DEALER_BUY; }
        else if (op.op === 'sell_star') { entry.stars += 1; entry.chips -= STAR_DEALER_SELL; }
        else err(`seat ${seat.seat}: unknown dealer op ${op.op}`);
        if (entry.stars < 0 || entry.chips < 0) err(`seat ${seat.seat}: dealer left a negative balance`);
      }
      for (const loan of seat.history?.loans ?? []) {
        if (loan.cycle !== cycle) continue;
        entry.chips += LOAN_PRINCIPAL;
        entry.debt += LOAN_REPAY;
        if (entry.debt !== LOAN_REPAY) err(`seat ${seat.seat}: more than one loan`);
      }
    }

    for (const round of roundsByCycle.get(cycle) ?? []) {
      const [a, b] = round.pair;
      const ea = ledger.get(a);
      const eb = ledger.get(b);
      if (!ea || !eb) { err(`cycle ${cycle}: round references a seat with no ledger`); continue; }
      if (round.starsBefore?.a != null && ea.stars !== round.starsBefore.a) {
        err(`cycle ${cycle}: seat ${a} stars before ${round.starsBefore.a}, ledger says ${ea.stars}`);
      }
      if (round.starsBefore?.b != null && eb.stars !== round.starsBefore.b) {
        err(`cycle ${cycle}: seat ${b} stars before ${round.starsBefore.b}, ledger says ${eb.stars}`);
      }
      if (round.outcome === 'a') { ea.stars += 1; eb.stars -= 1; }
      else if (round.outcome === 'b') { eb.stars += 1; ea.stars -= 1; }
      else if (round.outcome === 'both-forfeit') { ea.stars = Math.max(0, ea.stars - 1); eb.stars = Math.max(0, eb.stars - 1); }
      else if (round.outcome?.startsWith('forfeit-')) {
        const absent = Number(round.outcome.split('-')[1]);
        const eAbsent = ledger.get(absent);
        const ePresent = ledger.get(absent === a ? b : a);
        if (eAbsent && ePresent) { eAbsent.stars -= 1; ePresent.stars += 1; }
      }
    }

    for (const entry of ledger.values()) {
      if (entry.alive && entry.stars <= 0) {
        entry.stars = 0;
        entry.alive = false;
        entry.eliminated = cycle;
      }
    }
  }

  // Debt comes due before the back room opens.
  for (const seat of seats) {
    const entry = ledger.get(seat.seat);
    if (!entry) continue;
    if (entry.alive && entry.debt > 0) {
      if (entry.chips >= entry.debt) { entry.chips -= entry.debt; entry.debt = 0; }
      else { entry.alive = false; entry.eliminated = entry.eliminated ?? maxCycle + 1; }
    }
  }

  for (const seat of seats) {
    const entry = ledger.get(seat.seat);
    if (!entry) continue;
    if (entry.stars !== seat.starsEnd) err(`seat ${seat.seat}: stars end ${seat.starsEnd}, ledger ${entry.stars}`);
    if (entry.chips !== seat.chipsEnd) err(`seat ${seat.seat}: chips end ${seat.chipsEnd}, ledger ${entry.chips}`);
    if (entry.alive !== Boolean(seat.alive)) err(`seat ${seat.seat}: alive ${seat.alive}, ledger ${entry.alive}`);
    if (entry.eliminated != null && seat.eliminatedCycle != null &&
        entry.eliminated !== seat.eliminatedCycle && entry.debt > 0) {
      warn(`seat ${seat.seat}: seizure cycle ${seat.eliminatedCycle} vs ledger ${entry.eliminated}`);
    }
  }

  // ---- the back room ----
  if (audit.finale) {
    const f = audit.finale;
    const survivors = seats
      .filter((s) => ledger.get(s.seat)?.alive)
      .map((s) => ({ seat: s.seat, ...ledger.get(s.seat) }));
    const ranked = rankSurvivors(survivors);
    const expectedA = ranked[0]?.seat ?? null;
    const expectedB = ranked[1]?.seat ?? -1;
    if (f.a !== expectedA) err(`finale seat A is ${f.a}, expected ${expectedA}`);
    if (f.b !== expectedB) err(`finale seat B is ${f.b}, expected ${expectedB}`);
    if (f.roles?.a !== 'crown' || f.roles?.b !== 'rebel') err('finale roles are not crown/rebel');

    const finaleHands = new Map();
    for (const side of ['a', 'b']) {
      const h = (f.hands ?? []).find((x) => x.side === side);
      if (!h) { err(`finale: no hand record for ${side}`); continue; }
      const seatNumber = side === 'a' ? f.a : f.b;
      if (h.seat !== seatNumber) err(`finale ${side}: hand seat ${h.seat}, expected ${seatNumber}`);
      if (!h.reveal) { err(`finale ${side}: full hand not revealed`); continue; }
      const tree = await buildHandTree(h.reveal.cards, h.reveal.salts);
      if (tree.root !== h.root) err(`finale ${side}: hand root does not rebuild`);
      const commit = await duelHandCommit(tableId, h.seat, tree.root);
      if (commit !== h.commit) err(`finale ${side}: hand commitment does not match root`);
      const expectedHand = handFor(f.roles[side]);
      const counts = countCards(h.reveal.cards);
      if (h.reveal.cards.length !== 5) err(`finale ${side}: hand has ${h.reveal.cards.length} cards`);
      if ((counts[f.roles[side]] ?? 0) !== 1) err(`finale ${side}: expected one ${f.roles[side]}`);
      if ((counts.citizen ?? 0) !== 4) err(`finale ${side}: expected four citizens`);
      void expectedHand;
      finaleHands.set(side, { tree, seat: h.seat, role: f.roles[side] });
    }

    const usedDuel = new Map([['a', new Set()], ['b', new Set()]]);
    const chips = { a: ECARD_START_CHIPS, b: ECARD_START_CHIPS };
    for (const round of f.rounds ?? []) {
      if (!Number.isInteger(round.round)) { err('finale round missing number'); continue; }
      if (round.round < 1 || round.round > ECARD_ROUNDS) err(`finale round ${round.round} outside 1..${ECARD_ROUNDS}`);
      const reveals = {};
      for (const side of ['a', 'b']) {
        const seat = side === 'a' ? f.a : f.b;
        const rec = round.plays?.[side];
        const hand = finaleHands.get(side);
        if (!rec) { err(`finale round ${round.round} ${side}: no play record`); continue; }
        if (!HEX64.test(rec.commit ?? '')) err(`finale round ${round.round} ${side}: bad commitment`);
        if (!rec.reveal) { err(`finale round ${round.round} ${side}: no reveal`); continue; }
        const r = rec.reveal;
        const role = f.roles[side];
        if (r.card !== role && r.card !== 'citizen') err(`finale round ${round.round} ${side}: bad card ${r.card}`);
        if (!validBet(r.bet, chips[side])) err(`finale round ${round.round} ${side}: bet ${r.bet} exceeds stack ${chips[side]}`);
        const expected = await duelPlayCommit(tableId, round.round, seat, r.card, r.bet, r.playSalt);
        if (expected !== rec.commit) err(`finale round ${round.round} ${side}: commitment mismatch`);
        if (!hand) { err(`finale round ${round.round} ${side}: no hand`); continue; }
        const leaf = await leafHash(r.index, r.card, r.salt);
        if (usedDuel.get(side).has(leaf)) err(`finale round ${round.round} ${side}: leaf reused`);
        usedDuel.get(side).add(leaf);
        if (!Array.isArray(r.proof) || !(await verifyProof(leaf, r.proof, r.index, hand.tree.root))) {
          err(`finale round ${round.round} ${side}: card is not in the committed hand`);
        }
        if (round.cards?.[side] !== r.card) err(`finale round ${round.round} ${side}: card disagrees with proof`);
        if (round.bets?.[side] !== r.bet) err(`finale round ${round.round} ${side}: bet disagrees with proof`);
        reveals[side] = r;
      }
      if (!reveals.a || !reveals.b) continue;
      const outcome = ecardOutcome(reveals.a.card, reveals.b.card);
      if (round.outcome !== outcome) err(`finale round ${round.round}: outcome ${round.outcome}, cards give ${outcome}`);
      const transfer = ecardTransfer(outcome, { a: reveals.a.bet, b: reveals.b.bet }, chips, f.roles);
      if (round.transfer !== transfer.amount) err(`finale round ${round.round}: transfer ${round.transfer}, expected ${transfer.amount}`);
      if (outcome !== 'tie' && transfer.amount > 0) {
        const loser = outcome === 'a' ? 'b' : 'a';
        chips[loser] -= transfer.amount;
        chips[outcome] += transfer.amount;
      }
      if (round.chipsAfter && (round.chipsAfter.a !== chips.a || round.chipsAfter.b !== chips.b)) {
        err(`finale round ${round.round}: chips-after record disagrees with replay`);
      }
    }
    if (chips.a !== f.chips?.a || chips.b !== f.chips?.b) {
      err(`finale: final chips ${JSON.stringify(f.chips)} but replay gives ${JSON.stringify(chips)}`);
    }
    const expectedWinner = f.forfeit ? (f.forfeit === 'a' ? 'b' : 'a') : duelWinner(chips);
    if (f.winner !== expectedWinner && !(expectedWinner === 'tie' && f.winner === 'split')) {
      err(`finale: winner ${f.winner}, expected ${expectedWinner}`);
    }
    const expectedSeat = f.winner === 'split' ? null : (f.winner === 'a' ? f.a : f.b);
    if (f.winnerSeat !== expectedSeat) err(`finale: winnerSeat ${f.winnerSeat}, expected ${expectedSeat}`);
  }

  // ---- settlement arithmetic ----
  if (audit.settlement) {
    const s = audit.settlement;
    if (audit.finale) {
      const expectedHouse = s.split ? audit.finale.house : s.winnerSeat === -1;
      if (Boolean(s.houseWon) !== Boolean(expectedHouse) && !s.split) err('settlement houseWon disagrees with the finale');
      const finalSeat = audit.finale.winnerSeat ?? null;
      if ((s.winnerSeat ?? null) !== finalSeat) {
        err(`settlement winnerSeat ${s.winnerSeat}, but the finale names ${finalSeat}`);
      }
      if (Boolean(s.split) !== Boolean(audit.finale.split)) {
        err('settlement split disagrees with the finale');
      }
    }
    if (s.stakeZats !== (audit.stakeZats ?? 0)) {
      err(`settlement stake ${s.stakeZats}, expected ${audit.stakeZats ?? 0}`);
    }

    // The bankroll is derived from the human finalist's Act I stack, not from
    // the settlement summary. A tampered finale or payout therefore cannot
    // agree with itself.
    const f = audit.finale;
    let humanSide = null;
    if (audit.mode === 'solo' && f) {
      humanSide = ['a', 'b'].find((side) => {
        const seat = seatByNumber.get(f[side]);
        return seat && !seat.isBot;
      }) ?? null;
      if ((f.humanSide ?? null) !== humanSide) {
        err(`finale humanSide ${f.humanSide ?? 'none'}, expected ${humanSide ?? 'none'}`);
      }
      const humanSeat = humanSide ? seatByNumber.get(f[humanSide]) : null;
      const expectedBankroll = humanSeat ? bankrollZatsFor(humanSeat.chipsEnd, audit.stakeZats ?? 0) : 0;
      if ((f.bankrollZats ?? 0) !== expectedBankroll) {
        err(`finale bankroll ${f.bankrollZats ?? 0}, expected ${expectedBankroll}`);
      }
      if ((f.potZats ?? 0) !== potZatsFor(expectedBankroll)) {
        err(`finale pot ${f.potZats ?? 0}, expected ${potZatsFor(expectedBankroll)}`);
      }
    }
    if ((s.bankrollZats ?? 0) !== (f?.bankrollZats ?? 0)) {
      err(`settlement bankroll ${s.bankrollZats ?? 0}, expected ${f?.bankrollZats ?? 0}`);
    }
    if ((s.potZats ?? 0) !== (f?.potZats ?? 0)) {
      err(`settlement pot ${s.potZats ?? 0}, expected ${f?.potZats ?? 0}`);
    }
    const expectedPayout = finalPayoutZats({
      mode: audit.mode,
      humanSide,
      finale: f,
    });
    if (s.payoutZats !== expectedPayout) err(`settlement payout ${s.payoutZats}, expected ${expectedPayout}`);
  }

  if (!audit.complete) err('audit is incomplete: at least one full hand was not revealed');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      tableId,
      cycles: maxCycle,
      actRounds: audit.act1.rounds?.length ?? 0,
      finaleRounds: audit.finale?.rounds?.length ?? 0,
      hands: hands.size,
      complete: Boolean(audit.complete),
      settlement: audit.settlement ?? null,
    },
  };
}
