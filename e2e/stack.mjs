// End-to-end test against the running Docker regtest stack (127.0.0.1:8791).
// Creates a staked solo table, pays the shielded fare through the regtest
// house-funding endpoint, plays the voyage, and — if the human wins — checks
// the shielded payout. This is the test that proves entry and payout both move
// real regtest ZEC through the game's own flow.
//
//   docker compose up --build -d
//   node e2e/stack.mjs
//
// The payout address is derived offline from a throwaway BIP-39 test vector;
// it is not part of the house wallet, so the server's guard against paying
// itself stays exercised.

import WebSocket from 'ws';
import {
  makeHand, handCommit, duelHandCommit, playCommit, duelPlayCommit,
  proofFor, shuffle, randomHex,
} from '../shared/crypto.js';
import { RPS_HAND } from '../shared/constants.js';
import { handFor } from '../shared/ecard.js';
import { verifyAudit } from '../shared/audit.js';

const BASE = process.env.DERELICT_URL || 'http://127.0.0.1:8791';
const PAYOUT_UA = process.env.PAYOUT_UA ||
  'uregtest1kvnhj65x5xgrlf2xap6h8t20n534934eh6ngfvvtpunpazje26vgt5n0vf2x702l6arysdm228ht7utlkngnu3y0jtnwv5uvdykr7epp';
const STAKE_ZATS = Number(process.env.STAKE_ZATS || 1_000_000);

const health = await (await fetch(`${BASE}/api/health`)).json();
if (!health.ok || !health.chain?.staked) {
  throw new Error(`stack is not ready for staked runs: ${JSON.stringify(health.chain)}`);
}
console.log('stack chain:', JSON.stringify(health.chain));

const playerId = 'stack_' + randomHex(6);
const created = await (await fetch(`${BASE}/api/tables`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'solo', playerId, stakeZats: STAKE_ZATS, ua: PAYOUT_UA }),
})).json();
if (!created.ok) throw new Error(JSON.stringify(created));
console.log('staked table', created.tableId, 'seat', created.seat, 'fare', created.deposit?.zec, 'ZEC');
console.log('deposit address', created.deposit?.address);

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
    }, 15_000);
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

let funded = false;
async function payFare() {
  if (funded) return;
  funded = true;
  console.log('paying the fare through /demo-fund …');
  const res = await fetch(`${BASE}/api/tables/${created.tableId}/demo-fund`, { method: 'POST' });
  const body = await res.json();
  if (!body.ok) throw new Error(`demo-fund: ${body.error}`);
  console.log('fare sent', body.txid, body.zats, 'zats');
}
payFare().catch((e) => { console.error(e.message); process.exitCode = 1; });

let act1 = null;
let duel = null;
let act1Committed = false;
let act1RevealSent = false;
let duelRevealSent = false;
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
    const staged = pending.get(key);
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

  if (s.status === 'finale' && s.phase === 'finale_intro' && s.finale?.needHandCommit && !duel) {
    const role = s.finale.yourRole;
    duel = await makeHand(handFor(role));
    const commit = await duelHandCommit(tableId, seat, duel.root);
    const ack = await action('duel_hand_commit', { root: duel.root, commit });
    if (!ack.ok) console.error('duel_hand_commit', ack.error);
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
  await new Promise((r) => setTimeout(r, 2000));
  const audit = await (await fetch(`${BASE}/api/tables/${created.tableId}/audit`)).json();
  const verdict = await verifyAudit(audit);
  console.log('\n--- staked voyage complete ---');
  console.log('phase:', s.phase, 'status:', s.status, 'cycle:', s.cycle);
  console.log('you:', { stars: s.you.stars, chips: s.you.chips, alive: s.you.alive, role: s.you.role });
  console.log('settlement:', s.settlement);
  console.log('audit complete:', audit.complete);
  console.log('audit verify:', verdict.ok ? 'OK' : `FAIL (${verdict.errors.length})`);
  if (!verdict.ok) {
    for (const e of verdict.errors.slice(0, 20)) console.log('  -', e);
    process.exitCode = 1;
  }

  // Poll for the payout transaction. The server pays asynchronously on settle
  // and pushes the updated settlement over the same socket.
  let payout = null;
  for (let i = 0; i < 30; i++) {
    const live = state.latest?.settlement;
    if (live?.txid || live?.status === 'failed') {
      payout = { txid: live.txid ?? null, error: live.status === 'failed' ? 'payout failed' : null, status: live.status };
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('payout:', JSON.stringify(payout));
  if (s.settlement?.payoutZats > 0) {
    if (!payout?.txid) {
      console.error('EXPECTED a payout txid for a human win');
      process.exitCode = 1;
    } else {
      console.log(`shielded payout confirmed: ${s.settlement.payoutZats} zats -> ${payout.txid}`);
    }
  } else {
    console.log('human did not take the pot; no payout expected on this run');
  }
  ws.close();
  process.exit(process.exitCode ?? 0);
}

setTimeout(() => {
  console.error('STACK E2E TIMEOUT at', state.latest?.phase, state.latest?.status, state.latest?.cycle);
  ws.close();
  process.exit(2);
}, Number(process.env.STACK_TIMEOUT_MS || 15 * 60_000));
