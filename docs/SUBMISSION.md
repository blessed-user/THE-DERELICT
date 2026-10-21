# Zecathon 2026 submission — THE DERELICT

**Track:** Wildcard
**Repo:** this repository (MIT)
**Live demo:** `docker compose up --build -d` → http://127.0.0.1:8791
**Split demo (optional):** Vercel SPA + Railway backend, practice tables — see
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md)
**Video:** see `docs/VIDEO-SCRIPT.md`

## One-line pitch

A survival gambling game where the table cannot read your hand and the money moves in
shielded ZEC — server-blind cards during play, a public audit after settlement, and a
custodial demo bankroll on regtest.

## What it is

THE DERELICT is a two-act psychological gambling game for four anonymous seats. Act I is a
restricted rock-paper-scissors survival hold: six cards, three stars, a private side
market, a dealer, a loan shark, and elimination. The last two survivors enter the back room
for an asymmetric hidden E-Card duel — CROWN vs REBEL, five cards, hidden simultaneous card
and bet, with the REBEL's wins paying double.

The presentation is cold industrial noir: a rusting ship, sodium lights, a ship intercom,
and canned taunts instead of free-text chat. All names, art, and text are original; the
game is inspired by the pressure of Kaiji: The Ultimate Gambler, not derived from its
assets.

## Why it fits the privacy track (Wildcard)

1. **The server never receives an unplayed hand.** Each browser generates six salted
   cards, commits a Merkle root, and sends only the root. A played card arrives with its
   leaf salt and an inclusion proof; the server verifies the proof before resolving.
2. **Every play and every duel bet is sealed before the show.** The play commitment binds
   the card, a fresh salt, and — in the duel — the bet. Nobody can change a wager after
   seeing the other side.
3. **Private side deals are seat-to-seat.** Offers are relayed only into the sender's and
   recipient's snapshots.
4. **The whole match is auditable afterward.** A standalone verifier in `shared/audit.js`
   rebuilds every hand root, checks every proof and leaf-uniqueness rule, replays the
   star/chip ledger, checks the finalists and the duel, and verifies the settlement
   arithmetic. The browser runs the same verifier on the result screen.
5. **Settlement is shielded.** Entry uses a fresh shielded address and a table-bound memo;
   payouts use `z_sendmany` to the winner's unified address. No transparent settlement
   addresses.
6. **The threat model is honest.** `docs/THREAT-MODEL.md` states exactly what the server
   sees (played cards, offers, metadata, full hands once the relevant phase closes), what
   it does not see (unplayed cards during play), and what remains trusted (custodial
   bankroll, availability, the browser).

## Execution

- 43 engine, rule, bankroll, test-wallet ledger, pacing, privacy-gate, and audit-tamper tests (`npm test`).
- A headless protocol test that plays a full human-vs-three-bots voyage and verifies the
  audit client-side (`npm run e2e`).
- A headless Chrome test that walks the real UI from landing to settlement, checks the
  audit verdict, and captures screenshots (`npm run ui`).
- A dialog and lobby browser test that covers the rules sheet, leave confirmation, loan
  note, private lobby, focus handling, and mobile bottom sheets (`npm run ui:modals`).
- A staked end-to-end test against the Docker regtest stack that pays a shielded fare,
  plays the voyage, verifies the audit, and checks the shielded payout when the human wins
  (`npm run stack`).
- A self-contained Docker stack: zebra regtest, a self-initializing zecd funder restored
  from the public BIP-39 test vector, a one-shot bootstrap that shields the coinbase, and
  the game/SPA image.

## Originality

Most Zcash hackathon entries are payment flows or wallets. THE DERELICT uses shielded
transactions where they are actually load-bearing — entry and payout — and adds a second,
independent privacy layer inside the game itself. The result is a game whose core mechanic
(secret simultaneous choice) is enforced by commitments rather than by trusting the
dealer, with a post-match audit that makes the enforcement checkable.

## Honest limitations (also in the README and threat model)

- Hand composition is checked at audit time, not prevented live. The server cannot reject
  an invalid hand without learning the cards.
- The house knows its own bots' hands. Only human unplayed cards are hidden during play.
- Offers are server-readable; they are private from other players, not the operator.
- The bankroll is custodial; the audit covers the game ledger, not whether a payout
  transaction actually confirmed.
- The client is trusted; a compromised browser can leak its hand.
- Regtest demos have no economic value, and the demo funding path is regtest-only.

## How to judge it in five minutes

1. `cp .env.example .env && docker compose up --build -d`
2. Open http://127.0.0.1:8791.
3. Take a **practice** seat and play a free voyage. Watch the hand fan: the cards are
   generated in the browser; the network panel shows only roots and proofs.
4. Or take a **staked** seat. Create a **PROFILE → TEST WALLET**, request test ZEC, and
   **PAY THE FARE FROM TEST WALLET**; the fare becomes the chip bankroll, and a winning
   back room pays the matched pot back to the test ledger. The regtest
   **LET THE HOUSE COVER THE FARE** button does the same without the wallet.
5. On the result screen, read **THE AUDIT** and press **DOWNLOAD AUDIT JSON**.
6. Verify it independently: `node scripts/verify-audit.mjs <audit.json>`.

For a fast demo, set `PHASE_SCALE=0.1` in `.env` before starting the stack.

## License and attribution

MIT. The game code, text, and CSS are original and were written during the Zecathon build
window. The regtest stack vendors a `zecd` 0.8.2 release binary for the funder wallet; its
checksum is recorded in `docker/zecd/README.md`.
