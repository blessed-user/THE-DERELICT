# THE DERELICT — threat model

## Scope

This document covers what the game does and does not protect, who can see what, and where
trust is required. It is deliberately narrower than a marketing claim. If a sentence here
conflicts with the README, this document wins.

## Assets

1. **Unplayed cards.** The cards a player holds but has not committed as a play. Leaking
   them lets an opponent or the dealer predict the next move.
2. **Sealed bets.** The duel bet, which must not be visible before both sides commit.
3. **Private offers.** Side-deal terms between two seats.
4. **Linkability.** The connection between a player, a seat, a table, and an on-chain
   deposit or payout.
5. **Money.** The staked fare and the payout.

## Actors

- **Other players** — receive snapshots for their own seat only; they see public table
  state, revealed cards, and public chip/star counts.
- **The server operator / dealer** — runs the game, relays offers, resolves rounds, holds
  the house bankroll, and sees every action as it arrives.
- **A network observer** — sees HTTP/WebSocket traffic and the Zcash chain.
- **The host / browser** — executes the client code that holds the hand.
- **Zcash chain observers** — see shielded transactions but not their contents.

## Guarantees

| Property | Guarantee | Mechanism |
|---|---|---|
| Unplayed Act I cards | Not sent to the server during play | Hand generated in the browser; only a Merkle root is committed |
| A played card is in the committed hand | Yes | Leaf salt + inclusion proof verified against the root |
| A card cannot be replayed inside a hand | Yes | Per-seat leaf-index uniqueness |
| Card substitution after commit | Impossible without breaking the root | Play commitment binds card + play salt; reveal must match |
| Sealed duel bet | Hidden until reveal | Bet is inside the play commitment; reveal supplies it |
| Duel hand composition | Audited | One SPECIAL + four CITIZENS checked by the verifier |
| Private offers vs. other players | Hidden | Per-seat snapshots; only sender/recipient receive the offer |
| On-chain entry/payout | Shielded | Fresh shielded address per table, shielded `z_sendmany` payout |
| Table self-dealing | Payout address cannot belong to the house wallet | `z_validateaddress` check at table creation |
| Post-match consistency | Independently verifiable | `shared/audit.js` rebuilds roots and replays the ledger |

## Trust assumptions and leaks

### The server sees played cards

The dealer must know the revealed card to resolve a round. It also sees the play
commitment before the reveal, but a commitment reveals nothing about the card without the
salt. What it does **not** see is the rest of the hand during play.

### Hands are published only after the phase they belong to

The audit requires every card and salt. Act I hands are revealed only once Act I has
closed; duel hands only after the voyage has settled. The server refuses a `hand_reveal`
while the hand can still be played, so a client cannot publish its own live hand through
the public audit endpoint. This is a deliberate privacy/verifiability trade-off: the hand
is private while it matters and public afterward. Anyone who records the audit can link a
seat's full strategy to that table. Do not reuse a hand across tables; the commitment binds
the table id.

### Composition cheating is detected late

A hand that is not 2×/2×/2× (or not 1 SPECIAL + 4 CITIZENS) is only detectable when the
hand is revealed at the end. The server cannot reject it at commit time without learning
the cards. The audit marks it; the game does not stop it live. This is a known limitation,
not an oversight.

### The house knows its own seats

Bots' hands are generated server-side, so the operator knows them. House seats are
opponents run by the dealer. A malicious operator could use that knowledge. The claim that
"the dealer is blind" applies to **human** hands, not to the house's own cards.

### Offers are server-readable

Offers are relayed in plaintext inside the server's memory and WebSocket frames. They are
hidden from other players, not from the operator. There is no end-to-end encryption layer.

### Metadata

The server sees IP addresses, connection timing, table ids, seat counts, stake size, and
the deposit/payout addresses it creates or receives. The chain sees shielded transactions.
Neither is mixed, delayed, or routed through Tor. A global passive adversary that can
correlate network traffic with chain traffic may link a player to a deposit or payout.

The payout address is kept in the live table only until the shielded send is issued; after
settlement the durable database row is cleared of the table-to-UA link. The chain itself
still records the shielded transfer and its memo, so this reduces stored linkage, not
on-chain linkage.

### The test wallet is house-custodied

`PROFILE → TEST WALLET` creates a shielded address inside the house zecd wallet and stores
a bearer token in the browser's localStorage. The house holds the key, can see the balance,
and could spend the funds. It exists only to exercise entry and payout on the private
regtest chain: it has no value, must never receive mainnet funds, and is **not** a private
wallet. A house-held SQLite ledger records faucet credits, fare debits and winning payouts;
that ledger — not the address's on-chain note — is the spendable test balance. The faucet
is regtest-only, rate-limited per wallet and per IP.

### The browser is trusted

The hand lives in the browser's memory and localStorage. A compromised device, a malicious
extension, or a tampered build can read it. The protocol protects against the server and
other players, not against a hostile client.

### Money is custodial

The house bankroll is the counterparty. There is no escrow contract, no multisig, and no
on-chain enforcement of the bankroll payout. The settlement arithmetic is audited; whether
the transaction actually happened must be checked on-chain. The regtest demo is play money
on a private chain and has no value.

### Availability and DoS

A player who disconnects is treated as a forfeit at the phase deadline. Empty chairs at
muster are taken by the house, but a seat that is still connected — and always the host's
own seat — is never silently converted to a bot; the muster holds until that hand is
sealed. The server can still drop a table, refuse a payout, or go offline. There is no
liveness guarantee.

### Regtest-specific behavior

- The demo chain has no economic value, no real miners, and a public test-vector seed.
- `POST /api/tables/:id/demo-fund` is available only when `CHAIN_MODE=regtest`.
- The test wallet and faucet are available only on regtest and are house-custodied.
- `PHASE_SCALE` compresses clocks for demos; it changes timing, not rules.
- Auto-mining exists only to confirm regtest transactions quickly.

## Out of scope

- Anonymity against a global network adversary.
- Censorship resistance.
- Protection from collusion between players.
- Hiding table metadata from the operator.
- A trustless or non-custodial settlement design.
- Mobile wallets or browser-side Zcash light-client verification.
- Free-text chat moderation (the game has no free-text chat).
