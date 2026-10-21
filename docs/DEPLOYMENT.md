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

## 1. Backend on Railway

1. Create a Railway project from this repository.
2. Add a service. `railway.json` asks Nixpacks for `npm ci --omit=dev` and starts
   `npm start` (`node server/index.mjs`); `.nvmrc` pins Node 22.
3. Set these service variables:

   | Variable | Value |
   | --- | --- |
   | `DATA_DIR` | `/data` |
   | `CHAIN_MODE` | `off` |
   | `APP_ORIGIN` | `https://<your-frontend>.vercel.app` |
   | `PHASE_SCALE` | `1` (use `0.1` only for automated demos) |

   Railway injects `PORT`; the server binds `0.0.0.0` by default. If you prefer a
   different bind address, set `HOST`.
4. Attach a volume mounted at `/data`. Without it, tables and test-wallet ledgers vanish
   on every redeploy.
5. Set the health check to `/api/health` (already in `railway.json`).
6. Copy the public service URL, for example
   `https://derelict-production.up.railway.app`.

`CHAIN_MODE=off` is deliberate. It disables staked tables and the regtest faucet, and the
game runs with free practice money. Do not put a real Zcash seed in a hosted environment.

### Running the full staked stack on Railway

The local `compose.yml` is the supported staked path. A Railway version would need:

- a Zebra service with a persistent volume and a private RPC URL;
- the `docker/zecd` funder image with a persistent `/var/lib/zecd` volume;
- the one-shot bootstrap job (`e2e/bootstrap.mjs`) to mine and shield the coinbase;
- the game service with `CHAIN_MODE=regtest`, `ZECD_URL`, `ZEBRA_URL`, `AUTO_MINE=1`,
  and the same funder credentials.

That is a demo-only regtest chain, not mainnet. It is more moving parts than the free
deployment needs, and judges can run the whole thing locally with one command. Leave it
out of the public split deployment unless you specifically need staked demos over the
internet.

## 2. Frontend on Vercel

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

## 3. Origin and CORS rules

- `APP_ORIGIN` is an exact-origin allow-list. Comma-separated values are accepted:
  `APP_ORIGIN=https://game.example,https://game-git-preview.example`.
- The server echoes only the origin that matched; it never sends the raw list as a header.
- Same-origin requests and loopback-to-loopback development are always allowed.
- With `APP_ORIGIN` unset, a browser page on another public origin cannot call the API or
  open the socket. Curl and same-origin requests still work.
- Vercel preview deployments get a new origin per deployment. Add that origin to
  `APP_ORIGIN` if you need to test a preview against the shared backend.

## 4. Storage and limits

- `DATA_DIR` holds `derelict.db`. Use a persistent volume on Railway.
- `MAX_TABLES` (default 500) and `TABLE_TTL_MS` (default 6 hours) bound memory and disk.
- Settled and cancelled tables are dropped after 30 minutes with no connected sockets;
  abandoned tables expire after `TABLE_TTL_MS`.
- The server keeps all active tables in memory. A restart ends open voyages. This is a
  demo server, not a durable tournament service.

## 5. Smoke test

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
