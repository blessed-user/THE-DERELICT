// THE DERELICT — the table.
//
// One Table owns one voyage: muster, Act I (restricted RPS survival), the
// back-room E-Card duel, and settlement. It never receives a human hand:
// humans commit to a Merkle root and every play arrives with an inclusion
// proof. House seats are played by the server and keep their hands in memory.

import {
  SEATS, START_STARS, START_CHIPS, RPS_HAND, LOAN_PRINCIPAL, LOAN_REPAY,
  STAR_DEALER_BUY, STAR_DEALER_SELL, MAX_OFFERS_PER_CYCLE, PHASE_MS,
  ECARD_START_CHIPS, ECARD_ROUNDS, HANDLE_WORDS,
} from '../shared/constants.js';
import { bankrollZatsFor, finalPayoutZats, potZatsFor } from '../shared/economy.js';
import {
  makeHand, buildHandTree, proofFor, verifyProof, leafHash,
  handCommit, duelHandCommit, playCommit, duelPlayCommit,
  randomHex, randomInt, shuffle,
} from '../shared/crypto.js';
import {
  rpsOutcome, pairPlayers, rankSurvivors, canTrade, applyTrade,
  dealerBuyStar, dealerSellStar, takeLoan, settleDebt,
} from '../shared/rps.js';
import {
  handFor, ecardOutcome, validBet, ecardTransfer, duelWinner, chooseDuelMove,
} from '../shared/ecard.js';
import { INTERCOM, TAUNTS, ELIMINATION_LINES, ACT_LINES } from '../shared/flavor.js';

const RPS_CARDS = new Set(['rock', 'paper', 'scissors']);
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_CYCLES = 12;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pick = (list) => list[randomInt(list.length)];
const newId = () => randomHex(12);

function labelForSeat(seat) {
  return `SEAT ${String(seat + 1).padStart(2, '0')}`;
}

function botHandle() {
  return `HOUSE / ${pick(HANDLE_WORDS)}`;
}

function humanHandle() {
  return `PASSENGER / ${pick(HANDLE_WORDS)}`;
}

function cleanHandle(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 32);
  return trimmed.length >= 2 ? trimmed : null;
}

export class Table {
  constructor({
    id, code, mode, stakeZats = 0, phaseScale = 1, timers = true,
    onChange = () => {}, onSettle = () => {}, now = () => Date.now(),
  }) {
    this.id = id ?? newId();
    this.code = code ?? randomHex(3).toUpperCase();
    this.mode = mode ?? 'practice';
    this.stakeZats = stakeZats;
    this.phaseScale = phaseScale;
    this.timers = timers;
    this.onChange = onChange;
    this.onSettle = onSettle;
    this._now = now;

    this.createdAt = this._now();
    this.startedAt = null;
    this.finishedAt = null;
    this.status = 'lobby';       // lobby | awaiting_deposit | muster | act1 | act1_end | finale | settled
    this.phase = 'lobby';
    this.phaseEndsAt = null;
    this.cycle = 0;
    this.seats = [];
    this.rounds = [];
    // The most recent resolved pairing for each seat, used by the live client
    // to show a decisive round result during the short resolve window.
    this.lastRoundBySeat = {};
    this.playArchive = [];
    this.pairings = [];
    this.bye = null;
    this.challenges = {};
    this.plays = {};
    this.offers = [];
    this.finale = null;
    this.house = null;
    this.settlement = null;
    this.audit = null;
    this.entry = null;           // staked solo deposit
    this.disposed = false;

    this.logEntries = [];
    this._logSeq = 0;
    this._phaseGen = 0;
    this._phaseTimer = null;
    this._beginScheduled = false;
    this._tauntCycle = new Map();

    this.log('intercom', INTERCOM[0]);
  }

  // ---------------------------------------------------------------- seats

  addSeat({ playerId, handle, isBot = false, token = null, ua = null, deposit = null } = {}) {
    if (this.seats.length >= SEATS) throw new Error('the table is full');
    const seatIndex = this.seats.length;
    const seat = {
      seat: seatIndex,
      playerId: playerId ?? null,
      handle: cleanHandle(handle) ?? (isBot ? botHandle() : humanHandle()),
      isBot,
      token: token ?? randomHex(24),
      ua,
      deposit,
      connected: isBot,
      replacedByHouse: false,
      stars: START_STARS,
      chips: START_CHIPS,
      debt: 0,
      alive: true,
      eliminatedCycle: null,
      act1HandRoot: null,
      act1HandCommit: null,
      act1HandReady: false,
      act1Hand: null,            // house seats only
      act1HandReveal: null,
      act1UsedLeaves: new Set(),
      act1UsedIndices: new Set(),
      botReveal: null,
      cardsLeft: RPS_HAND.length,
      loanTaken: false,
      offersThisCycle: 0,
      tauntedCycle: -1,
      history: { offers: [], trades: [], loans: [], dealer: [] },
      role: null,
      duelHandRoot: null,
      duelHandCommit: null,
      duelHandReady: false,
      duelHand: null,            // house seats only
      duelHandReveal: null,
      duelUsedLeaves: new Set(),
      duelUsedIndices: new Set(),
      duelChips: 0,
    };
    this.seats.push(seat);
    return seat;
  }

  humanSeats() {
    return this.seats.filter((s) => !s.isBot);
  }

  seatByToken(token) {
    return this.seats.find((s) => s.token === token) ?? (this.house?.token === token ? this.house : null);
  }

  // ------------------------------------------------------------- lifecycle

  async start({ fillHouse = true } = {}) {
    if (this.status !== 'lobby' && this.status !== 'awaiting_deposit') {
      return { ok: false, error: 'table already started' };
    }
    if (this.mode === 'solo' && !this.entry) {
      return { ok: false, error: 'the fare has not cleared' };
    }
    if (fillHouse) {
      while (this.seats.length < SEATS) this.addSeat({ isBot: true, connected: true });
    }
    if (this.seats.length < SEATS) return { ok: false, error: 'the table needs four seats' };
    this.startedAt = this._now();
    this.status = 'muster';
    this.log('intercom', INTERCOM[1]);
    this.log('system', ACT_LINES.act1);
    await this._prepareAllBotHands();
    this._enterPhase('muster', this._duration('muster'), () => this._musterTimeout());
    this._emit();
    this._maybeBegin();
    return { ok: true };
  }

  confirmEntry({ txid, zats, ua }) {
    this.entry = { txid, zats, ua, confirmedAt: this._now() };
    this.log('system', 'THE FARE CLEARS. THE GANGWAY CLOSES.');
    if (this.status === 'awaiting_deposit') this.start();
  }

  dispose() {
    this.disposed = true;
    this._phaseGen++;
    if (this._phaseTimer) clearTimeout(this._phaseTimer);
    this._phaseTimer = null;
  }

  // --------------------------------------------------------------- phases

  _duration(kind) {
    const mode = this.mode === 'practice' ? 'practice' : 'private';
    const ms = PHASE_MS[kind]?.[mode] ?? 10_000;
    return Math.max(80, Math.round(ms * this.phaseScale));
  }

  _botDelay(min, max) {
    return Math.max(20, Math.round((min + randomInt(max - min + 1)) * this.phaseScale));
  }

  _enterPhase(phase, duration, onEnd = null) {
    if (this.disposed) return;
    this._phaseGen++;
    this.phase = phase;
    this.phaseEndsAt = this._now() + duration;
    if (this._phaseTimer) clearTimeout(this._phaseTimer);
    this._phaseTimer = null;
    this._emit();
    if (onEnd) {
      const gen = this._phaseGen;
      this._phaseTimer = setTimeout(() => {
        if (this.disposed || gen !== this._phaseGen) return;
        onEnd();
      }, duration);
    }
  }

  _botTimer(fn, min = 700, max = 2200) {
    if (this.disposed || !this.timers) return;
    const gen = this._phaseGen;
    setTimeout(() => {
      if (this.disposed || gen !== this._phaseGen) return;
      Promise.resolve(fn()).catch((err) => this.log('system', `house error: ${err.message}`));
    }, this._botDelay(min, max));
  }

  _prepareAllBotHands() {
    return Promise.all(this.seats.filter((s) => s.isBot && !s.act1HandReady).map((s) => this._prepareBotHand(s)));
  }

  async _prepareBotHand(seat) {
    const hand = await makeHand(shuffle(RPS_HAND));
    seat.act1Hand = hand;
    seat.act1HandRoot = hand.root;
    seat.act1HandCommit = await handCommit(this.id, seat.seat, hand.root);
    seat.act1HandReady = true;
  }

  async _musterTimeout() {
    let replaced = 0;
    for (const seat of this.seats) {
      if (seat.act1HandReady || seat.isBot) continue;
      // A linked human is never quietly turned into a bot. At PHASE_SCALE=0.1
      // the muster used to last two seconds, which could replace a slow browser
      // (or the host's own seat) before it had finished sealing its hand.
      if (seat.connected || seat.seat === 0) continue;
      seat.isBot = true;
      seat.replacedByHouse = true;
      seat.handle = botHandle();
      seat.connected = true;
      replaced += 1;
    }
    if (replaced) {
      this.log('intercom', 'The ship does not wait. The house takes the empty chairs.');
      await this._prepareAllBotHands();
    }
    const waiting = this.seats.filter((seat) => !seat.isBot && !seat.act1HandReady);
    if (waiting.length) {
      // Hold the muster open for a connected human. The clock has no deadline
      // now; the table starts as soon as the last hand commits.
      this.phaseEndsAt = null;
      this.log('system', `THE DECK WAITS FOR ${waiting.map((seat) => labelForSeat(seat.seat)).join(' · ')} TO SEAL.`);
      this._emit();
      return;
    }
    this._beginAct1();
  }

  _maybeBegin() {
    if (this.status !== 'muster' || this._beginScheduled) return;
    if (!this.seats.every((s) => s.act1HandReady)) return;
    this._beginScheduled = true;
    this._botTimer(() => this._beginAct1(), 300, 700);
  }

  _beginAct1() {
    if (this.disposed || this.status === 'act1' || this.status === 'settled') return;
    if (!this.seats.every((seat) => seat.act1HandReady)) return;
    this.status = 'act1';
    this.cycle = 1;
    this._enterPhase('trade', this._duration('trade'), () => this._endTrade());
    this.log('system', `CYCLE ${this.cycle} — THE TABLE OPENS.`);
    this._scheduleBotTrades();
    this._emit();
  }

  _eligible() {
    return this.seats.filter((s) => s.alive && s.cardsLeft > 0);
  }

  _scheduleBotTrades() {
    for (const seat of this.seats) {
      if (seat.isBot && seat.alive) {
        this._botTimer(() => this._botTrade(seat), 900, 4200);
      }
    }
  }

  _endTrade() {
    if (this.status !== 'act1' || this.phase !== 'trade') return;
    for (const offer of this.offers) {
      if (offer.status === 'open') offer.status = 'expired';
    }
    this._enterChallenge();
  }

  _enterChallenge() {
    this.challenges = {};
    this._enterPhase('challenge', this._duration('challenge'), () => this._resolveChallenges());
    this.log('system', 'CHALLENGE. Name a seat, or the deck names one for you.');
    for (const seat of this.seats) {
      if (seat.isBot && seat.alive && seat.cardsLeft > 0) {
        this._botTimer(() => this._botChallenge(seat), 600, 2600);
      }
    }
  }

  _resolveChallenges() {
    if (this.status !== 'act1' || this.phase !== 'challenge') return;
    const eligible = this._eligible();
    const { pairs, bye } = pairPlayers(this.challenges, eligible.map((s) => s.seat), randomInt);
    this.pairings = pairs;
    this.bye = bye;
    if (pairs.length) {
      this.log('system', `PAIRS: ${pairs.map(([a, b]) => `${labelForSeat(a)} vs ${labelForSeat(b)}`).join(' · ')}`);
    }
    if (bye != null) this.log('system', `${labelForSeat(bye)} has the deck.`);
    if (!pairs.length) {
      this._endAct1('no pairs remain');
      return;
    }
    this._enterPlay();
  }

  _enterPlay() {
    this.plays = {};
    for (const [a, b] of this.pairings) {
      this.plays[a] = { commit: null, reveal: null, botReveal: null };
      this.plays[b] = { commit: null, reveal: null, botReveal: null };
    }
    this._enterPhase('play', this._duration('play'), () => this._enterReveal());
    this.log('system', 'CARDS DOWN. The hold goes quiet.');
    for (const seat of this.seats) {
      if (seat.isBot && this.plays[seat.seat]) {
        this._botTimer(() => this._botPlayCommit(seat), 500, 2200);
      }
    }
  }

  _allCommitsIn() {
    return this.pairings.every(([a, b]) => this.plays[a]?.commit && this.plays[b]?.commit);
  }

  _enterReveal() {
    if (this.status !== 'act1' || this.phase !== 'play') return;
    this._enterPhase('reveal', this._duration('reveal'), () => this._resolvePlays());
    this.log('system', 'SHOW.');
    for (const seat of this.seats) {
      if (seat.isBot && this.plays[seat.seat]?.botReveal) {
        this._botTimer(() => this._applyRpsReveal(seat, this.plays[seat.seat].botReveal), 300, 1200);
      }
    }
    if (this._allRevealsDone()) this._resolvePlays();
  }

  _allRevealsDone() {
    return this.pairings.every(([a, b]) =>
      (!this.plays[a]?.commit || this.plays[a]?.reveal) &&
      (!this.plays[b]?.commit || this.plays[b]?.reveal));
  }

  async _applyRpsReveal(seat, data) {
    if (this.phase !== 'reveal' || !this.plays[seat.seat]) return { ok: false, error: 'not revealing' };
    const check = await this._verifyRpsReveal(seat, data);
    if (!check.ok) {
      this.log('system', `${labelForSeat(seat.seat)} — the card is refused.`);
      return check;
    }
    if (this._allRevealsDone()) this._resolvePlays();
    return { ok: true };
  }

  async _verifyRpsReveal(seat, data) {
    const rec = this.plays[seat.seat];
    if (!rec?.commit) return { ok: false, error: 'no commitment' };
    if (rec.reveal) return { ok: false, error: 'already revealed' };
    const { card, index, salt, proof, playSalt } = data ?? {};
    if (!RPS_CARDS.has(card)) return { ok: false, error: 'unknown card' };
    if (!Number.isInteger(index) || index < 0 || index >= RPS_HAND.length) return { ok: false, error: 'bad index' };
    if (typeof salt !== 'string' || typeof playSalt !== 'string') return { ok: false, error: 'bad salts' };
    if (!Array.isArray(proof) || proof.length > 8) return { ok: false, error: 'bad proof' };
    if (proof.some((p) => !p || typeof p.hash !== 'string' || !HEX64.test(p.hash) || typeof p.siblingIsLeft !== 'boolean')) {
      return { ok: false, error: 'bad proof' };
    }
    const expected = await playCommit(this.id, this.cycle, seat.seat, card, playSalt);
    if (expected !== rec.commit) return { ok: false, error: 'commitment mismatch' };
    const leaf = await leafHash(index, card, salt);
    if (seat.act1UsedLeaves.has(leaf)) return { ok: false, error: 'card already played' };
    if (!(await verifyProof(leaf, proof, index, seat.act1HandRoot))) {
      return { ok: false, error: 'card is not in the committed hand' };
    }
    seat.act1UsedLeaves.add(leaf);
    seat.act1UsedIndices.add(index);
    seat.cardsLeft = Math.max(0, seat.cardsLeft - 1);
    rec.reveal = { card, index, salt, proof, playSalt, leaf };
    rec.revealedAt = this._now();
    this._emit();
    return { ok: true };
  }

  _transferStar(from, to, n = 1) {
    const amount = Math.min(n, from.stars);
    from.stars -= amount;
    to.stars += amount;
    return amount;
  }

  _burnStar(seat, n = 1) {
    seat.stars = Math.max(0, seat.stars - n);
  }

  _resolvePlays() {
    if (this.status !== 'act1' || this.phase !== 'reveal') return;
    const records = [];
    for (const [a, b] of this.pairings) {
      const ra = this.plays[a]?.reveal ?? null;
      const rb = this.plays[b]?.reveal ?? null;
      const before = { a: this.seats[a].stars, b: this.seats[b].stars };
      let outcome = 'none';
      let transfer = 0;

      if (ra && rb) {
        const result = rpsOutcome(ra.card, rb.card);
        outcome = result;
        if (result === 'a') transfer = this._transferStar(this.seats[b], this.seats[a], 1);
        else if (result === 'b') transfer = this._transferStar(this.seats[a], this.seats[b], 1);
        this.log('resolve',
          `${labelForSeat(a)} shows ${ra.card.toUpperCase()} · ${labelForSeat(b)} shows ${rb.card.toUpperCase()}. ` +
          (result === 'tie' ? 'Neither star moves.' : `Star to ${labelForSeat(result === 'a' ? a : b)}.`),
          { pair: [a, b], cards: { a: ra.card, b: rb.card }, outcome: result, transfer });
      } else if (ra || rb) {
        const present = ra ? a : b;
        const absent = ra ? b : a;
        outcome = `forfeit-${absent}`;
        transfer = this._transferStar(this.seats[absent], this.seats[present], 1);
        this.log('resolve',
          `${labelForSeat(absent)} did not answer the bell. ${labelForSeat(present)} takes a star.`,
          { pair: [a, b], cards: { a: ra?.card ?? null, b: rb?.card ?? null }, outcome, transfer });
      } else {
        outcome = 'both-forfeit';
        this._burnStar(this.seats[a], 1);
        this._burnStar(this.seats[b], 1);
        this.log('resolve', `Both seats froze. The house takes a star from each.`, { pair: [a, b], outcome });
      }

      records.push({
        cycle: this.cycle,
        pair: [a, b],
        cards: { a: ra?.card ?? null, b: rb?.card ?? null },
        outcome,
        transfer,
        starsBefore: before,
        starsAfter: { a: this.seats[a].stars, b: this.seats[b].stars },
      });
    }

    this.rounds.push(...records);
    this.lastRoundBySeat = {};
    for (const record of records) {
      for (const seat of record.pair) this.lastRoundBySeat[seat] = record;
    }
    const archive = {
      cycle: this.cycle,
      pairings: this.pairings.map(([x, y]) => [x, y]),
      bye: this.bye,
      plays: {},
    };
    for (const [seat, rec] of Object.entries(this.plays)) {
      archive.plays[seat] = rec?.commit
        ? { commit: rec.commit, reveal: rec.reveal ? { ...rec.reveal } : null }
        : null;
    }
    this.playArchive.push(archive);
    this._eliminateCheck(`CYCLE ${this.cycle}`);
    this.cycle += 1;
    this._enterPhase('resolve', this._duration('resolve'), () => this._afterResolve());
    this.log('system', 'THE HOLD SETTLES.');
    this._emit();
  }

  _eliminateCheck(context = '') {
    for (const seat of this.seats) {
      if (seat.alive && seat.stars <= 0) {
        seat.alive = false;
        seat.stars = 0;
        seat.eliminatedCycle = this.cycle;
        for (const offer of this.offers) {
          if (offer.status === 'open' && (offer.from === seat.seat || offer.to === seat.seat)) offer.status = 'expired';
        }
        this.log('elim', `${labelForSeat(seat.seat)} — OUT. ${pick(ELIMINATION_LINES)}`, { seat: seat.seat });
      }
    }
  }

  _afterResolve() {
    if (this.status !== 'act1') return;
    const alive = this.seats.filter((s) => s.alive);
    if (alive.length <= 2) return this._endAct1('two seats remain');
    if (alive.every((s) => s.cardsLeft <= 0)) return this._endAct1('every card spent');
    if (this.cycle > MAX_CYCLES) return this._endAct1('the hold closes');
    // A seat with cards and no opponent cannot play. Close now rather than run
    // an empty trade/challenge cycle where loans and deals can still change
    // the standings without a card ever hitting the felt.
    if (alive.filter((s) => s.cardsLeft > 0).length < 2) return this._endAct1('no pairs remain');
    this._enterPhase('trade', this._duration('trade'), () => this._endTrade());
    this.log('system', `CYCLE ${this.cycle} — THE TABLE OPENS.`);
    this._scheduleBotTrades();
    this._emit();
  }

  async _endAct1(reason) {
    if (this.status !== 'act1') return;
    this.status = 'act1_end';
    this.phase = 'act1_end';
    this.phaseEndsAt = null;
    this._phaseGen++;
    if (this._phaseTimer) clearTimeout(this._phaseTimer);

    for (const seat of this.seats) {
      if (!seat.alive) continue;
      const result = settleDebt(seat);
      if (result.seized) {
        seat.alive = false;
        seat.eliminatedCycle = this.cycle;
        this.log('elim', `${labelForSeat(seat.seat)} — THE NOTE CAME DUE. ${ACT_LINES.debt}`, { seat: seat.seat });
      }
    }

    const survivors = this.seats.filter((s) => s.alive);
    this.log('intercom', `ACT I CLOSES. ${reason.toUpperCase()}.`);
    if (survivors.length) {
      this.log('system', `SURVIVORS: ${survivors.map((s) => labelForSeat(s.seat)).join(' · ')}.`);
    } else {
      this.log('system', 'NO SURVIVORS. THE HOUSE KEEPS THE POT.');
    }

    // House seats reveal their whole hands for the audit; humans are asked.
    for (const seat of this.seats) {
      if (seat.act1Hand && !seat.act1HandReveal) {
        seat.act1HandReveal = { cards: [...seat.act1Hand.cards], salts: [...seat.act1Hand.salts] };
      }
    }
    this._emit();

    if (!survivors.length) return this._settleHouse('no survivors');
    this._beginFinale(survivors).catch((err) => {
      this.log('system', `the back room failed to open: ${err.message}`);
      this._settleHouse('the back room failed to open');
    });
  }

  // --------------------------------------------------------------- finale

  async _beginFinale(survivors) {
    this.status = 'finale';
    const ranked = rankSurvivors(survivors);
    const a = ranked[0];
    const b = ranked[1] ?? null;

    let sideBSeat = b;
    if (!sideBSeat) {
      sideBSeat = this._makeHouseFinalist();
      b = sideBSeat;
    }

    const roles = { a: 'crown', b: 'rebel' };
    for (const [side, seat] of [['a', a], ['b', b]]) {
      seat.role = roles[side];
      seat.duelChips = ECARD_START_CHIPS;
      seat.duelHandRoot = null;
      seat.duelHandCommit = null;
      seat.duelHandReady = false;
      seat.duelHandReveal = null;
      seat.duelUsedLeaves = new Set();
      seat.duelUsedIndices = new Set();
    }

    // A solo run has one human. Their surviving Act I stack is the bankroll
    // that the back room rescales onto 100 chips. The house matches it.
    const humanFinalist = [a, b].find((seat) => !seat.isBot) ?? null;
    const humanSide = this.mode === 'solo'
      ? (humanFinalist === a ? 'a' : humanFinalist === b ? 'b' : null)
      : null;
    const bankrollZats = humanFinalist ? bankrollZatsFor(humanFinalist.chips, this.stakeZats) : 0;

    this.finale = {
      a: a.seat,
      b: b.seat,
      roles,
      humanSide,
      bankrollZats,
      potZats: potZatsFor(bankrollZats),
      chips: { a: ECARD_START_CHIPS, b: ECARD_START_CHIPS },
      round: 1,
      rounds: [],
      plays: {},
      ready: { a: false, b: false },
      lastRound: null,
      winner: null,
      winnerSeat: null,
      forfeit: null,
      split: false,
      house: b.seat === -1,
    };

    this.log('intercom', INTERCOM[7]);
    this.log('system', ACT_LINES.finale);
    this.log('system', `${labelForSeat(a.seat)} sits as the CROWN. ${b.seat === -1 ? 'THE HOUSE' : labelForSeat(b.seat)} sits as the REBEL.`);

    await Promise.all([
      this._prepareDuelSide('a', a),
      this._prepareDuelSide('b', b),
    ]);

    this._enterPhase('finale_intro', this._duration('finale_intro'), () => this._finaleIntroTimeout());
    this._maybeStartDuel();
  }

  _makeHouseFinalist() {
    const house = {
      seat: -1,
      playerId: null,
      handle: 'THE HOUSE',
      isBot: true,
      token: randomHex(24),
      connected: true,
      alive: true,
      stars: 0,
      chips: 0,
      debt: 0,
      role: 'rebel',
      duelChips: ECARD_START_CHIPS,
      duelHandRoot: null,
      duelHandCommit: null,
      duelHandReady: false,
      duelHand: null,
      duelHandReveal: null,
      duelUsedLeaves: new Set(),
      duelUsedIndices: new Set(),
    };
    this.house = house;
    return house;
  }

  _seatForSide(side) {
    if (!this.finale) return null;
    const index = this.finale[side];
    return index === -1 ? this.house : this.seats[index];
  }

  sideOfSeat(seatIndex) {
    if (!this.finale) return null;
    if (this.finale.a === seatIndex) return 'a';
    if (this.finale.b === seatIndex) return 'b';
    return null;
  }

  _otherSide(side) {
    return side === 'a' ? 'b' : 'a';
  }

  async _prepareDuelSide(side, seat) {
    if (!seat) return;
    if (seat.isBot) {
      const hand = await makeHand(handFor(this.finale.roles[side]));
      seat.duelHand = hand;
      seat.duelHandRoot = hand.root;
      seat.duelHandCommit = await duelHandCommit(this.id, seat.seat, hand.root);
      seat.duelHandReady = true;
      this.finale.ready[side] = true;
    }
  }

  _finaleIntroTimeout() {
    if (this.status !== 'finale' || this.phase !== 'finale_intro') return;
    const missing = ['a', 'b'].find((side) => !this.finale.ready[side]);
    if (!missing) return this._startDuelRound();
    const seat = this._seatForSide(missing);
    this.finale.forfeit = missing;
    this.log('system', `${seat.seat === -1 ? 'THE HOUSE' : labelForSeat(seat.seat)} never took the chair.`);
    this._finishDuel({ forfeit: missing });
  }

  _maybeStartDuel() {
    if (this.status !== 'finale' || this.phase !== 'finale_intro') return;
    if (!this.finale.ready.a || !this.finale.ready.b) return;
    this._botTimer(() => this._startDuelRound(), 300, 700);
  }

  _startDuelRound() {
    if (this.status !== 'finale' || !this.finale) return;
    if (this.finale.round > ECARD_ROUNDS) return this._finishDuel();
    this.finale.plays = {};
    this._enterPhase('duel_commit', this._duration('duelCommit'), () => this._duelCommitTimeout());
    this.log('system', `ROUND ${this.finale.round} — BETS DOWN.`);
    for (const side of ['a', 'b']) {
      const seat = this._seatForSide(side);
      if (seat?.isBot) this._botTimer(() => this._botDuelCommit(side), 500, 2000);
    }
  }

  _duelCommitTimeout() {
    if (this.status !== 'finale' || this.phase !== 'duel_commit') return;
    const missing = ['a', 'b'].find((side) => !this.finale.plays[side]?.commit);
    if (missing) {
      this.log('system', `${this._seatForSide(missing).seat === -1 ? 'THE HOUSE' : labelForSeat(this._seatForSide(missing).seat)} could not face the table.`);
      return this._finishDuel({ forfeit: missing });
    }
    this._enterDuelReveal();
  }

  _enterDuelReveal() {
    if (this.status !== 'finale' || this.phase !== 'duel_commit') return;
    this._enterPhase('duel_reveal', this._duration('duelReveal'), () => this._duelRevealTimeout());
    this.log('system', 'SHOW.');
    for (const side of ['a', 'b']) {
      const seat = this._seatForSide(side);
      if (seat?.isBot && this.finale.plays[side]?.botReveal) {
        this._botTimer(() => this._applyDuelReveal(side, this.finale.plays[side].botReveal), 300, 1000);
      }
    }
  }

  _duelRevealTimeout() {
    if (this.status !== 'finale' || this.phase !== 'duel_reveal') return;
    const missing = ['a', 'b'].find((side) => !this.finale.plays[side]?.reveal);
    if (missing) {
      this.log('system', `${this._seatForSide(missing).seat === -1 ? 'THE HOUSE' : labelForSeat(this._seatForSide(missing).seat)} folded in the dark.`);
      return this._finishDuel({ forfeit: missing });
    }
    this._resolveDuelRound();
  }

  async _applyDuelReveal(side, data) {
    if (this.phase !== 'duel_reveal') return { ok: false, error: 'not revealing' };
    const check = await this._verifyDuelReveal(side, data);
    if (!check.ok) {
      this.log('system', `${this._seatForSide(side).seat === -1 ? 'THE HOUSE' : labelForSeat(this._seatForSide(side).seat)} — the card is refused.`);
      this._finishDuel({ forfeit: side, badReveal: true });
      return check;
    }
    if (this.finale.plays.a?.reveal && this.finale.plays.b?.reveal) this._resolveDuelRound();
    return { ok: true };
  }

  async _verifyDuelReveal(side, data) {
    const seat = this._seatForSide(side);
    const rec = this.finale.plays[side];
    if (!rec?.commit) return { ok: false, error: 'no commitment' };
    if (rec.reveal) return { ok: false, error: 'already revealed' };
    const { card, index, salt, proof, bet, playSalt } = data ?? {};
    const role = this.finale.roles[side];
    if (card !== role && card !== 'citizen') return { ok: false, error: 'unknown card' };
    if (!Number.isInteger(index) || index < 0 || index >= 5) return { ok: false, error: 'bad index' };
    if (!validBet(bet, this.finale.chips[side])) return { ok: false, error: 'bad bet' };
    if (typeof salt !== 'string' || typeof playSalt !== 'string') return { ok: false, error: 'bad salts' };
    if (!Array.isArray(proof) || proof.length > 8) return { ok: false, error: 'bad proof' };
    if (proof.some((p) => !p || typeof p.hash !== 'string' || !HEX64.test(p.hash) || typeof p.siblingIsLeft !== 'boolean')) {
      return { ok: false, error: 'bad proof' };
    }
    const expected = await duelPlayCommit(this.id, this.finale.round, seat.seat, card, bet, playSalt);
    if (expected !== rec.commit) return { ok: false, error: 'commitment mismatch' };
    const leaf = await leafHash(index, card, salt);
    if (seat.duelUsedLeaves.has(leaf)) return { ok: false, error: 'card already played' };
    if (!(await verifyProof(leaf, proof, index, seat.duelHandRoot))) {
      return { ok: false, error: 'card is not in the committed hand' };
    }
    seat.duelUsedLeaves.add(leaf);
    seat.duelUsedIndices.add(index);
    rec.reveal = { card, index, salt, proof, bet, playSalt, leaf };
    rec.revealedAt = this._now();
    this._emit();
    return { ok: true };
  }

  _resolveDuelRound() {
    if (this.status !== 'finale' || this.phase !== 'duel_reveal') return;
    const ra = this.finale.plays.a?.reveal;
    const rb = this.finale.plays.b?.reveal;
    if (!ra || !rb) return this._finishDuel({ forfeit: !ra ? 'a' : 'b' });
    const outcome = ecardOutcome(ra.card, rb.card);
    const transfer = ecardTransfer(outcome, { a: ra.bet, b: rb.bet }, this.finale.chips, this.finale.roles);
    if (transfer.amount > 0) {
      const loser = outcome === 'a' ? 'b' : 'a';
      this.finale.chips[loser] -= transfer.amount;
      this.finale.chips[outcome] += transfer.amount;
    }
    const record = {
      round: this.finale.round,
      cards: { a: ra.card, b: rb.card },
      bets: { a: ra.bet, b: rb.bet },
      outcome,
      transfer: transfer.amount,
      multiplier: transfer.multiplier,
      chipsAfter: { ...this.finale.chips },
      plays: {
        a: { commit: this.finale.plays.a?.commit ?? null, reveal: { ...ra } },
        b: { commit: this.finale.plays.b?.commit ?? null, reveal: { ...rb } },
      },
    };
    this.finale.rounds.push(record);
    this.finale.lastRound = record;

    const name = (side) => this.finale[side] === -1 ? 'THE HOUSE' : labelForSeat(this.finale[side]);
    this.log('duel',
      `ROUND ${record.round} · ${name('a')} shows ${ra.card.toUpperCase()} · ${name('b')} shows ${rb.card.toUpperCase()}. ` +
      (outcome === 'tie' || transfer.amount === 0 ? 'No blood.' : `${name(outcome)} takes ${transfer.amount}${transfer.multiplier === 2 ? ' (×2)' : ''}.`),
      {
        round: record.round, cards: record.cards, bets: record.bets, outcome: record.outcome,
        transfer: record.transfer, multiplier: record.multiplier,
      });

    this.finale.round += 1;
    this._enterPhase('duel_result', this._duration('duelResult'), () => this._startDuelRound());
  }

  _finishDuel({ forfeit = null, badReveal = false } = {}) {
    if (this.status === 'settled' || !this.finale) return;
    const f = this.finale;
    let winner;
    if (forfeit) {
      f.forfeit = forfeit;
      winner = this._otherSide(forfeit);
    } else {
      winner = duelWinner(f.chips);
    }
    if (winner === 'tie') {
      f.split = true;
      f.winner = 'split';
      f.winnerSeat = null;
    } else {
      f.winner = winner;
      f.winnerSeat = f[winner];
    }

    for (const side of ['a', 'b']) {
      const seat = this._seatForSide(side);
      if (seat?.duelHand && !seat.duelHandReveal) {
        seat.duelHandReveal = { cards: [...seat.duelHand.cards], salts: [...seat.duelHand.salts] };
      }
    }

    this.status = 'settled';
    this.phase = 'settled';
    this.phaseEndsAt = null;
    this.finishedAt = this._now();
    this._phaseGen++;
    if (this._phaseTimer) clearTimeout(this._phaseTimer);

    if (f.split) {
      this.log('intercom', 'THE VOYAGE ENDS. THE POT IS SPLIT.');
    } else if (f.winnerSeat === -1) {
      this.log('intercom', 'THE VOYAGE ENDS. THE HOUSE KEEPS THE POT.');
    } else {
      this.log('intercom', `THE VOYAGE ENDS. ${labelForSeat(f.winnerSeat)} TAKES THE POT.`);
    }

    const winnerSeat = f.winnerSeat ?? -1;
    const houseWon = winnerSeat === -1 || f.house && f.split;
    const humanSeatObj = f.humanSide ? this._seatForSide(f.humanSide) : null;
    const payoutZats = finalPayoutZats({
      mode: this.mode,
      humanSide: f.humanSide,
      finale: f,
    });
    this.settlement = {
      winnerSeat: f.winnerSeat,
      split: f.split,
      houseWon,
      forfeit: f.forfeit,
      stakeZats: this.stakeZats,
      bankrollZats: f.bankrollZats ?? 0,
      potZats: f.potZats ?? 0,
      payoutZats,
      winnerUa: payoutZats ? humanSeatObj?.ua ?? null : null,
      status: payoutZats ? 'pending' : 'none',
      txid: null,
      walletCredited: false,
      settledAt: this._now(),
    };
    this.audit = this.buildAudit();
    this._emit();
    Promise.resolve(this.onSettle(this)).catch(() => {});
  }

  _settleHouse(reason) {
    if (this.status === 'settled') return;
    this.status = 'settled';
    this.phase = 'settled';
    this.phaseEndsAt = null;
    this.finishedAt = this._now();
    this._phaseGen++;
    if (this._phaseTimer) clearTimeout(this._phaseTimer);
    this.log('intercom', `THE HOUSE KEEPS THE POT. ${String(reason).toUpperCase()}.`);
    this.settlement = {
      winnerSeat: -1,
      split: false,
      houseWon: true,
      stakeZats: this.stakeZats,
      bankrollZats: this.finale?.bankrollZats ?? 0,
      potZats: this.finale?.potZats ?? 0,
      payoutZats: 0,
      winnerUa: null,
      status: 'none',
      txid: null,
      walletCredited: false,
      settledAt: this._now(),
    };
    this.audit = this.buildAudit();
    this._emit();
    Promise.resolve(this.onSettle(this)).catch(() => {});
  }

  setPayout(txid, error = null) {
    if (!this.settlement) return;
    if (error) {
      this.settlement.status = 'failed';
      this.settlement.error = String(error).slice(0, 200);
    } else {
      this.settlement.status = 'paid';
      this.settlement.txid = txid;
    }
    this._emit();
  }

  // --------------------------------------------------------------- actions

  async action(seatIndex, type, payload = {}) {
    if (this.status === 'settled' && type !== 'hand_reveal' && type !== 'disconnect') {
      return { ok: false, error: 'the voyage is over' };
    }
    const seat = this.seats[seatIndex];
    if (!seat) return { ok: false, error: 'no such seat' };
    if (seat.isBot) return { ok: false, error: 'the house does not take orders' };
    if (!seat.alive && type !== 'hand_reveal' && type !== 'disconnect') {
      return { ok: false, error: 'your seat is dark' };
    }

    switch (type) {
      case 'hand_commit': return this._actionHandCommit(seat, payload);
      case 'challenge': return this._actionChallenge(seat, payload);
      case 'play_commit': return this._actionPlayCommit(seat, payload);
      case 'play_reveal': return this._actionPlayReveal(seat, payload);
      case 'offer': return this._actionOffer(seat, payload);
      case 'offer_response': return this._actionOfferResponse(seat, payload);
      case 'dealer': return this._actionDealer(seat, payload);
      case 'loan': return this._actionLoan(seat);
      case 'taunt': return this._actionTaunt(seat, payload);
      case 'duel_hand_commit': return this._actionDuelHandCommit(seat, payload);
      case 'duel_commit': return this._actionDuelCommit(seat, payload);
      case 'duel_reveal': return this._actionDuelReveal(seat, payload);
      case 'hand_reveal': return this._actionHandReveal(seat, payload);
      case 'disconnect': return this._actionDisconnect(seat, payload);
      default: return { ok: false, error: 'unknown action' };
    }
  }

  async _actionHandCommit(seat, { root, commit }) {
    if (this.status !== 'muster') return { ok: false, error: 'the muster is closed' };
    if (seat.act1HandReady) return { ok: false, error: 'hand already committed' };
    if (typeof root !== 'string' || !HEX64.test(root)) return { ok: false, error: 'bad hand root' };
    if (typeof commit !== 'string' || !HEX64.test(commit)) return { ok: false, error: 'bad commitment' };
    const expected = await handCommit(this.id, seat.seat, root);
    if (expected !== commit) return { ok: false, error: 'commitment mismatch' };
    seat.act1HandRoot = root;
    seat.act1HandCommit = commit;
    seat.act1HandReady = true;
    this.log('system', `${labelForSeat(seat.seat)} is at the table.`);
    this._emit();
    this._maybeBegin();
    return { ok: true };
  }

  async _actionChallenge(seat, { target }) {
    if (this.status !== 'act1' || this.phase !== 'challenge') return { ok: false, error: 'not the challenge phase' };
    if (target === null || target === undefined) {
      this.challenges[seat.seat] = null;
    } else {
      if (!Number.isInteger(target) || target === seat.seat) return { ok: false, error: 'bad target' };
      const targetSeat = this.seats[target];
      if (!targetSeat || !targetSeat.alive || targetSeat.cardsLeft <= 0) return { ok: false, error: 'that seat cannot answer' };
      this.challenges[seat.seat] = target;
    }
    this._emit();
    if (this._eligible().every((s) => Object.prototype.hasOwnProperty.call(this.challenges, s.seat))) {
      this._botTimer(() => {
        if (this.phase === 'challenge') this._resolveChallenges();
      }, 300, 700);
    }
    return { ok: true };
  }

  async _actionPlayCommit(seat, { commit }) {
    if (this.status !== 'act1' || this.phase !== 'play') return { ok: false, error: 'not the play phase' };
    const rec = this.plays[seat.seat];
    if (!rec) return { ok: false, error: 'you have the deck this cycle' };
    if (rec.commit) return { ok: false, error: 'already committed' };
    if (typeof commit !== 'string' || !HEX64.test(commit)) return { ok: false, error: 'bad commitment' };
    rec.commit = commit;
    this._emit();
    if (this._allCommitsIn()) this._enterReveal();
    return { ok: true };
  }

  async _actionPlayReveal(seat, payload) {
    if (this.status !== 'act1' || this.phase !== 'reveal') return { ok: false, error: 'not the reveal phase' };
    const result = await this._applyRpsReveal(seat, payload);
    if (result.ok) this._emit();
    return result;
  }

  async _actionOffer(seat, payload) {
    if (this.status !== 'act1' || this.phase !== 'trade') return { ok: false, error: 'not the trade phase' };
    if (seat.offersThisCycle >= MAX_OFFERS_PER_CYCLE) return { ok: false, error: 'three notes per cycle' };
    const to = payload.to;
    if (!Number.isInteger(to) || to === seat.seat) return { ok: false, error: 'bad recipient' };
    const recipient = this.seats[to];
    if (!recipient?.alive) return { ok: false, error: 'that seat is dark' };
    const give = this._cleanSide(payload.give);
    const want = this._cleanSide(payload.want);
    if (!give || !want) return { ok: false, error: 'bad terms' };
    if (give.stars + give.chips + want.stars + want.chips === 0) return { ok: false, error: 'empty offer' };
    if (!canTrade(seat, give.stars, give.chips, want.stars, want.chips)) return { ok: false, error: 'you do not hold that' };
    if (!this._survivesTrade(seat, give, want)) return { ok: false, error: 'the deal would leave you at zero stars' };
    if (!this._survivesTrade(recipient, want, give)) return { ok: false, error: 'the recipient would be left at zero stars' };
    const offer = {
      id: newId(),
      from: seat.seat,
      to,
      give,
      want,
      cycle: this.cycle,
      status: 'open',
      createdAt: this._now(),
      expiresAt: this.phaseEndsAt,
    };
    this.offers.push(offer);
    seat.offersThisCycle += 1;
    seat.history.offers.push({ ...offer });
    this.log('system', 'A sealed note changed hands.');
    this._emit();
    if (recipient.isBot) this._botTimer(() => this._botRespondToOffer(offer), 800, 3200);
    return { ok: true, id: offer.id };
  }

  _cleanSide(side) {
    if (!side || typeof side !== 'object') return null;
    const stars = Number(side.stars ?? 0);
    const chips = Number(side.chips ?? 0);
    if (!Number.isInteger(stars) || !Number.isInteger(chips) || stars < 0 || chips < 0) return null;
    if (stars > 6 || chips > 500) return null;
    return { stars, chips };
  }

  _survivesTrade(seat, give, want) {
    return seat.stars - give.stars + want.stars >= 1;
  }

  async _actionOfferResponse(seat, { offerId, accept }) {
    if (this.status !== 'act1' || this.phase !== 'trade') return { ok: false, error: 'not the trade phase' };
    const offer = this.offers.find((o) => o.id === offerId);
    if (!offer || offer.to !== seat.seat) return { ok: false, error: 'no such offer' };
    return this._respondToOffer(offer, Boolean(accept));
  }

  _respondToOffer(offer, accept) {
    if (offer.status !== 'open') return { ok: false, error: 'the note is already spent' };
    if (this.phase !== 'trade' || this.status !== 'act1') return { ok: false, error: 'the note expired' };
    const sender = this.seats[offer.from];
    const recipient = this.seats[offer.to];
    if (!sender?.alive || !recipient?.alive) return { ok: false, error: 'a seat is dark' };
    if (!accept) {
      offer.status = 'refused';
      offer.closedAt = this._now();
      this.log('system', 'A sealed offer was refused.');
      this._emit();
      return { ok: true };
    }
    if (!canTrade(sender, offer.give.stars, offer.give.chips, offer.want.stars, offer.want.chips) ||
        !canTrade(recipient, offer.want.stars, offer.want.chips, offer.give.stars, offer.give.chips)) {
      offer.status = 'failed';
      return { ok: false, error: 'funds moved before the note was answered' };
    }
    if (!this._survivesTrade(sender, offer.give, offer.want) ||
        !this._survivesTrade(recipient, offer.want, offer.give)) {
      return { ok: false, error: 'the deal would leave a seat at zero stars' };
    }
    applyTrade(sender, recipient, offer.give.stars, offer.give.chips, offer.want.stars, offer.want.chips);
    offer.status = 'accepted';
    offer.closedAt = this._now();
    sender.history.trades.push({ offerId: offer.id, direction: 'sent', ...offer });
    recipient.history.trades.push({ offerId: offer.id, direction: 'received', ...offer });
    this.log('system', 'A deal was struck in the dark.');
    this._eliminateCheck('a private deal');
    this._emit();
    return { ok: true };
  }

  async _actionDealer(seat, { op }) {
    if (this.status !== 'act1' || this.phase !== 'trade') return { ok: false, error: 'not the trade phase' };
    let result;
    if (op === 'buy_star') result = dealerBuyStar(seat);
    else if (op === 'sell_star') result = dealerSellStar(seat);
    else return { ok: false, error: 'unknown dealer operation' };
    if (!result.ok) return result;
    seat.history.dealer.push({ op, cycle: this.cycle, stars: seat.stars, chips: seat.chips });
    this.log('system', `${labelForSeat(seat.seat)} ${op === 'buy_star' ? 'sold a star to the dealer' : 'bought a star from the dealer'}.`);
    this._eliminateCheck('the dealer');
    this._emit();
    return { ok: true };
  }

  async _actionLoan(seat) {
    if (this.status !== 'act1' || this.phase !== 'trade') return { ok: false, error: 'not the trade phase' };
    const result = takeLoan(seat);
    if (!result.ok) return result;
    seat.loanTaken = true;
    seat.history.loans.push({ cycle: this.cycle, principal: LOAN_PRINCIPAL, repay: LOAN_REPAY, chips: seat.chips });
    this.log('system', `${labelForSeat(seat.seat)} signed the note. The interest is already counting.`);
    this._emit();
    return { ok: true };
  }

  async _actionTaunt(seat, { id }) {
    if (!Number.isInteger(id) || id < 0 || id >= TAUNTS.length) return { ok: false, error: 'no such line' };
    if (seat.tauntedCycle === this.cycle) return { ok: false, error: 'one line per cycle' };
    seat.tauntedCycle = this.cycle;
    this.log('taunt', TAUNTS[id], { seat: seat.seat, taunt: id });
    this._emit();
    return { ok: true };
  }

  async _actionDuelHandCommit(seat, { root, commit }) {
    if (this.status !== 'finale' || this.phase !== 'finale_intro') return { ok: false, error: 'the back room is closed' };
    const side = this.sideOfSeat(seat.seat);
    if (!side) return { ok: false, error: 'you are not at this table' };
    if (this.finale.ready[side]) return { ok: false, error: 'hand already committed' };
    if (typeof root !== 'string' || !HEX64.test(root)) return { ok: false, error: 'bad hand root' };
    if (typeof commit !== 'string' || !HEX64.test(commit)) return { ok: false, error: 'bad commitment' };
    const expected = await duelHandCommit(this.id, seat.seat, root);
    if (expected !== commit) return { ok: false, error: 'commitment mismatch' };
    seat.duelHandRoot = root;
    seat.duelHandCommit = commit;
    seat.duelHandReady = true;
    this.finale.ready[side] = true;
    this.log('system', `${labelForSeat(seat.seat)} takes the ${this.finale.roles[side].toUpperCase()}.`);
    this._emit();
    this._maybeStartDuel();
    return { ok: true };
  }

  async _actionDuelCommit(seat, { commit }) {
    if (this.status !== 'finale' || this.phase !== 'duel_commit') return { ok: false, error: 'not the bet phase' };
    const side = this.sideOfSeat(seat.seat);
    if (!side) return { ok: false, error: 'you are not at this table' };
    const rec = this.finale.plays[side];
    if (rec?.commit) return { ok: false, error: 'already committed' };
    if (typeof commit !== 'string' || !HEX64.test(commit)) return { ok: false, error: 'bad commitment' };
    this.finale.plays[side] = { commit, reveal: null, botReveal: null };
    this._emit();
    if (this.finale.plays.a?.commit && this.finale.plays.b?.commit) this._enterDuelReveal();
    return { ok: true };
  }

  async _actionDuelReveal(seat, payload) {
    if (this.status !== 'finale' || this.phase !== 'duel_reveal') return { ok: false, error: 'not the reveal phase' };
    const side = this.sideOfSeat(seat.seat);
    if (!side) return { ok: false, error: 'you are not at this table' };
    return this._applyDuelReveal(side, payload);
  }

  async _actionHandReveal(seat, { act, cards, salts }) {
    if (act !== 'duel' && act !== 'act1') return { ok: false, error: 'bad hand kind' };
    // Revealing a hand publishes it in the audit. Never allow that while the
    // hand can still be played: Act I hands open only after Act I closes, and
    // duel hands open only when the voyage has settled.
    const revealOpen = act === 'duel'
      ? this.status === 'settled'
      : ['act1_end', 'finale', 'settled'].includes(this.status);
    if (!revealOpen) return { ok: false, error: 'the hand stays sealed' };
    if (!Array.isArray(cards) || !Array.isArray(salts) || cards.length !== salts.length) {
      return { ok: false, error: 'bad hand reveal' };
    }
    if (cards.length > 12) return { ok: false, error: 'bad hand size' };
    const root = act === 'duel' ? seat.duelHandRoot : seat.act1HandRoot;
    if (!root) return { ok: false, error: 'no committed hand' };
    const tree = await buildHandTree(cards, salts);
    if (tree.root !== root) return { ok: false, error: 'hand does not match the commitment' };
    if (act === 'duel') seat.duelHandReveal = { cards: [...cards], salts: [...salts] };
    else seat.act1HandReveal = { cards: [...cards], salts: [...salts] };
    this.audit = this.buildAudit();
    this._emit();
    return { ok: true };
  }

  async _actionDisconnect(seat, { connected }) {
    seat.connected = Boolean(connected);
    this._emit();
    return { ok: true };
  }

  // ----------------------------------------------------------------- bots

  _botTarget(exclude = null) {
    const options = this.seats.filter((s) => s.alive && s.cardsLeft > 0 && s.seat !== exclude);
    return options.length ? pick(options) : null;
  }

  async _botTrade(seat) {
    if (this.status !== 'act1' || this.phase !== 'trade' || !seat.alive) return;
    if (seat.stars <= 1 && seat.chips >= STAR_DEALER_SELL) {
      const r = dealerSellStar(seat);
      if (r.ok) {
        seat.history.dealer.push({ op: 'sell_star', cycle: this.cycle, stars: seat.stars, chips: seat.chips });
        this.log('system', `${labelForSeat(seat.seat)} bought a star from the dealer.`);
        this._emit();
        return;
      }
    }
    if (seat.stars <= 1 && !seat.loanTaken) {
      const r = takeLoan(seat);
      if (r.ok) {
        seat.loanTaken = true;
        seat.history.loans.push({ cycle: this.cycle, principal: LOAN_PRINCIPAL, repay: LOAN_REPAY, chips: seat.chips });
        this.log('system', `${labelForSeat(seat.seat)} signed the note.`);
        this._emit();
      }
      return;
    }
    if (randomInt(100) < 28 && seat.offersThisCycle < MAX_OFFERS_PER_CYCLE) {
      const target = this._botTarget(seat.seat);
      if (target) {
        const wantsStar = seat.stars <= 2 && seat.chips >= 30;
        const give = wantsStar ? { stars: 0, chips: 30 } : { stars: 0, chips: 20 };
        const want = wantsStar ? { stars: 1, chips: 0 } : { stars: 0, chips: 25 };
        if (this._survivesTrade(seat, give, want) &&
            this._survivesTrade(target, want, give) &&
            canTrade(seat, give.stars, give.chips, want.stars, want.chips)) {
          const offer = {
            id: newId(), from: seat.seat, to: target.seat, give, want,
            cycle: this.cycle, status: 'open', createdAt: this._now(), expiresAt: this.phaseEndsAt,
          };
          this.offers.push(offer);
          seat.offersThisCycle += 1;
          seat.history.offers.push({ ...offer });
          this.log('system', 'A sealed note changed hands.');
          this._emit();
          if (target.isBot) this._botTimer(() => this._botRespondToOffer(offer), 900, 3000);
        }
      }
    }
  }

  _botRespondToOffer(offer) {
    const me = this.seats[offer.to];
    if (!me?.isBot || offer.status !== 'open' || this.phase !== 'trade') return;
    const sender = this.seats[offer.from];
    if (!sender?.alive || !me.alive) return;
    const value = (side) => side.stars * 34 + side.chips;
    const gain = value(offer.give) - value(offer.want);
    const canCover = me.stars >= offer.want.stars && me.chips >= offer.want.chips;
    const keepStar = me.stars - offer.want.stars + offer.give.stars >= 1;
    const accept = canCover && keepStar && gain >= 4 && !(offer.want.stars > 0 && me.stars <= 2);
    this._respondToOffer(offer, accept);
  }

  _botChallenge(seat) {
    if (this.status !== 'act1' || this.phase !== 'challenge' || !seat.alive) return;
    const options = this.seats.filter((s) => s.alive && s.cardsLeft > 0 && s.seat !== seat.seat);
    if (!options.length) {
      this.challenges[seat.seat] = null;
    } else {
      // Prefer the weakest star holder; occasionally pick at random.
      options.sort((a, b) => a.stars - b.stars);
      const target = randomInt(100) < 62 ? options[0] : pick(options);
      this.challenges[seat.seat] = target.seat;
    }
    this._emit();
    if (this._eligible().every((s) => Object.prototype.hasOwnProperty.call(this.challenges, s.seat))) {
      this._botTimer(() => {
        if (this.phase === 'challenge') this._resolveChallenges();
      }, 300, 700);
    }
  }

  async _botPlayCommit(seat) {
    if (this.status !== 'act1' || this.phase !== 'play') return;
    const rec = this.plays[seat.seat];
    if (!rec || rec.commit || !seat.act1Hand) return;
    const remaining = seat.act1Hand.cards
      .map((card, index) => ({ card, index }))
      .filter(({ index }) => !seat.act1UsedIndices.has(index));
    if (!remaining.length) return;
    // House style: mostly random, with a slight bias against the last card it
    // showed. It has no access to the opponent's hand.
    const choice = pick(remaining);
    const salt = seat.act1Hand.salts[choice.index];
    const proof = proofFor(seat.act1Hand.tree, choice.index);
    const playSalt = randomHex(16);
    const commit = await playCommit(this.id, this.cycle, seat.seat, choice.card, playSalt);
    rec.commit = commit;
    rec.botReveal = { card: choice.card, index: choice.index, salt, proof, playSalt };
    this._emit();
    if (this._allCommitsIn()) this._enterReveal();
  }

  async _botDuelCommit(side) {
    if (this.status !== 'finale' || this.phase !== 'duel_commit') return;
    const seat = this._seatForSide(side);
    if (!seat?.duelHand || this.finale.plays[side]?.commit) return;
    const role = this.finale.roles[side];
    const move = chooseDuelMove({
      hand: seat.duelHand.cards,
      used: [...seat.duelUsedIndices],
      chips: this.finale.chips[side],
      round: this.finale.round,
      history: this.finale.rounds,
      role,
      rng: Math.random,
    });
    const index = Math.max(0, Math.min(4, move.index));
    const card = seat.duelHand.cards[index];
    const salt = seat.duelHand.salts[index];
    const proof = proofFor(seat.duelHand.tree, index);
    const playSalt = randomHex(16);
    const bet = clamp(move.bet, 0, Math.min(20, this.finale.chips[side]));
    const commit = await duelPlayCommit(this.id, this.finale.round, seat.seat, card, bet, playSalt);
    this.finale.plays[side] = {
      commit,
      reveal: null,
      botReveal: { card, index, salt, proof, bet, playSalt },
    };
    this._emit();
    if (this.finale.plays.a?.commit && this.finale.plays.b?.commit) this._enterDuelReveal();
  }

  // -------------------------------------------------------------- snapshot

  _publicSeat(seat) {
    return {
      seat: seat.seat,
      handle: seat.handle,
      isBot: seat.isBot,
      replacedByHouse: seat.replacedByHouse,
      stars: seat.alive ? seat.stars : 0,
      chips: seat.chips,
      cardsLeft: seat.cardsLeft,
      alive: seat.alive,
      connected: seat.connected,
      eliminatedCycle: seat.eliminatedCycle,
      tookLoan: seat.loanTaken,
      role: seat.role,
      handReady: seat.act1HandReady,
      duelReady: seat.duelHandReady,
    };
  }

  _publicFinale(seatIndex) {
    if (!this.finale) return null;
    const f = this.finale;
    const side = this.sideOfSeat(seatIndex);
    const name = (s) => {
      const seat = this._seatForSide(s);
      if (!seat) return 'THE HOUSE';
      return seat.seat === -1 ? 'THE HOUSE' : seat.handle;
    };
    return {
      a: f.a,
      b: f.b,
      house: f.house,
      humanSide: f.humanSide,
      bankrollZats: f.bankrollZats,
      potZats: f.potZats,
      roles: f.roles,
      round: f.round,
      rounds: f.rounds.map(({ plays, ...rest }) => rest),
      lastRound: f.lastRound ? (({ plays, ...rest }) => rest)(f.lastRound) : null,
      winner: f.winner,
      winnerSeat: f.winnerSeat,
      split: f.split,
      forfeit: f.forfeit,
      yourSide: side,
      yourRole: side ? f.roles[side] : null,
      yourChips: side ? f.chips[side] : null,
      opponentChips: null,
      names: { a: name('a'), b: name('b') },
      ready: { a: f.ready.a, b: f.ready.b },
      committed: { a: Boolean(f.plays.a?.commit), b: Boolean(f.plays.b?.commit) },
      revealed: { a: Boolean(f.plays.a?.reveal), b: Boolean(f.plays.b?.reveal) },
      yourCommitted: side ? Boolean(f.plays[side]?.commit) : false,
      yourRevealed: side ? Boolean(f.plays[side]?.reveal) : false,
      needHandCommit: side ? !f.ready[side] : false,
    };
  }

  snapshotFor(seatIndex) {
    const seat = this.seats[seatIndex] ?? null;
    const side = this.sideOfSeat(seatIndex);
    const pair = this.pairings.find(([a, b]) => a === seatIndex || b === seatIndex) ?? null;
    const mine = pair ? this.plays[seatIndex] : null;
    const offersToYou = seat
      ? this.offers
        .filter((o) => o.to === seatIndex && o.status === 'open')
        .map((o) => ({ id: o.id, from: o.from, fromName: labelForSeat(o.from), give: o.give, want: o.want, expiresAt: o.expiresAt }))
      : [];
    const yourOffers = seat
      ? this.offers
        .filter((o) => o.from === seatIndex && o.status === 'open')
        .map((o) => ({ id: o.id, to: o.to, toName: labelForSeat(o.to), give: o.give, want: o.want }))
      : [];
    const yourPlay = mine
      ? { committed: Boolean(mine.commit), revealed: Boolean(mine.reveal) }
      : null;
    const opponent = pair ? pair[0] === seatIndex ? pair[1] : pair[0] : null;
    const opponentPlay = opponent != null && this.plays[opponent]
      ? { committed: Boolean(this.plays[opponent].commit), revealed: Boolean(this.plays[opponent].reveal) }
      : null;

    const needActReveal = Boolean(seat && seat.act1HandRoot && !seat.act1HandReveal &&
      (this.status === 'act1_end' || this.status === 'finale' || this.status === 'settled'));
    const needDuelReveal = Boolean(seat && side && seat.duelHandRoot && !seat.duelHandReveal &&
      (this.status === 'settled'));
    const bankrollZats = this.mode === 'solo'
      ? (this.finale?.bankrollZats ?? (seat ? bankrollZatsFor(seat.chips, this.stakeZats) : 0))
      : 0;

    return {
      id: this.id,
      code: this.code,
      mode: this.mode,
      status: this.status,
      phase: this.phase,
      cycle: this.cycle,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: this._now(),
      stakeZats: this.stakeZats,
      bankrollZats,
      potZats: potZatsFor(bankrollZats),
      seats: this.seats.map((s) => this._publicSeat(s)),
      house: this.house ? { seat: -1, handle: 'THE HOUSE', isBot: true } : null,
      log: this.logEntries.slice(-80),
      you: seat ? {
        seat: seat.seat,
        handle: seat.handle,
        isBot: seat.isBot,
        stars: seat.stars,
        chips: seat.chips,
        debt: seat.debt,
        cardsLeft: seat.cardsLeft,
        alive: seat.alive,
        act1HandReady: seat.act1HandReady,
        duelReady: seat.duelHandReady,
        role: seat.role,
        duelChips: side ? this.finale.chips[side] : null,
      } : null,
      yourSide: side,
      pairing: pair,
      opponent,
      bye: this.bye === seatIndex,
      yourPlay,
      opponentPlay,
      lastRound: this.phase === 'resolve' && seat ? (this.lastRoundBySeat[seatIndex] ?? null) : null,
      pairings: this.pairings,
      offersToYou,
      yourOffers,
      needHandCommit: this.status === 'muster' && Boolean(seat) && !seat.isBot && !seat.act1HandReady,
      needHandReveal: needActReveal,
      needDuelHandReveal: needDuelReveal,
      finale: this._publicFinale(seatIndex),
      settlement: this.settlement ? {
        winnerSeat: this.settlement.winnerSeat,
        split: this.settlement.split,
        houseWon: this.settlement.houseWon,
        stakeZats: this.settlement.stakeZats,
        bankrollZats: this.settlement.bankrollZats,
        potZats: this.settlement.potZats,
        payoutZats: this.settlement.payoutZats,
        status: this.settlement.status,
        txid: this.settlement.txid,
        walletCredited: this.settlement.walletCredited,
      } : null,
      canStart: this.status === 'lobby' && seat?.seat === 0,
    };
  }

  // ----------------------------------------------------------------- audit

  buildAudit() {
    const seatAudit = (seat) => ({
      seat: seat.seat,
      handle: seat.handle,
      isBot: seat.isBot,
      replacedByHouse: seat.replacedByHouse,
      starsStart: START_STARS,
      starsEnd: seat.stars,
      chipsStart: START_CHIPS,
      chipsEnd: seat.chips,
      debtEnd: seat.debt,
      alive: seat.alive,
      eliminatedCycle: seat.eliminatedCycle,
      act1HandRoot: seat.act1HandRoot,
      act1HandCommit: seat.act1HandCommit,
      act1HandReveal: seat.act1HandReveal,
      act1UsedLeaves: [...seat.act1UsedLeaves],
      cardsLeft: seat.cardsLeft,
      loanTaken: seat.loanTaken,
      history: seat.history,
    });

    const finale = this.finale ? {
      a: this.finale.a,
      b: this.finale.b,
      house: this.finale.house,
      humanSide: this.finale.humanSide,
      bankrollZats: this.finale.bankrollZats,
      potZats: this.finale.potZats,
      roles: this.finale.roles,
      chips: { ...this.finale.chips },
      rounds: this.finale.rounds,
      winner: this.finale.winner,
      winnerSeat: this.finale.winnerSeat,
      split: this.finale.split,
      forfeit: this.finale.forfeit,
      hands: ['a', 'b'].map((side) => {
        const seat = this._seatForSide(side);
        return {
          side,
          seat: seat?.seat ?? null,
          role: this.finale.roles[side],
          root: seat?.duelHandRoot ?? null,
          commit: seat?.duelHandCommit ?? null,
          reveal: seat?.duelHandReveal ?? null,
        };
      }),
    } : null;

    const allSeatsRevealed = this.seats.every((s) => s.act1HandReveal || !s.act1HandRoot);
    const allDuelRevealed = !this.finale || ['a', 'b'].every((side) => {
      const s = this._seatForSide(side);
      return !s?.duelHandRoot || s.duelHandReveal;
    });

    return {
      version: 1,
      game: 'the-derelict',
      tableId: this.id,
      mode: this.mode,
      stakeZats: this.stakeZats,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      config: {
        rpsHand: RPS_HAND,
        startStars: START_STARS,
        startChips: START_CHIPS,
        loanPrincipal: LOAN_PRINCIPAL,
        loanRepay: LOAN_REPAY,
        dealerBuy: STAR_DEALER_BUY,
        dealerSell: STAR_DEALER_SELL,
        ecardRounds: ECARD_ROUNDS,
        ecardStartChips: ECARD_START_CHIPS,
      },
      act1: {
        rounds: this.rounds,
        playArchive: this.playArchive,
        seats: this.seats.map(seatAudit),
      },
      finale,
      settlement: this.settlement ? { ...this.settlement, winnerUa: undefined } : null,
      complete: allSeatsRevealed && allDuelRevealed,
      log: this.logEntries,
    };
  }

  // ------------------------------------------------------------------ misc

  log(kind, text, meta = {}) {
    const entry = {
      seq: ++this._logSeq,
      t: this._now() - this.createdAt,
      kind,
      text: String(text).slice(0, 400),
      ...meta,
    };
    this.logEntries.push(entry);
    if (this.logEntries.length > 240) this.logEntries.splice(0, this.logEntries.length - 240);
    return entry;
  }

  _emit() {
    if (this.disposed) return;
    try { this.onChange(this); } catch { /* a broken socket must not kill the table */ }
  }
}

export { labelForSeat, MAX_CYCLES };
