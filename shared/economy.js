// THE DERELICT — staked-run bankroll arithmetic.
//
// Shared by the table, the server front door, and the independent audit so a
// payout can be recomputed from the settled ledger instead of trusted as a
// summary field. The units are zats and whole chips.

import { START_CHIPS, ECARD_START_CHIPS } from './constants.js';
import { sha256Hex } from './crypto.js';

// Act I chips carry the fare: the whole starting stack is worth the stake.
export function bankrollZatsFor(chips, stakeZats) {
  const c = Number(chips);
  const s = Number(stakeZats);
  if (!Number.isFinite(c) || !Number.isFinite(s) || c <= 0 || s <= 0) return 0;
  return Math.floor((c * s) / START_CHIPS);
}

// The back room rescales the surviving bankroll onto 100 chips. The house
// matches it, so both sides start with the same chip value.
export function duelChipZats(bankrollZats) {
  const b = Number(bankrollZats);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return Math.floor(b / ECARD_START_CHIPS);
}

// A human collects the matched pot on a win and their own bankroll on a
// split; losing the back room returns nothing. The house's half is the bonus.
export function finalPayoutZats({ mode, humanSide, finale }) {
  if (mode !== 'solo' || !humanSide || !finale) return 0;
  const bankrollZats = Number(finale.bankrollZats ?? 0);
  if (bankrollZats <= 0) return 0;
  if (finale.split) return bankrollZats;
  if (finale.winner !== humanSide) return 0;
  return potZatsFor(bankrollZats);
}

export function potZatsFor(bankrollZats) {
  const b = Number(bankrollZats);
  return Number.isFinite(b) && b > 0 ? b * 2 : 0;
}

export function economyCommitmentPayload(audit) {
  const payload = structuredClone(audit);
  delete payload.complete;
  delete payload.log;

  for (const seat of payload.act1?.seats ?? []) {
    delete seat.act1HandReveal;
  }
  if (payload.finale) delete payload.finale.hands;
  if (payload.settlement) {
    for (const key of ['status', 'txid', 'walletCredited', 'winnerUa', 'settledAt', 'error', 'economyAnchor']) {
      delete payload.settlement[key];
    }
  }

  return payload;
}

export async function economyCommitmentHash(audit) {
  return sha256Hex(JSON.stringify(economyCommitmentPayload(audit)));
}
