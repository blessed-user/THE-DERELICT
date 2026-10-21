# THE DERELICT — protocol notes

This document describes the wire protocol and the commitment scheme precisely enough to
reimplement or audit a client. The canonical implementation is `shared/crypto.js`,
`server/game.mjs`, and `shared/audit.js`.

## 1. Identities and transport

- A browser generates a random `playerId` and stores it locally. It is a convenience for
  rejoining, not an account.
- `POST /api/tables` creates a table and returns a 24-byte random `token`, the seat index,
  and a WebSocket path. The token is the only seat credential.
- The WebSocket (`/ws?table=…&token=…`) carries `hello`, `state`, `ack`, `error`, and
  `pong` messages. Actions are:
  `{type:"action", action, payload, requestId}` and are answered with
  `{type:"ack", action, requestId, ok, error?}`.
- Every socket receives `state` filtered for its own seat. Hands, unplayed cards, private
  offers, and sealed bets are never included in another seat's view.

## 2. Canonical strings and commitments

All hashes are SHA-256 over UTF-8, lowercase hex.

```
leaf            derelict:v1|leaf|<index>|<card>|<salt>
hand            derelict:v1|hand|<tableId>|<seat>|<root>
duel hand       derelict:v1|duelhand|<tableId>|<seat>|<root>
Act I play      derelict:v1|play|<tableId>|<cycle>|<seat>|<card>|<playSalt>
duel play       derelict:v1|duel|<tableId>|<round>|<seat>|<card>|<bet>|<playSalt>
empty leaf      derelict:v1|empty
```

- A hand is six cards for Act I (`rock rock paper paper scissors scissors`) or five for the
  duel (`special citizen citizen citizen citizen`), each with a 16-byte random salt.
- Leaves are `leaf(index, card, salt)`, padded to the next power of two (minimum 2) with
  the fixed empty-leaf hash. Internal nodes are `SHA-256(left + right)` where left and
  right are lowercase hex strings.
- The hand commitment binds the table and seat, so a hand cannot be replayed at another
  table or under another seat.
- The play commitment binds the table, cycle/round, seat, card, and a fresh play salt
  (and the bet, for the duel). It is shown before the card.
- A reveal supplies the card, its leaf index, the leaf salt, a Merkle proof, and the play
  salt. The server recomputes the leaf, verifies the proof against the hand root, checks
  the play commitment, and rejects a leaf index already used by that seat in that hand.

## 3. Hand lifecycle

1. **Muster (Act I).** Each human client generates its hand locally and sends
   `hand_commit {root, commit}`. The server verifies `commit = hand(tableId, seat, root)`
   and stores only the root and commitment. It does not receive cards.
2. **Play.** The client sends `play_commit {commit}` during the play phase. During reveal
   it sends `play_reveal {card, index, salt, proof, playSalt}`. The server resolves the
   pair only after both reveals (or a forfeit at the deadline).
3. **Post-match reveal.** After Act I ends, every seat sends
   `hand_reveal {act:"act1", cards, salts}`. This happens even if the seat was eliminated,
   so the audit can rebuild the hand. House seats' hands are revealed by the server.
4. **Back room.** The two finalists send `duel_hand_commit {root, commit}`, then per round
   `duel_commit {commit}` and `duel_reveal {card, index, salt, proof, bet, playSalt}`.
   After settlement each finalist sends `hand_reveal {act:"duel", cards, salts}`.

Auto-play safety: the browser stages a remaining card and commits it shortly before the
play deadline if the player has not chosen, and auto-reveals it. The intended card and
play salt are kept in memory/localStorage so a refresh does not forfeit the hand.

## 4. Private side market

- `offer {to, give:{stars,chips}, want:{stars,chips}}` creates a one-to-one offer. Only the
  sender and recipient see it in their snapshots. The server relays and validates it; the
  operator can read it.
- `offer_response {offerId, accept}` accepts or refuses. Accepted trades are applied
  atomically and written to both seats' histories and the audit ledger.
- Limits: three offers per seat per cycle, balances must cover the legs, and a trade may
  not leave a seat at zero stars (that would be a disguised elimination).
- `dealer {op:"buy"|"sell"}` trades one star at the fixed dealer price.
- `loan {op:"take"}` issues 40 chips against a 64-chip note, seized at the end of Act I if
  unpaid. One note per seat.
- `taunt {id}` sends a canned intercom line. There is no free-text channel.

## 5. Audit document

`GET /api/tables/:id/audit` returns the `buildAudit` object. Its top level:

```
{
  version, tableId, mode, stakeZats,
  act1: {
    seats: [{ seat, handle, isBot, handRoot, handCommit, act1HandReveal, ... }],
    playArchive: [{ cycle, pairings, bye, plays: {seat: {commit, reveal}} }],
    rounds: [{ cycle, pair, cards, outcome, transfer, starsBefore, starsAfter }],
    offers, dealerOps, loans, cycles, ...
  },
  finale: {
    a, b, humanSide, bankrollZats, potZats,
    roles, chips, rounds: [...], hands: {...}, winnerSeat, split, forfeit, ...
  },
  settlement: { winnerSeat, split, houseWon, stakeZats, bankrollZats, potZats, payoutZats, ... },
  complete: boolean
}
```

`shared/audit.js` re-derives everything it can and reports `{ok, errors, warnings, stats}`:

- rebuilds every hand root from `cards`/`salts` and checks `handCommit`;
- checks exactly two of each RPS card in every Act I hand, and one SPECIAL + four CITIZENS
  in every duel hand;
- checks each play's commitment, leaf hash, proof, index, and per-seat leaf uniqueness;
- replays each round's outcome, star transfer, forfeits, and both-forfeit burns;
- replays the star/chip ledger from the start values through accepted offers, dealer
  operations, loans, rounds, eliminations, and debt settlement;
- derives survivors and finalists, then checks the finale hands and every duel round;
- checks the settlement arithmetic: the surviving Act I stack determines the bankroll,
  the house matches it in the back room, a human win pays the matched pot, and a split
  returns the bankroll;
- errors if `complete` is false (someone left before revealing their hand).

The CLI wrapper is `scripts/verify-audit.mjs <file|->`.

## 6. Settlement

- The server is the house bankroll. It is not an escrow and does not hold funds on behalf
  of two players.
- A staked table gets a fresh shielded address and a memo `derelict:<tableId>:<seat>`.
  The watcher accepts receive rows with that memo and credits the exact stake once
  confirmed.
- A human duel win pays the matched pot to the shielded address registered at table
  creation; a split returns the human's bankroll. Within a solo run the bankroll is
  `floor(chipsEnd * stakeZats / 40)`, the back room starts both sides at 100 chips worth
  that bankroll, and the pot is twice the bankroll. Payout is asynchronous and its txid
  (or error) is published in the settlement snapshot.
- A test wallet is a house-custodied ledger attached to one of the house's shielded
  addresses. `POST /api/test-wallet/pay` debits the fare and sends the shielded deposit;
  a successful payout to that address is credited back to the ledger.
- Regtest only: `POST /api/tables/:id/demo-fund` pays the fare from the house bankroll so
  the flow can be demonstrated without an external wallet. It sends the real memo and is
  ignored off regtest.
