// THE DERELICT — HTTP + WebSocket front door.
//
// The server's job is small: hand out seats, relay sanitized snapshots, and
// settle the one thing that is not a game token — the shielded fare. Hands,
// bets and private offers are never broadcast; each socket gets a view built
// for its own seat.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Table, labelForSeat } from './game.mjs';
import { Chain } from './chain.mjs';
import { Store } from './store.mjs';
import {
  MODES, MIN_STAKE_ZATS, MAX_STAKE_ZATS, START_CHIPS, ECARD_START_CHIPS,
  PHASE_MS, SEATS, GAME_NAME,
} from '../shared/constants.js';
import { randomHex } from '../shared/crypto.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_DIST = join(ROOT, 'web', 'dist');
const PORT = Number(process.env.PORT ?? 8791);
const HOST = process.env.HOST ?? '0.0.0.0';
const PHASE_SCALE = Number(process.env.PHASE_SCALE ?? 1);
const MAX_TABLES = Number(process.env.MAX_TABLES ?? 500);
const TABLE_TTL_MS = Number(process.env.TABLE_TTL_MS ?? 6 * 60 * 60_000);
// A split deployment needs the static front end's origin here, for example
// APP_ORIGIN=https://the-derelict.vercel.app. Comma-separated origins are
// allowed; the response echoes only the origin that matched.
const APP_ORIGINS = (process.env.APP_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const store = new Store(process.env.DATA_DIR ?? join(ROOT, 'data'));
const chain = new Chain({
  mode: process.env.CHAIN_MODE ?? 'off',
  zecdUrl: process.env.ZECD_URL ?? '',
  zecdUser: process.env.ZECD_USER ?? '',
  zecdPass: process.env.ZECD_PASS ?? '',
  zebraUrl: process.env.ZEBRA_URL ?? '',
  autoMine: process.env.AUTO_MINE === '1',
});

const tables = new Map();   // tableId -> { table, sockets:Set, watcher, cleanupAt }
const codes = new Map();    // upper-case code -> tableId
const walletCreateByIp = new Map();
const TEST_WALLET_FAUCET_ZATS = 20_000_000;   // 0.20 regtest ZEC: covers the max fare
const TEST_WALLET_FAUCET_COOLDOWN_MS = 60_000;
const TEST_WALLET_MAX = 500;

// ------------------------------------------------------------------ helpers

const now = () => Date.now();
const json = (res, status, body, extra = {}) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    ...corsHeaders(res),
    ...extra,
  });
  res.end(data);
};

function corsHeaders(res) {
  const headers = {
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  // Do not hand every origin a CORS grant by default. Same-origin requests do
  // not need the header; a split front end opts in with APP_ORIGIN. Echo the
  // one origin that matched: a comma-separated list is not a valid header
  // value, and reflecting the whole list breaks the second entry.
  if (res?.corsOrigin) {
    headers['access-control-allow-origin'] = res.corsOrigin;
    headers.vary = 'Origin';
  }
  return headers;
}

function allowedCorsOrigin(req) {
  const origin = req?.headers?.origin;
  return origin && APP_ORIGINS.includes(origin) ? origin : null;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / same-origin navigations
  if (APP_ORIGINS.includes(origin)) return true;
  try {
    const originUrl = new URL(origin);
    const hostUrl = new URL(`http://${req.headers.host ?? 'localhost'}`);
    if (originUrl.host === hostUrl.host) return true;
    // Local development: Vite proxies to 127.0.0.1 while the page is served
    // from localhost:5173. Loopback-to-loopback is allowed; public hosts are not.
    const loopback = (host) => host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return loopback(originUrl.hostname) && loopback(hostUrl.hostname);
  } catch {
    return false;
  }
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('invalid json'); }
}

function playerId(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(v) ? v : null;
}

function uniqueCode() {
  for (let i = 0; i < 20; i++) {
    const code = randomHex(3).toUpperCase();
    if (!codes.has(code)) return code;
  }
  return randomHex(4).toUpperCase();
}

function testWalletFrom(body) {
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  return store.testWallet(token);
}

function mayCreateTestWallet(req) {
  const ip = req.socket.remoteAddress ?? 'unknown';
  const t = now();
  const recent = (walletCreateByIp.get(ip) ?? []).filter((at) => t - at < 10 * 60_000);
  if (recent.length >= 5) {
    walletCreateByIp.set(ip, recent);
    return false;
  }
  recent.push(t);
  walletCreateByIp.set(ip, recent);
  return true;
}

function send(ws, obj) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* socket went away */ }
}

function snapshot(entry, ws) {
  try {
    send(ws, { type: 'state', state: entry.table.snapshotFor(ws.seat) });
  } catch { /* table may be mid-transition */ }
}

function broadcast(entry) {
  if (!entry) return;
  for (const ws of entry.sockets) {
    if (entry.table.disposed) { try { ws.close(1001, 'voyage over'); } catch {} continue; }
    snapshot(entry, ws);
  }
}

function auditView(table) {
  return table.audit ?? store.audit(table.id);
}

// ------------------------------------------------------------------ tables

async function onSettle(table) {
  try { store.recordSettlement(table); } catch (error) { console.error('[store]', error.message); }
  // The payout address is held in the live table until the shielded send is
  // issued; the durable DB does not need the table-to-UA link.
  try { store.clearPayoutAddress(table.id); } catch { /* best effort */ }
  const settlement = table.settlement;
  if (!settlement?.payoutZats || table._payoutStarted) return;
  table._payoutStarted = true;
  try {
    const txid = await chain.payout({
      to: settlement.winnerUa,
      zats: settlement.payoutZats,
      tableId: table.id,
    });
    // A test wallet is a house-custodied ledger entry attached to one of our
    // shielded addresses. If the winner used one, mirror the confirmed payout
    // into that ledger so the next staked run can draw on it.
    try {
      const winnerWallet = store.testWalletByAddress(settlement.winnerUa);
      if (winnerWallet) {
        store.creditTestWallet(winnerWallet.token, settlement.payoutZats);
        settlement.walletCredited = true;
      }
    } catch (error) {
      console.error('[test-wallet] payout credit failed:', error.message);
    }
    table.setPayout(txid);
    console.log(`[payout] ${table.id} ${settlement.payoutZats} zats -> ${txid}`);
  } catch (error) {
    table.setPayout(null, error.message);
    console.error(`[payout] ${table.id} failed: ${error.message}`);
  }
  try { store.recordSettlement(table); } catch { /* best effort */ }
}

function makeTable({ mode, stakeZats = 0, playerIdValue = null, ua = null, handle = null, walletToken = null }) {
  if (tables.size >= MAX_TABLES) throw new Error('the harbour is full');
  const code = uniqueCode();
  const table = new Table({
    mode,
    code,
    stakeZats,
    phaseScale: PHASE_SCALE,
    onChange: () => broadcast(tables.get(table.id)),
    onSettle: (t) => onSettle(t),
  });
  table.testWalletToken = walletToken;
  const token = randomHex(24);
  const seat = table.addSeat({ playerId: playerIdValue, handle, token, ua });
  const entry = { table, sockets: new Set(), watcher: null, cleanupAt: null };
  tables.set(table.id, entry);
  codes.set(table.code, table.id);
  return { entry, table, seat, token };
}

async function createTable(body, res) {
  const mode = body.mode;
  if (!Object.values(MODES).includes(mode)) return json(res, 400, { ok: false, error: 'unknown mode' });
  const pid = playerId(body.playerId);
  if (body.playerId && !pid) return json(res, 400, { ok: false, error: 'bad player id' });

  let stakeZats = 0;
  let ua = null;
  let wallet = null;
  if (mode === 'solo') {
    if (!chain.stakedEnabled) return json(res, 503, { ok: false, error: 'the chain is not configured for staked runs' });
    stakeZats = Number(body.stakeZats);
    if (!Number.isInteger(stakeZats) || stakeZats < MIN_STAKE_ZATS || stakeZats > MAX_STAKE_ZATS) {
      return json(res, 400, { ok: false, error: `stake must be between ${MIN_STAKE_ZATS} and ${MAX_STAKE_ZATS} zats` });
    }
    const walletToken = typeof body.walletToken === 'string' ? body.walletToken.trim() : '';
    if (walletToken) {
      if (!/^[0-9a-f]{48}$/.test(walletToken)) {
        return json(res, 400, { ok: false, error: 'bad test wallet token' });
      }
      wallet = store.testWallet(walletToken);
      if (!wallet) return json(res, 401, { ok: false, error: 'unknown test wallet' });
      ua = wallet.address;
    } else {
      ua = typeof body.ua === 'string' ? body.ua.trim() : '';
    }
    const valid = await chain.validateAddress(ua);
    if (!valid.ok) return json(res, 400, { ok: false, error: 'a valid shielded payout address is required' });
    // A test wallet is one of the house's own shielded addresses. It is the
    // only case where paying the house's own wallet is intended.
    if (valid.mine && !wallet) return json(res, 400, { ok: false, error: 'the payout address belongs to the house wallet' });
  }

  let made;
  try {
    made = makeTable({ mode, stakeZats, playerIdValue: pid, ua, walletToken: wallet?.token ?? null });
  } catch (error) {
    return json(res, 503, { ok: false, error: error.message });
  }
  const { entry, table, seat, token } = made;

  if (mode === 'solo') {
    try {
      const deposit = await chain.createDeposit({ tableId: table.id, seat: seat.seat, zats: stakeZats });
      table.deposit = deposit;
      table.status = 'awaiting_deposit';
      table.phase = 'awaiting_deposit';
      store.recordEntry(table);
      startDepositWatcher(entry);
      console.log(`[deposit] ${table.id} seat ${seat.seat} ${deposit.zec} ZEC`);
    } catch (error) {
      table.dispose();
      tables.delete(table.id);
      codes.delete(table.code);
      return json(res, 502, { ok: false, error: `could not open a deposit address: ${error.message}` });
    }
  }

  if (mode === 'practice') {
    const started = await table.start();
    if (!started.ok) return json(res, 500, { ok: false, error: started.error });
  }

  broadcast(entry);
  return json(res, 201, {
    ok: true,
    tableId: table.id,
    code: table.code,
    seat: seat.seat,
    token,
    mode: table.mode,
    status: table.status,
    ws: `/ws?table=${table.id}&token=${token}`,
    deposit: table.deposit ? publicDeposit(table.deposit) : null,
    walletPay: Boolean(wallet),
    walletBalanceZats: wallet ? Number(wallet.balance_zats ?? 0) : null,
  });
}

function publicDeposit(deposit) {
  return {
    address: deposit.address,
    memo: deposit.memo,
    zats: deposit.zats,
    zec: deposit.zec,
    expiresAt: deposit.expiresAt,
    status: deposit.status ?? 'awaiting',
  };
}

function startDepositWatcher(entry) {
  const { table } = entry;
  if (!table.deposit || entry.watcher) return;
  const tick = async () => {
    if (table.disposed || table.status !== 'awaiting_deposit') {
      clearInterval(entry.watcher);
      entry.watcher = null;
      return;
    }
    if (now() > table.deposit.expiresAt) {
      table.status = 'cancelled';
      table.phase = 'cancelled';
      table.log('intercom', 'THE FARE NEVER CLEARED. THE GANGWAY CLOSES.');
      clearInterval(entry.watcher);
      entry.watcher = null;
      broadcast(entry);
      return;
    }
    try {
      const found = await chain.findDeposit({
        memo: table.deposit.memo,
        since: table.deposit.createdAt,
        zats: table.deposit.zats,
        minConf: 0,
      });
      if (!found) return;
      if (found.confirmations < 1) {
        if (chain.autoMine) { try { await chain.mine(1); } catch { /* wait for the node */ } }
        return;
      }
      table.deposit.status = 'paid';
      table.confirmEntry({ txid: found.txid, zats: found.zats, ua: table.seats[0]?.ua });
      store.recordEntry(table);
      broadcast(entry);
      clearInterval(entry.watcher);
      entry.watcher = null;
      console.log(`[deposit] ${table.id} confirmed ${found.zats} zats ${found.txid}`);
    } catch (error) {
      table.deposit.lastError = error.message;
    }
  };
  entry.watcher = setInterval(tick, 4_000);
  tick();
}

async function joinTable(tableId, body, res) {
  const entry = tables.get(tableId);
  if (!entry) return json(res, 404, { ok: false, error: 'no such table' });
  const { table } = entry;
  if (table.status !== 'lobby') return json(res, 409, { ok: false, error: 'the table has already cast off' });
  if (table.seats.length >= SEATS) return json(res, 409, { ok: false, error: 'the table is full' });
  const code = String(body.code ?? '').trim().toUpperCase();
  if (code !== table.code) return json(res, 403, { ok: false, error: 'wrong code' });
  const pid = playerId(body.playerId);
  if (body.playerId && !pid) return json(res, 400, { ok: false, error: 'bad player id' });
  if (pid && table.seats.some((s) => s.playerId === pid)) {
    return json(res, 409, { ok: false, error: 'this passenger already has a seat' });
  }
  const token = randomHex(24);
  const seat = table.addSeat({ playerId: pid, token });
  broadcast(entry);
  return json(res, 201, {
    ok: true,
    tableId: table.id,
    code: table.code,
    seat: seat.seat,
    token,
    mode: table.mode,
    status: table.status,
    ws: `/ws?table=${table.id}&token=${token}`,
    deposit: null,
  });
}

// ------------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const started = now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  res.corsOrigin = allowedCorsOrigin(req);

  if (path.startsWith('/api/') && !originAllowed(req)) {
    return json(res, 403, { ok: false, error: 'origin not allowed' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(res));
    return res.end();
  }

  try {
    if (path === '/api/health' && req.method === 'GET') {
      const health = await chain.ready().catch((e) => ({ ok: false, reason: e.message }));
      return json(res, 200, {
        ok: true,
        game: GAME_NAME,
        uptime: Math.round(process.uptime()),
        tables: tables.size,
        sockets: [...tables.values()].reduce((n, e) => n + e.sockets.size, 0),
        chain: {
          enabled: chain.enabled,
          mode: chain.mode,
          staked: chain.stakedEnabled,
          faucet: chain.mode === 'regtest',
          autoMine: chain.autoMine,
          ...health,
        },
        build: process.env.BUILD_ID ?? null,
      });
    }

    if (path === '/api/config' && req.method === 'GET') {
      return json(res, 200, {
        game: GAME_NAME,
        version: 1,
        seats: SEATS,
        modes: Object.values(MODES),
        stake: {
          minZats: MIN_STAKE_ZATS,
          maxZats: MAX_STAKE_ZATS,
          startChips: START_CHIPS,
          duelStartChips: ECARD_START_CHIPS,
          bankroll: true,
        },
        chain: {
          enabled: chain.enabled,
          mode: chain.mode,
          staked: chain.stakedEnabled,
          faucet: chain.mode === 'regtest',
        },
        phases: PHASE_MS,
      });
    }

    if (path === '/api/test-wallet' && req.method === 'POST') {
      // Regtest-only convenience wallet. The key lives in the house zecd
      // wallet; this is an explicitly custodial test address, not a private
      // wallet. Never expose this path off regtest.
      if (chain.mode !== 'regtest') return json(res, 404, { ok: false, error: 'not found' });
      if (!mayCreateTestWallet(req)) return json(res, 429, { ok: false, error: 'too many test wallets from this address' });
      if (store.countTestWallets() >= TEST_WALLET_MAX) {
        return json(res, 503, { ok: false, error: 'the test wallet shelf is full' });
      }
      try {
        const address = await chain.newAddress();
        const token = randomHex(24);
        const createdAt = now();
        store.recordTestWallet({ token, address, createdAt });
        return json(res, 201, {
          ok: true,
          wallet: { token, address, createdAt, balanceZats: 0 },
          faucet: { zats: TEST_WALLET_FAUCET_ZATS, cooldownMs: TEST_WALLET_FAUCET_COOLDOWN_MS, enabled: true },
          custody: 'regtest-house',
        });
      } catch (error) {
        return json(res, 502, { ok: false, error: `could not create a test wallet: ${error.message}` });
      }
    }

    if (path === '/api/test-wallet/status' && req.method === 'POST') {
      if (chain.mode !== 'regtest') return json(res, 404, { ok: false, error: 'not found' });
      const body = await readJson(req);
      const wallet = testWalletFrom(body);
      if (!wallet) return json(res, 401, { ok: false, error: 'unknown test wallet' });
      try {
        // The test wallet is a house-custodied ledger. The address's on-chain
        // note is not the spendable balance: faucet credits and staked payouts
        // are recorded here, and staked fares are debited here.
        const balanceZats = Number(wallet.balance_zats ?? 0);
        return json(res, 200, {
          ok: true,
          wallet: {
            address: wallet.address,
            createdAt: Number(wallet.created_at),
            lastFaucetAt: Number(wallet.last_faucet_at),
            balanceZats,
          },
          faucet: {
            zats: TEST_WALLET_FAUCET_ZATS,
            cooldownMs: TEST_WALLET_FAUCET_COOLDOWN_MS,
            enabled: true,
            retryInMs: Math.max(0, Number(wallet.last_faucet_at) + TEST_WALLET_FAUCET_COOLDOWN_MS - now()),
          },
          custody: 'regtest-house',
        });
      } catch (error) {
        return json(res, 502, { ok: false, error: `could not read the test wallet: ${error.message}` });
      }
    }

    if (path === '/api/test-wallet/faucet' && req.method === 'POST') {
      if (chain.mode !== 'regtest') return json(res, 404, { ok: false, error: 'not found' });
      const body = await readJson(req);
      const wallet = testWalletFrom(body);
      if (!wallet) return json(res, 401, { ok: false, error: 'unknown test wallet' });
      const last = Number(wallet.last_faucet_at ?? 0);
      if (now() - last < TEST_WALLET_FAUCET_COOLDOWN_MS) {
        return json(res, 429, {
          ok: false,
          error: 'the test faucet remembers this wallet',
          retryInMs: TEST_WALLET_FAUCET_COOLDOWN_MS - (now() - last),
        });
      }
      try {
        const result = await chain.send({
          to: wallet.address,
          zats: TEST_WALLET_FAUCET_ZATS,
          memo: 'derelict-test-wallet',
        });
        store.touchTestWallet(wallet.token, now());
        store.creditTestWallet(wallet.token, TEST_WALLET_FAUCET_ZATS);
        if (chain.autoMine) { try { await chain.mine(1); } catch { /* the watcher can catch up */ } }
        const fresh = store.testWallet(wallet.token);
        return json(res, 200, {
          ok: true,
          txid: result.txid,
          zats: TEST_WALLET_FAUCET_ZATS,
          balanceZats: Number(fresh?.balance_zats ?? 0),
          cooldownMs: TEST_WALLET_FAUCET_COOLDOWN_MS,
        });
      } catch (error) {
        return json(res, 502, { ok: false, error: `the test faucet failed: ${error.message}` });
      }
    }

    if (path === '/api/test-wallet/pay' && req.method === 'POST') {
      if (chain.mode !== 'regtest') return json(res, 404, { ok: false, error: 'not found' });
      const body = await readJson(req);
      const wallet = testWalletFrom(body);
      if (!wallet) return json(res, 401, { ok: false, error: 'unknown test wallet' });
      const tableId = typeof body.tableId === 'string' ? body.tableId.trim() : '';
      if (!/^[0-9a-f]{24}$/.test(tableId)) return json(res, 400, { ok: false, error: 'bad table id' });
      const entry = tables.get(tableId);
      if (!entry) return json(res, 404, { ok: false, error: 'no such table' });
      const table = entry.table;
      if (table.mode !== 'solo' || table.testWalletToken !== wallet.token) {
        return json(res, 403, { ok: false, error: 'this test wallet did not open that table' });
      }
      if (table.status !== 'awaiting_deposit' || !table.deposit) {
        return json(res, 409, { ok: false, error: 'this fare is no longer waiting' });
      }
      if (table.deposit.walletPaid || table.deposit.demoFunded) {
        return json(res, 409, { ok: false, error: 'this fare is already paid' });
      }
      if (table.deposit.walletPaying) {
        return json(res, 409, { ok: false, error: 'this fare is already being sent' });
      }
      const zats = table.deposit.zats;
      table.deposit.walletPaying = true;
      if (!store.debitTestWallet(wallet.token, zats)) {
        table.deposit.walletPaying = false;
        return json(res, 402, {
          ok: false,
          error: 'the test wallet does not hold enough for this fare',
          balanceZats: Number(wallet.balance_zats ?? 0),
          zats,
        });
      }
      try {
        // The test wallet is house-custodied, so the house sends the shielded
        // fare; the ledger debit above is what makes it the player's money.
        const result = await chain.send({
          to: table.deposit.address,
          zats,
          memo: table.deposit.memo,
        });
        table.deposit.walletPaid = true;
        table.deposit.walletPaying = false;
        table.deposit.walletTxid = result.txid;
        broadcast(entry);
        if (chain.autoMine) { try { await chain.mine(1); } catch { /* watcher will retry */ } }
        const fresh = store.testWallet(wallet.token);
        return json(res, 200, {
          ok: true,
          txid: result.txid,
          zats,
          balanceZats: Number(fresh?.balance_zats ?? 0),
        });
      } catch (error) {
        store.creditTestWallet(wallet.token, zats);
        table.deposit.walletPaying = false;
        return json(res, 502, { ok: false, error: `the test wallet fare failed: ${error.message}` });
      }
    }

    if (path === '/api/tables' && req.method === 'POST') {
      const body = await readJson(req);
      return createTable(body, res);
    }

    const tableMatch = path.match(/^\/api\/tables\/([0-9a-f]{24})(\/audit)?$/);
    if (tableMatch && req.method === 'GET') {
      const tableId = tableMatch[1];
      const isAudit = Boolean(tableMatch[2]);
      const entry = tables.get(tableId);
      if (isAudit) {
        const audit = entry ? auditView(entry.table) : store.audit(tableId);
        if (!audit) return json(res, 404, { ok: false, error: 'no audit yet' });
        return json(res, 200, audit);
      }
      if (!entry) {
        const record = store.recent(100).find((r) => r.tableId === tableId);
        if (!record) return json(res, 404, { ok: false, error: 'no such table' });
        return json(res, 200, { ok: true, ...record, public: true });
      }
      const code = String(url.searchParams.get('code') ?? '').toUpperCase();
      const publicView = {
        ok: true,
        tableId: entry.table.id,
        mode: entry.table.mode,
        status: entry.table.status,
        seatsFilled: entry.table.seats.length,
        seats: SEATS,
        code: code === entry.table.code ? entry.table.code : undefined,
      };
      return json(res, 200, publicView);
    }

    const joinMatch = path.match(/^\/api\/tables\/([0-9a-f]{24})\/join$/);
    if (joinMatch && req.method === 'POST') {
      const body = await readJson(req);
      return joinTable(joinMatch[1], body, res);
    }

    if (path === '/api/leaderboard' && req.method === 'GET') {
      return json(res, 200, { ok: true, leaderboard: store.leaderboard(25), recent: store.recent(20) });
    }

    const demoFundMatch = path.match(/^\/api\/tables\/([0-9a-f]{24})\/demo-fund$/);
    if (demoFundMatch && req.method === 'POST') {
      // Regtest convenience: the house pays the fare from the demo faucet so a
      // judge can walk the shielded flow without an external wallet. The funds
      // still travel as a real shielded transaction with the table memo, and
      // the normal watcher confirms it. Never available off regtest.
      if (chain.mode !== 'regtest') return json(res, 404, { ok: false, error: 'not found' });
      const entry = tables.get(demoFundMatch[1]);
      if (!entry) return json(res, 404, { ok: false, error: 'no such table' });
      const table = entry.table;
      if (table.status !== 'awaiting_deposit' || !table.deposit) {
        return json(res, 409, { ok: false, error: 'this fare is no longer waiting' });
      }
      if (table.testWalletToken) {
        return json(res, 409, { ok: false, error: 'this fare is attached to a test wallet' });
      }
      if (table.deposit.demoFunded) {
        return json(res, 409, { ok: false, error: 'the house already covered this fare' });
      }
      if (table.deposit.walletPaid || table.deposit.walletPaying) {
        return json(res, 409, { ok: false, error: 'the test wallet is already paying this fare' });
      }
      table.deposit.demoFunded = true;
      try {
        const result = await chain.send({
          to: table.deposit.address,
          zats: table.deposit.zats,
          memo: table.deposit.memo,
        });
        if (chain.autoMine) { try { await chain.mine(1); } catch { /* watcher will retry */ } }
        return json(res, 200, { ok: true, txid: result.txid, zats: table.deposit.zats });
      } catch (error) {
        table.deposit.demoFunded = false;
        return json(res, 502, { ok: false, error: error.message });
      }
    }

    if (path.startsWith('/api/')) {
      return json(res, 404, { ok: false, error: 'not found' });
    }

    return serveStatic(req, res, path);
  } catch (error) {
    const status = error.message === 'body too large' ? 413 : 400;
    return json(res, status, { ok: false, error: error.message });
  } finally {
    if (process.env.HTTP_LOG === '1') {
      console.log(`${req.method} ${path} ${res.statusCode} ${now() - started}ms`);
    }
  }
});

// --------------------------------------------------------------- websocket

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  if (!originAllowed(req)) { socket.destroy(); return; }
  const tableId = url.searchParams.get('table') ?? '';
  const token = url.searchParams.get('token') ?? '';
  const entry = tables.get(tableId);
  const table = entry?.table;
  const seat = table?.seatByToken(token);
  if (!entry || !seat || seat.isBot || seat.seat < 0) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.tableId = tableId;
    ws.seat = seat.seat;
    ws.token = token;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  const entry = tables.get(ws.tableId);
  if (!entry) { ws.close(1011, 'table gone'); return; }
  const table = entry.table;
  const seat = table.seats[ws.seat];
  if (!seat) { ws.close(1011, 'seat gone'); return; }
  entry.sockets.add(ws);
  seat.connected = true;
  ws.windowStart = now();
  ws.actions = 0;
  send(ws, { type: 'hello', tableId: table.id, seat: ws.seat, code: table.code });
  snapshot(entry, ws);
  broadcast(entry);

  ws.on('message', async (raw) => {
    try {
      const t = now();
      if (t - ws.windowStart > 60_000) { ws.windowStart = t; ws.actions = 0; }
      ws.actions += 1;
      if (ws.actions > 240) { ws.close(1008, 'too many actions'); return; }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', error: 'invalid json' }); }
      if (msg.type === 'ping') return send(ws, { type: 'pong', t });
      if (msg.type === 'start') {
        if (ws.seat !== 0) return send(ws, { type: 'ack', ok: false, error: 'only the passenger who opened the table can cast off' });
        if (table.status !== 'lobby') return send(ws, { type: 'ack', ok: false, error: 'the table is already away' });
        const result = await table.start();
        return send(ws, { type: 'ack', action: 'start', ...result });
      }
      if (msg.type !== 'action') return send(ws, { type: 'error', error: 'unknown message' });
      if (table.disposed) return send(ws, { type: 'ack', ok: false, error: 'the table is gone' });
      const result = await table.action(ws.seat, msg.action, msg.payload ?? {});
      if (msg.action === 'hand_reveal' && result.ok) {
        try { store.updateAudit(table); } catch { /* best effort */ }
      }
      send(ws, { type: 'ack', action: msg.action, requestId: msg.requestId ?? null, ...result });
      broadcast(entry);
    } catch (error) {
      send(ws, { type: 'ack', ok: false, error: error.message });
    }
  });

  ws.on('close', () => {
    entry.sockets.delete(ws);
    if (!seat.isBot && entry.sockets.size === 0) {
      seat.connected = false;
      broadcast(entry);
    }
  });
  ws.on('error', () => {});
});

// ---------------------------------------------------------------- static UI

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    return json(res, 200, {
      ok: true,
      game: GAME_NAME,
      message: 'The UI is not built. Run `npm run dev` for Vite, or `npm run build`.',
    });
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return json(res, 400, { ok: false, error: 'bad path' }); }
  let file = normalize(join(WEB_DIST, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(WEB_DIST + sep) && file !== WEB_DIST) {
    return json(res, 403, { ok: false, error: 'forbidden' });
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(WEB_DIST, 'index.html');
  }
  try {
    let body = await readFile(file);
    if (extname(file) === '.html') {
      // A strict, self-contained policy: no third-party scripts, no frames.
      body = Buffer.from(body.toString('utf8'));
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=300',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
      ...corsHeaders(res),
    });
    if (req.method === 'HEAD') return res.end();
    res.end(body);
  } catch {
    return json(res, 404, { ok: false, error: 'not found' });
  }
}

// ------------------------------------------------------------------ upkeep

setInterval(() => {
  const t = now();
  for (const [id, entry] of tables) {
    if (entry.table.status === 'settled' || entry.table.status === 'cancelled') {
      if (!entry.cleanupAt) entry.cleanupAt = t + 30 * 60_000;
      if (entry.cleanupAt < t && entry.sockets.size === 0) {
        entry.table.dispose();
        if (entry.watcher) clearInterval(entry.watcher);
        codes.delete(entry.table.code);
        tables.delete(id);
      }
    } else if (t - entry.table.createdAt > TABLE_TTL_MS && entry.sockets.size === 0) {
      entry.table.dispose();
      if (entry.watcher) clearInterval(entry.watcher);
      codes.delete(entry.table.code);
      tables.delete(id);
    }
  }
  for (const [ip, times] of walletCreateByIp) {
    const recent = times.filter((t) => t > now() - 60 * 60_000);
    if (recent.length) walletCreateByIp.set(ip, recent);
    else walletCreateByIp.delete(ip);
  }
  for (const [ip, times] of walletCreateByIp) {
    const recent = times.filter((at) => t - at < 10 * 60_000);
    if (recent.length) walletCreateByIp.set(ip, recent);
    else walletCreateByIp.delete(ip);
  }
}, 60_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`THE DERELICT listening on ${HOST}:${PORT}`);
  console.log(`  chain: ${chain.stakedEnabled ? `${chain.mode} via ${chain.zecdUrl}` : 'off (free tables only)'}`);
  console.log(`  ui:    ${existsSync(join(WEB_DIST, 'index.html')) ? WEB_DIST : 'not built'}`);
  chain.ready().then((h) => console.log('  chain health:', JSON.stringify(h))).catch((e) => console.log('  chain health: error', e.message));
});

function shutdown(signal) {
  console.log(`\n${signal}: closing the harbour.`);
  for (const entry of tables.values()) {
    entry.table.dispose();
    if (entry.watcher) clearInterval(entry.watcher);
  }
  server.close(() => {
    try { store.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server, tables, chain, store };
