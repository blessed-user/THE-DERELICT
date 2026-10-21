// THE DERELICT — Act I rules. Pure functions, no I/O.
import {
  STAR_DEALER_BUY, STAR_DEALER_SELL, LOAN_PRINCIPAL, LOAN_REPAY,
} from './constants.js';

export const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export function rpsOutcome(a, b) {
  if (!(a in RPS_BEATS) || !(b in RPS_BEATS)) throw new Error('unknown RPS card');
  if (a === b) return 'tie';
  return RPS_BEATS[a] === b ? 'a' : 'b';
}

// targets: { seat: targetSeat | null }
// Mutual challenges pair first; the rest are shuffled and paired; one bye if
// the alive count is odd. `rng(n)` must return an integer in [0, n).
export function pairPlayers(targets, aliveSeats, rng) {
  if (!aliveSeats.length) return { pairs: [], bye: null };
  const alive = new Set(aliveSeats);
  const used = new Set();
  const pairs = [];

  for (const a of aliveSeats) {
    const b = targets?.[a];
    if (b == null || b === a || !alive.has(b) || used.has(a) || used.has(b)) continue;
    if (targets?.[b] === a) {
      pairs.push([Math.min(a, b), Math.max(a, b)]);
      used.add(a);
      used.add(b);
    }
  }

  const rest = aliveSeats.filter((s) => !used.has(s));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  let bye = null;
  if (rest.length % 2 === 1) bye = rest.pop();
  for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
  return { pairs, bye };
}

// Top two survivors advance. Stars first, then chips, then a drawn seat.
export function rankSurvivors(seats) {
  return [...seats].sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    if (b.chips !== a.chips) return b.chips - a.chips;
    return (a.seat ?? 0) - (b.seat ?? 0);
  });
}

export function topTwo(seats, rng = () => 0) {
  const ranked = rankSurvivors(seats);
  if (ranked.length <= 2) return ranked;
  // Resolve an exact tie on the second/third boundary with a fair draw.
  const boundary = ranked.slice(1, 3);
  if (ranked[0].stars === ranked[1].stars && ranked[1].stars === ranked[2]?.stars &&
      ranked[1].chips === ranked[2]?.chips) {
    const i = 1 + rng(2);
    const pick = ranked[i];
    return [ranked[0], pick];
  }
  return ranked.slice(0, 2);
}

export function canTrade(seat, giveStars, giveChips, wantStars, wantChips) {
  if (!Number.isInteger(giveStars) || !Number.isInteger(giveChips) ||
      !Number.isInteger(wantStars) || !Number.isInteger(wantChips)) return false;
  if ([giveStars, giveChips, wantStars, wantChips].some((n) => n < 0)) return false;
  if (giveStars + giveChips + wantStars + wantChips === 0) return false;
  if (seat.stars < giveStars) return false;
  if (seat.chips < giveChips) return false;
  // A trade may not hand away the last star and leave the sender alive at 0;
  // the transfer is allowed, but the sender will be eliminated immediately.
  return true;
}

export function applyTrade(sender, recipient, giveStars, giveChips, wantStars, wantChips) {
  sender.stars -= giveStars;
  sender.chips -= giveChips;
  recipient.stars += giveStars;
  recipient.chips += giveChips;
  sender.stars += wantStars;
  sender.chips += wantChips;
  recipient.stars -= wantStars;
  recipient.chips -= wantChips;
}

export function dealerBuyStar(seat) {
  if (seat.stars <= 1) return { ok: false, reason: 'the last star is not yours to sell' };
  seat.stars -= 1;
  seat.chips += STAR_DEALER_BUY;
  return { ok: true };
}

export function dealerSellStar(seat) {
  if (seat.chips < STAR_DEALER_SELL) return { ok: false, reason: 'not enough chips' };
  seat.chips -= STAR_DEALER_SELL;
  seat.stars += 1;
  return { ok: true };
}

export function takeLoan(seat) {
  if (seat.debt > 0) return { ok: false, reason: 'one loan per voyage' };
  seat.chips += LOAN_PRINCIPAL;
  seat.debt = LOAN_REPAY;
  return { ok: true };
}

// Called when Act I closes. A debtor who cannot cover the note is seized
// before anyone advances.
export function settleDebt(seat) {
  if (seat.debt <= 0) return { ok: true, seized: false };
  if (seat.chips < seat.debt) return { ok: false, seized: true };
  seat.chips -= seat.debt;
  seat.debt = 0;
  return { ok: true, seized: false };
}
