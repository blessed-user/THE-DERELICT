# GitHub publishing notes

Ready-to-paste metadata for the repository page.

## Repository name

```
the-derelict
```

## About (short description)

```
A survival gambling game where the table cannot read your hand — and the money moves in shielded ZEC. Browsers commit salted Merkle roots, every play carries an inclusion proof, and a public post-match audit replays the whole table. Zecathon 2026 Wildcard · MIT.
```

Character count: 262. GitHub's limit is 350.

## Tagline

```
Server-blind cards. Shielded settlement. A table you can audit after the lights go out.
```

## Topics

```
zcash
zecathon
privacy
game
merkle-tree
commitment-scheme
rock-paper-scissors
react
vite
nodejs
websockets
regtest
cryptography
audit
```

## What is in the repository

- `shared/` — rules, commitments, E-Card logic, standalone audit verifier.
- `server/` — game engine, HTTP/WebSocket front door, zecd/Zebra adapter.
- `web/` — React SPA, browser-side hand generation, audit panel, original card art.
- `e2e/` — protocol, browser, dialog, and staked-regtest tests.
- `docs/` — protocol, threat model, deployment, submission notes, screenshots.
- `docker/zecd/` — self-initializing regtest funder image and pinned zecd binary.
- `compose.yml` — the one-command Zebra + zecd + game stack.
- `vercel.json`, `railway.json`, `.nvmrc` — optional split deployment metadata.

## What is deliberately not in the repository

- `.env` and every `.env.*` file except `.env.example` and `web/.env.example`.
  The example files contain only the **public BIP-39 spec test vector**
  (`abandon … art`). Never replace it with a real seed in a committed file.
- `data/`, `data-e2e/`, `data-ui/`, and `*.db` — local tables, wallets, and ledgers.
- `web/dist/`, `node_modules/` — build output and dependencies.
- `e2e/*.png`, `e2e/*.log`, `e2e/audit.json`, `e2e/staked-audit.json` — generated
  screenshots and audit dumps. The curated screenshots in `docs/` are tracked.
- `.vercel/` — local deployment metadata.

Before the first commit:

```bash
git init
git add .
git status --short
git status --ignored --short | head
```

Check that `.env` is not staged and that `data/` is ignored. A quick scan for accidental
secrets:

```bash
git grep -nEI '(ZECD_MNEMONIC|PRIVATE_KEY|SECRET|API_KEY)=' -- ':!*.example' || true
```

The only demo credential in the tree is the regtest funder password
`regtest-funder-pw` in `compose.yml` and the regtest RPC configuration. It is not a
mainnet credential.

## The vendored zecd binary

`docker/zecd/zecd` is an 88 MB Linux x86-64 release binary. It is below GitHub's 100 MB
per-file hard limit but above the 50 MB warning threshold. It is kept in the repository on
purpose: the `docker compose up --build` demo has to work on a fresh clone without a
network fetch, and the exact 0.8.2 build is pinned by SHA-256 in
`docker/zecd/README.md`.

Options if repository size becomes a problem:

- Keep it as-is. One clone pays the 88 MB once; the root `.dockerignore` already excludes
  `docker/` from the game image build, so Docker builds do not resend it.
- Move it to a GitHub Release asset and add a fetch-and-verify step to the funder image.
- Track it with Git LFS (`git lfs track 'docker/zecd/zecd'`), at the cost of requiring
  Git LFS on every clone.

Do not delete it without also changing the funder Dockerfile and the README's
one-command promise.

## Screenshots

Tracked in `docs/` and referenced from the README:

- `docs/screenshot-landing.png` — the landing screen and the three table modes.
- `docs/screenshot-hold.png` — Act I, side deals and the sealed table.
- `docs/screenshot-duel.png` — the back-room E-Card duel and the card art.

## Suggested first release

Tag `v1.0.0` after the Zecathon submission is frozen.

Release title:

```
THE DERELICT v1.0.0 — Zecathon 2026 Wildcard
```

Release notes:

```markdown
A complete, playable Zecathon Wildcard entry.

- Two-act Kaiji-inspired survival gambling game for four seats.
- Server-blind hands: browser-generated salted Merkle commitments, per-play
  commitments and inclusion proofs, post-match public audit.
- Act I hold with trades, loans, dealer operations, and elimination.
- Asymmetric CROWN vs REBEL hidden E-Card duel with sealed card-and-bet rounds.
- Shielded ZEC entry and payout on a self-contained regtest stack.
- One-command demo: `cp .env.example .env && docker compose up --build -d`.
- MIT licensed. Original code, text, CSS, and SVG card art.
```

## License and attribution

MIT. The game code, prose, CSS, and card art are original. THE DERELICT is inspired by
the pressure of *Kaiji: The Ultimate Gambler*; it uses no Kaiji names, characters, art, or
catchphrases. The vendored zecd 0.8.2 binary is third-party software and is not part of
the MIT-licensed game code; see `docker/zecd/README.md`.
