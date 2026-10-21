// THE DERELICT — shared constants.
// Game rules live here so browser, server, bots and the audit verifier all
// speak the same numbers. Nothing in this file is secret.

export const GAME_NAME = 'THE DERELICT';

// ---- Act I: restricted RPS ----
// Six cards (2 of each) keeps a four-seat table inside ~5 minutes. The long
// voyage mode (12 cards, 4 of each) is a config knob, not a code path.
export const RPS_HAND = ['rock', 'rock', 'paper', 'paper', 'scissors', 'scissors'];
export const START_STARS = 3;
export const START_CHIPS = 40;

export const LOAN_PRINCIPAL = 40;
export const LOAN_REPAY = 64;          // 60% interest: the loan shark's entire character
export const STAR_DEALER_BUY = 20;     // dealer buys a star from you
export const STAR_DEALER_SELL = 50;    // dealer sells a star to you
export const MAX_OFFERS_PER_CYCLE = 3;

// ---- Act II: E-Card duel ----
export const ECARD_HAND = ['special', 'citizen', 'citizen', 'citizen', 'citizen'];
export const ECARD_ROUNDS = 5;
export const ECARD_START_CHIPS = 100;
export const ECARD_MAX_BET = 20;
export const ECARD_REBEL_MULTIPLIER = 2; // the underdog's leverage

// ---- phase timers (ms) ----
// Practice tables run the short clock; private tables get the long one.
// Decision windows are deliberately generous: a real table is read, not
// reflex-tested. Trade stays the longest because it is the only phase that
// always runs to the bell.
export const PHASE_MS = {
  muster:    { practice: 20_000, private: 30_000 },
  trade:     { practice: 24_000, private: 30_000 },
  challenge: { practice: 15_000, private: 18_000 },
  play:      { practice: 25_000, private: 30_000 },
  reveal:    { practice: 10_000, private: 12_000 },
  resolve:   { practice: 7_000,  private: 7_000 },
  finale_intro: { practice: 20_000, private: 30_000 },
  duelCommit:{ practice: 30_000, private: 30_000 },
  duelReveal:{ practice: 10_000, private: 12_000 },
  duelResult:{ practice: 7_000,  private: 7_000 },
};

export const SEATS = 4;
export const MAX_TRADE_PARTIES = 2; // every offer is strictly one-to-one

// ---- table modes ----
export const MODES = {
  practice: 'practice',       // one human + three house seats, free
  private: 'private',         // humans via join code; empty seats become house
  solo: 'solo',               // staked single-player run against the house
};

// Staked solo runs are house-sponsored: the entry is real shielded ZEC and the
// fare becomes the player's chip bankroll. Every Act I chip is worth
// stakeZats / START_CHIPS; the back room starts both sides at
// ECARD_START_CHIPS worth that same bankroll, and the house matches it. A win
// pays the matched pot (2× the bankroll); a split returns the bankroll.
export const MIN_STAKE_ZATS = 1_000_000;      // 0.01 ZEC
export const MAX_STAKE_ZATS = 20_000_000;     // 0.20 ZEC

export const HANDLE_WORDS = [
  'ASH', 'BRINE', 'CINDER', 'DRIFT', 'EMBER', 'FLOOD', 'GALE', 'HULL',
  'IRON', 'KEEL', 'LANTERN', 'MIST', 'NAIL', 'OATH', 'PILOT', 'QUAY',
  'RUST', 'SALT', 'TIDE', 'UNDERTOW', 'VEIL', 'WAKE', 'YARD', 'ZINC',
];
