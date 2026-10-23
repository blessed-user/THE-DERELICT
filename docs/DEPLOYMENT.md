# Deploying THE DERELICT

There are two supported shapes:

1. **One origin** — the game server serves the built SPA itself. This is the Docker
   Compose demo and the recommended judge path. Nothing below is required.
2. **Split origin** — the static SPA on Vercel and the Node/WebSocket game server on
   Railway. Use this when you want a public URL without running an always-on VM.

The split is real: the client reads `VITE_API_BASE`, prefixes every `/api` request with
it, and derives the WebSocket URL from the same origin unless `VITE_WS_BASE` is set. The
server accepts the front end's origin through `APP_ORIGIN` for both HTTP and the WebSocket
upgrade.

## Launch and redeploy from GitHub

`.railway/railway.ts` defines the four Railway services, their Dockerfiles, regions, and
persistent volumes. The services track `main` in `blessed-user/THE-DERELICT`; after the
initial setup, Railway rebuilds them when GitHub receives a push to that branch. Changes
to the Railway infrastructure file are previewed on pull requests and applied after a
pull request is merged by `.github/workflows/railway-config.yml`.

One-time setup:

1. Give Railway's GitHub App access to `blessed-user/THE-DERELICT`.
2. Create or select the Railway project and its `production` environment in region
   `iad`, then link this checkout with `railway link`.
3. Run `railway config plan` and review the proposed changes. This configuration manages
   the existing services and volumes, so do not apply a plan that proposes deleting a
   resource you want to keep.
4. Apply the reviewed plan with `railway config apply`. The services will use this
   repository's `main` branch.
5. Create a Railway project token scoped to the production environment and add it to the
   GitHub repository as the `RAILWAY_TOKEN` Actions secret.
6. Configure the service variables in the sections below. They are deliberately not
   stored in IaC; in particular, keep `ZECD_MNEMONIC` in Railway and use only the
   published demo regtest seed, never a personal wallet seed.

The checked-in workflow plans configuration changes for same-repository pull requests
and applies them after merge. It does not expose the Railway token to fork pull requests.
Ordinary code pushes are deployed by Railway's GitHub source integration; they do not
need a separate GitHub Actions deploy token.

## What can run where

| Piece | Vercel | Railway |
| --- | --- | --- |
| React/Vite SPA (`web/dist`) | yes | yes |
| Node game server + WebSockets | no | yes |
| SQLite table store (`DATA_DIR`) | no | yes, with a volume |
| Zebra + zecd + bootstrap (staked regtest) | no | possible, but four services and volumes |

Vercel serves static files and serverless functions; it cannot hold the long-lived
in-memory tables or the WebSocket connections the game needs. It also cannot host Zebra or
the funder wallet. A Vercel deployment is therefore **practice and private-table only**
unless you point it at a Railway deployment that has the regtest stack.

## 1. Game backend on Railway

Create a Railway project from this repository and add a game service. The root
`Dockerfile` builds the game and SPA; `.nvmrc` pins Node 22. Railway injects `PORT`, and
the server binds `0.0.0.0`. Attach a persistent volume at `/data` and set `DATA_DIR=/data`.
Set the game service health check to `/api/health`.

For a free-practice deployment, set `CHAIN_MODE=off`. That setting is not suitable for
the on-chain judge demo: it disables staked tables and the test-wallet faucet.

## 2. Regtest services on Railway

The judge demo uses a private regtest chain, not Zcash mainnet or public testnet. Deploy
these four services in the same Railway project **environment** and keep the node RPCs
private. Railway services can reach one another through private DNS; the service names in
the URLs below must match the Railway service names exactly.

### Zebra

1. Add a service from this repository named `zebra`, with the repository root as its
   source directory.
2. Set `RAILWAY_DOCKERFILE_PATH=/docker/railway/Zebra.Dockerfile`.
3. Attach a persistent volume at `/var/cache/zebra`.
4. Do not create a public TCP proxy for port `18234`.

### Funder wallet

1. Add a service named `funder` from the same repository, with the repository root as its
   source directory.
2. Set `RAILWAY_DOCKERFILE_PATH=/docker/zecd/Dockerfile`.
3. Attach a persistent volume at `/var/lib/zecd`.
4. Set these variables:

   | Variable | Value |
   | --- | --- |
   | `ZECD_MNEMONIC` | The published demo-only regtest seed from the local `.env.example` |
   | `ZECD_BACKEND` | `zebra://zebra.railway.internal:18234` |
   | `ZEBRA_RPC` | `http://zebra.railway.internal:18234/` |

The funder image includes `regtest/zecd.toml`. Its entrypoint substitutes the
`ZECD_BACKEND` address so the wallet connects to Railway's private Zebra hostname. The
funder RPC on port `18242` must not be publicly exposed. Use only the published demo
seed; never use a personal or funded wallet seed.

### Bootstrap the chain once

1. Add a service named `bootstrap` from the same repository, with the repository root as
   its source directory.
2. Set `RAILWAY_DOCKERFILE_PATH=/docker/railway/Bootstrap.Dockerfile`.
3. Set these variables:

   | Variable | Value |
   | --- | --- |
   | `ZEBRA_URL` | `http://zebra.railway.internal:18234/` |
   | `FUNDER_URL` | `http://funder.railway.internal:18242/` |
   | `FUNDER_USER` | `funder` |
   | `FUNDER_PASS` | `regtest-funder-pw` |
   | `BRINGUP_BLOCKS` | `105` |

Wait for Zebra and the funder service to be running, then deploy/run `bootstrap`. It mines
the coinbase maturity blocks, shields the funds into the funder wallet, and exits after
verifying a spendable note. It is safe to rerun after a redeploy; it checks for an existing
shielded note before shielding again. Configure this service as a one-shot job or stop it
after a successful run.

### Enable staked regtest in the game service

Set these variables on the game service:

| Variable | Value |
| --- | --- |
| `DATA_DIR` | `/data` |
| `CHAIN_MODE` | `regtest` |
| `ZECD_URL` | `http://funder.railway.internal:18242/` |
| `ZECD_USER` | `funder` |
| `ZECD_PASS` | `regtest-funder-pw` |
| `ZEBRA_URL` | `http://zebra.railway.internal:18234/` |
| `AUTO_MINE` | `1` |
| `APP_ORIGIN` | Exact browser origin, e.g. `https://thezecathon.com` |
| `PHASE_SCALE` | `1` |

Deploy the game service after the bootstrap succeeds. Check
`https://<game-service>/api/health`; `chain` should report `enabled: true`, `mode:
"regtest"`, `staked: true`, and an `ok: true` health result with chain information. If it
reports `chain off`, `ZECD_URL` is missing or empty. If it reports an RPC error, check
that all services are in the same Railway environment, their service names match the
private DNS URLs, and the funder has finished starting.

For a Vercel frontend, set `VITE_API_BASE` to the Railway game service's public HTTPS
origin, set `APP_ORIGIN` to the exact Vercel/browser origin, and redeploy the frontend.
Do not point the browser directly at Zebra or the funder.

Regtest transactions are real transactions on this deployment's isolated chain. They
cannot be looked up in a public Zcash explorer or spent on mainnet. Keep the node RPCs
private and present the app's transaction IDs and audit alongside the demo.

## 3. Frontend on Vercel

1. Import the same repository into Vercel.
2. Keep the root directory at the repository root. `vercel.json` already sets:
   - install: `npm ci`
   - build: `npm run build`
   - output: `web/dist`
   - SPA rewrite to `/index.html`
   - basic security headers and a CSP
3. Add an environment variable (Production, and Preview if you use it):

   ```
   VITE_API_BASE=https://derelict-production.up.railway.app
   ```

   Optional, only if the WebSocket is on a different host:

   ```
   VITE_WS_BASE=wss://derelict-production.up.railway.app
   ```

   Both are **origins only** — no trailing slash and no `/api` suffix.
4. Redeploy after changing an environment variable. Vite inlines `VITE_*` values at build
   time, so an existing deployment will not pick them up automatically.
5. Open the Vercel URL and create a practice table. If the API is unreachable, the browser
   console will show a CORS or connection error.

The checked-in `vercel.json` CSP allows `connect-src 'self' https: wss:`. Tighten it to
your specific backend origin if you want a stricter public deployment.

## 4. Origin and CORS rules

- `APP_ORIGIN` is an exact-origin allow-list. Comma-separated values are accepted:
  `APP_ORIGIN=https://game.example,https://game-git-preview.example`.
- The server echoes only the origin that matched; it never sends the raw list as a header.
- Same-origin requests and loopback-to-loopback development are always allowed.
- With `APP_ORIGIN` unset, a browser page on another public origin cannot call the API or
  open the socket. Curl and same-origin requests still work.
- Vercel preview deployments get a new origin per deployment. Add that origin to
  `APP_ORIGIN` if you need to test a preview against the shared backend.

## 5. Storage and limits

- `DATA_DIR` holds `derelict.db`. Use a persistent volume on Railway.
- `MAX_TABLES` (default 500) and `TABLE_TTL_MS` (default 6 hours) bound memory and disk.
- Settled and cancelled tables are dropped after 30 minutes with no connected sockets;
  abandoned tables expire after `TABLE_TTL_MS`.
- The server keeps all active tables in memory. A restart ends open voyages. This is a
  demo server, not a durable tournament service.

## 6. Smoke test

```bash
curl -s https://<railway-host>/api/health
# {"ok":true,"game":"the-derelict",...}

curl -s -H 'Origin: https://<vercel-host>' \
  https://<railway-host>/api/config
# the response should include access-control-allow-origin: https://<vercel-host>
```

Then open the Vercel URL, take a practice seat, play a voyage, and check that the result
screen's audit passes. The network panel should show calls to the Railway host, not to
the Vercel host.
