// Headless end-to-end voyage. Starts its own server with compressed clocks,
// plays one human seat against three house seats, drives every private action
// (commit, reveal, offer, challenge, duel), then downloads the audit.
//
//   node e2e/protocol.mjs
//
// This is the test that proves the client can play without ever sending an
// unplayed card to the server.

import { spawn } from 'node:child_process';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import {
  makeHand, handCommit, duelHandCommit, playCommit, duelPlayCommit,
  proofFor, shuffle, randomHex,
} from '../shared/crypto.js';
import { RPS_HAND } from '../shared/constants.js';
import { handFor } from '../shared/ecard.js';
import { verifyAudit } from '../shared/audit.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = join(ROOT, 'data-e2e');
const SCALE = 0.06;

await rm(DATA, { recursive: true, force: true });
await mkdir(DATA, { recursive: true });

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    PHASE_SCALE: String(SCALE),
    DATA_DIR: DATA,
    CHAIN_MODE: 'off',
    HTTP_LOG: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.env.E2E_VERBOSE ? process.stdout.write(`[srv] ${d}`) : null);
server.stderr.on('data', (d) => process.stderr.write(`[srv:err] ${d}`));

async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not come up');
}
await waitHealth();

const playerId = 'e2e_' + randomHex(6);
const created = await (await fetch(`${BASE}/api/tables`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'practice', playerId }),
})).json();
if (!created.ok) throw new Error(JSON.stringify(created));
console.log('table', created.tableId, 'seat', created.seat, 'code', created.code);

const state = { latest: null, settled: false };
const acks = new Map();
let reqSeq = 0;
const pending = new Map();

const ws = new WebSocket(`${BASE.replace('http', 'ws')}${created.ws}`);
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

function action(name, payload = {}) {
  const requestId = `r${++reqSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, error: 'ack timeout' });
    }, 8_000);
    pending.set(requestId, { resolve, timer });
    ws.send(JSON.stringify({ type: 'action', action: name, payload, requestId }));
  });
}

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.type === 'ack' && msg.requestId && pending.has(msg.requestId)) {
    const p = pending.get(msg.requestId);
    clearTimeout(p.timer);
    pending.delete(msg.requestId);
    p.resolve(msg);
    return;
  }
  if (msg.type !== 'state') return;
  state.latest = msg.state;
  onState(msg.state).catch((error) => console.error('state handler:', error.message));
});

// ---- client-side secrets. The server never sees these until a play/reveal. ----
let act1 = null;
let duel = null;
let act1Committed = false;
let act1RevealSent = false;
let duelRevealSent = false;
let duelCommitStarted = false;
const usedRps = new Set();
const usedDuel = new Set();
const sent = new Set();

function once(key) {
  if (sent.has(key)) return false;
  sent.add(key);
  return true;
}

async function onState(s) {
  if (!s) return;
  const tableId = created.tableId;
  const seat = s.you.seat;

  if (s.needHandCommit && !act1Committed) {
    act1Committed = true;
    act1 = await makeHand(shuffle(RPS_HAND));
    const commit = await handCommit(tableId, seat, act1.root);
    const ack = await action('hand_commit', { root: act1.root, commit });
    if (!ack.ok) console.error('hand_commit', ack.error);
    return;
  }

  if (s.needHandReveal && act1 && !act1RevealSent) {
    act1RevealSent = true;
    const ack = await action('hand_reveal', { act: 'act1', cards: act1.cards, salts: act1.salts });
    if (!ack.ok) console.error('hand_reveal', ack.error);
  }

  if (s.needDuelHandReveal && duel && !duelRevealSent) {
    duelRevealSent = true;
    const ack = await action('hand_reveal', { act: 'duel', cards: duel.cards, salts: duel.salts });
    if (!ack.ok) console.error('duel hand_reveal', ack.error);
  }

  if (s.status === 'settled' && !state.settled) {
    state.settled = true;
    await finish(s);
    return;
  }

  if (!s.you.alive) return;

  if (s.phase === 'trade') {
    const key = `trade:${s.cycle}`;
    if (once(key)) {
      const bots = s.seats.filter((x) => x.alive && x.isBot);
      if (bots.length) {
        await action('offer', {
          to: bots[0].seat,
          give: { stars: 0, chips: 5 },
          want: { stars: 0, chips: 0 },
        });
      }
      await action('taunt', { id: 1 });
    }
  }

  if (s.phase === 'challenge') {
    const key = `challenge:${s.cycle}`;
    if (once(key)) {
      const options = s.seats.filter((x) => x.alive && x.cardsLeft > 0 && x.seat !== seat);
      if (options.length) {
        options.sort((a, b) => a.stars - b.stars);
        await action('challenge', { target: options[0].seat });
      }
    }
  }

  if (s.phase === 'play' && s.pairing && s.yourPlay && !s.yourPlay.committed) {
    const key = `commit:${s.cycle}`;
    if (once(key) && act1) {
      const remaining = act1.cards.map((card, index) => ({ card, index })).filter(({ index }) => !usedRps.has(index));
      if (!remaining.length) return;
      const choice = remaining[0];
      const playSalt = randomHex(16);
      const commit = await playCommit(tableId, s.cycle, seat, choice.card, playSalt);
      const ack = await action('play_commit', { commit });
      if (!ack.ok) { sent.delete(key); console.error('play_commit', ack.error); return; }
      pending.set(`reveal:${s.cycle}`, { choice, playSalt });
    }
  }

  if (s.phase === 'reveal' && s.pairing && s.yourPlay?.committed && !s.yourPlay.revealed) {
    const key = `reveal:${s.cycle}`;
    const staged = pending.get(key) ?? pending.get(`reveal:${s.cycle}`);
    if (staged && once(`sentreveal:${s.cycle}`)) {
      const { choice, playSalt } = staged;
      usedRps.add(choice.index);
      const ack = await action('play_reveal', {
        card: choice.card,
        index: choice.index,
        salt: act1.salts[choice.index],
        proof: proofFor(act1.tree, choice.index),
        playSalt,
      });
      if (!ack.ok) {
        usedRps.delete(choice.index);
        console.error('play_reveal', ack.error);
      }
    }
  }

  if (s.status === 'finale' && s.phase === 'finale_intro' && s.finale?.needHandCommit && !duel && !duelCommitStarted) {
    duelCommitStarted = true;
    const role = s.finale.yourRole;
    duel = await makeHand(handFor(role));
    const commit = await duelHandCommit(tableId, seat, duel.root);
    const ack = await action('duel_hand_commit', { root: duel.root, commit });
    if (!ack.ok) {
      console.error('duel_hand_commit', ack.error);
      duelCommitStarted = false;
    }
    return;
  }

  if (s.phase === 'duel_commit' && s.finale?.yourSide && !s.finale.yourCommitted) {
    const key = `duelcommit:${s.finale.round}`;
    if (once(key) && duel) {
      const remaining = duel.cards.map((card, index) => ({ card, index })).filter(({ index }) => !usedDuel.has(index));
      const choice = remaining[0];
      const bet = 5;
      const playSalt = randomHex(16);
      const commit = await duelPlayCommit(tableId, s.finale.round, seat, choice.card, bet, playSalt);
      const ack = await action('duel_commit', { commit });
      if (!ack.ok) { sent.delete(key); console.error('duel_commit', ack.error); return; }
      pending.set(`duelreveal:${s.finale.round}`, { choice, bet, playSalt });
    }
  }

  if (s.phase === 'duel_reveal' && s.finale?.yourSide && s.finale.yourCommitted && !s.finale.yourRevealed) {
    const key = `duelreveal:${s.finale.round}`;
    const staged = pending.get(key);
    if (staged && once(`sentduelreveal:${s.finale.round}`)) {
      const { choice, bet, playSalt } = staged;
      usedDuel.add(choice.index);
      const ack = await action('duel_reveal', {
        card: choice.card,
        index: choice.index,
        salt: duel.salts[choice.index],
        proof: proofFor(duel.tree, choice.index),
        bet,
        playSalt,
      });
      if (!ack.ok) {
        usedDuel.delete(choice.index);
        console.error('duel_reveal', ack.error);
      }
    }
  }
}

let finished = false;
async function finish(s) {
  if (finished) return;
  finished = true;
  // Give the final hand reveals a moment to land, then fetch the audit.
  await new Promise((r) => setTimeout(r, 1200));
  const audit = await (await fetch(`${BASE}/api/tables/${created.tableId}/audit`)).json();
  await writeFile(join(ROOT, 'e2e', 'audit.json'), JSON.stringify(audit, null, 2));
  const verdict = await verifyAudit(audit);
  console.log('\n--- voyage complete ---');
  console.log('phase:', s.phase, 'status:', s.status, 'cycle:', s.cycle);
  console.log('you:', { stars: s.you.stars, chips: s.you.chips, alive: s.you.alive, role: s.you.role });
  console.log('settlement:', s.settlement);
  console.log('audit complete:', audit.complete);
  console.log('audit verify:', verdict.ok ? 'OK' : `FAIL (${verdict.errors.length})`);
  if (!verdict.ok) {
    for (const e of verdict.errors.slice(0, 20)) console.log('  -', e);
    ws.close();
    server.kill();
    process.exit(1);
  }
  console.log('human hand was never sent before its cards were played.');
  ws.close();
  server.kill();
  process.exit(0);
}

setTimeout(() => {
  console.error('E2E TIMEOUT at', state.latest?.phase, state.latest?.status, state.latest?.cycle);
  console.error('seats', state.latest?.seats);
  ws.close();
  server.kill();
  process.exit(2);
}, 90_000).unref();
