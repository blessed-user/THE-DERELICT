# Demo video script (~90 seconds)

Record at 1280×720 or larger, with the regtest stack already running and `PHASE_SCALE=0.1`.

## 0:00–0:12 — cold open

Screen: the landing page, sodium light, hazard stripes.

> "Four seats. Six cards each. Three stars. The table never sees your hand."

Click **TAKE A SEAT**.

## 0:12–0:30 — private hand

Screen: the muster phase, hand fan visible.

> "Your browser generates the hand and commits a Merkle root. The server gets the root —
> not the cards. When you play, you reveal one card with an inclusion proof. The other
> five stay yours."

Open DevTools → Network → WS messages for two seconds; highlight a `hand_commit` and a
`play_reveal`.

## 0:30–0:50 — the side market and the hold

Screen: trade panel, offer to a seat, dealer prices, then a challenge and a reveal.

> "Private offers go only to the seat they name. The dealer buys stars at twenty and sells
> at fifty. The loan shark takes sixty percent. Win a pairing and take a star; hit zero and
> you're out."

Let one round resolve on screen.

## 0:50–1:05 — the back room

Screen: the E-Card duel board, sealed cards, bet input.

> "The last two play the E-Card duel: one SPECIAL, four CITIZENS, five rounds, hidden card
> and hidden bet. The REBEL's wins pay double. Every wager is sealed before the show."

Seal a card and bet; show a duel round resolving.

## 1:05–1:20 — settlement

Screen: result panel and THE AUDIT.

> "The fare became the bankroll, and the house matched it in the back room. A human winner
> is paid the matched pot — twice the bankroll — in shielded ZEC to a unified address. The
> entry was a shielded transaction with a table memo. No transparent settlement."

Click **DOWNLOAD AUDIT JSON**, then in a terminal:

```bash
node scripts/verify-audit.mjs audit.json
```

Show the OK verdict.

## 1:20–1:30 — close

Screen: README threat model section.

> "Every hand rebuilds. Every play is inside its hand. The ledger balances. And the threat
> model says exactly what the server still sees. THE DERELICT — Wildcard track."

## B-roll checklist

- landing page with all three modes
- hand fan with one card spent
- private offer panel
- duel board mid-round
- audit panel and CLI verdict
- `docker compose ps` showing zebra, funder, derelict
- a shielded transaction row in the funder wallet (optional; do not show secrets)
