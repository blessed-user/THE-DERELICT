// THE DERELICT — Act II: the E-Card duel.
//
// Two roles, both with five cards:
//   Crown  — one Crown, four Citizens
//   Rebel  — one Rebel, four Citizens
// Matchups: Crown beats Citizen, Citizen beats Rebel, Rebel beats Crown.
// A Rebel win pays double the matched bet. The underdog has leverage; the
// favourite has position. Both have something to hide.

export const ECARD_BEATS = { crown: 'citizen', citizen: 'rebel', rebel: 'crown' };

export function ecardOutcome(a, b) {
  if (!(a in ECARD_BEATS) || !(b in ECARD_BEATS)) throw new Error('unknown duel card');
  if (a === b) return 'tie';
  return ECARD_BEATS[a] === b ? 'a' : 'b';
}

export function handFor(role) {
  return [role, 'citizen', 'citizen', 'citizen', 'citizen'];
}

export function validBet(bet, chips) {
  return Number.isInteger(bet) && bet >= 0 && bet <= 20 && bet <= chips;
}

// Winner takes the loser's matched stake, doubled when the Rebel wins.
// Returns the actual transfer after capping at the loser's stack.
export function ecardTransfer(winner, bets, chips, roles) {
  if (winner === 'tie') return { amount: 0, multiplier: 1 };
  const base = Math.min(bets.a, bets.b);
  if (base <= 0) return { amount: 0, multiplier: 1 };
  const winnerRole = winner === 'a' ? roles.a : roles.b;
  const multiplier = winnerRole === 'rebel' ? 2 : 1;
  const loser = winner === 'a' ? 'b' : 'a';
  const amount = Math.min(base * multiplier, chips[loser]);
  return { amount, multiplier };
}

export function duelWinner(chips) {
  if (chips.a === chips.b) return 'tie';
  return chips.a > chips.b ? 'a' : 'b';
}

// The house's duel strategy. It sees its own hand, the public round history,
// its own stack and the opponent's revealed history only. It never receives
// the opponent's hidden hand or bet.
export function chooseDuelMove({ hand, used, chips, round, history, role, rng = Math.random }) {
  const remaining = hand.map((card, i) => ({ card, i })).filter(({ i }) => !used.includes(i));
  if (!remaining.length) return { index: 0, card: role, bet: 0 };

  const specialLeft = remaining.some((c) => c.card === role);
  const strength = specialLeft && remaining.length <= 3 ? 0.75 : 0.45;
  const noise = (rng() - 0.5) * 0.28;
  const aggressive = strength + noise > 0.52;

  // Pick a card. Keep the special for later when the stack is healthy, unless
  // the opponent's revealed pattern suggests they are about to show theirs.
  const citizens = remaining.filter((c) => c.card === 'citizen');
  const special = remaining.find((c) => c.card === role);
  let pick;
  if (special && (remaining.length <= 2 || (aggressive && rng() > 0.55))) pick = special;
  else pick = citizens[Math.floor(rng() * citizens.length)] ?? special ?? remaining[0];

  const maxBet = Math.min(20, chips);
  let bet = 0;
  if (aggressive) bet = Math.min(maxBet, 4 + Math.floor(rng() * 12));
  else if (rng() > 0.55) bet = Math.min(maxBet, 2 + Math.floor(rng() * 6));
  return { index: pick.i, card: pick.card, bet };
}
