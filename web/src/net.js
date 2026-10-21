// Session + hand storage. The session token is a bearer ticket to one seat;
// the hands are this device's secret. Both live in localStorage so a refresh
// does not forfeit a voyage. Nothing here is ever sent in the clear.

const SESSION_KEY = 'derelict.session.v1';
const HANDS_PREFIX = 'derelict.hands.v1.';
const TEST_WALLET_KEY = 'derelict.testwallet.v1';

// A static host (Vercel) can serve this SPA while the game server runs
// somewhere else (Railway). Leave both values blank for the same-origin
// development server and the Docker image. VITE_API_BASE is an origin only:
//   VITE_API_BASE=https://derelict-production.up.railway.app
// VITE_WS_BASE is optional and defaults to the WebSocket form of the API base.
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '');
const WS_BASE = (import.meta.env.VITE_WS_BASE ?? '').trim().replace(/\/+$/, '');

export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

export function wsUrl(path) {
  if (WS_BASE) return `${WS_BASE}${path}`;
  if (API_BASE) {
    try {
      const url = new URL(API_BASE, location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${url.origin}${path}`;
    } catch { /* fall through to same-origin */ }
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.tableId || !s?.token || !Number.isInteger(s?.seat)) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage may be full */ }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// Regtest test wallet. The token is a bearer for one house-held regtest
// address; it is not a viewing key and it is not a private wallet.
export function loadTestWallet() {
  try {
    const raw = localStorage.getItem(TEST_WALLET_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw);
    if (!/^[0-9a-f]{48}$/.test(w?.token ?? '')) return null;
    return { token: w.token, address: typeof w.address === 'string' ? w.address : null };
  } catch {
    return null;
  }
}

export function saveTestWallet(wallet) {
  if (!wallet?.token) return;
  try {
    localStorage.setItem(TEST_WALLET_KEY, JSON.stringify({
      token: wallet.token,
      address: wallet.address ?? null,
    }));
  } catch { /* storage may be full */ }
}

export function clearTestWallet() {
  try { localStorage.removeItem(TEST_WALLET_KEY); } catch { /* ignore */ }
}

export function newPlayerId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return 'p_' + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* an empty body is still a response */ }
  if (!data) data = { ok: false, error: `HTTP ${res.status}` };
  if (!res.ok && data.ok !== false) data.ok = false;
  return data;
}

export function emptyHands() {
  return {
    act1: null,        // { cards, salts, root }
    duel: null,
    usedRps: [],       // leaf indices spent in Act I
    usedDuel: [],      // leaf indices spent in the duel
    stagedRps: {},     // cycle -> { index, card, playSalt }
    stagedDuel: {},    // round -> { index, card, bet, playSalt }
  };
}

export function loadHands(tableId) {
  try {
    const raw = localStorage.getItem(HANDS_PREFIX + tableId);
    if (!raw) return emptyHands();
    const h = JSON.parse(raw);
    return { ...emptyHands(), ...h };
  } catch {
    return emptyHands();
  }
}

export function saveHands(tableId, hands) {
  try {
    // The Merkle tree is rebuilt on demand; only the cards, salts and root persist.
    const slim = {
      ...hands,
      act1: hands.act1 ? { cards: hands.act1.cards, salts: hands.act1.salts, root: hands.act1.root } : null,
      duel: hands.duel ? { cards: hands.duel.cards, salts: hands.duel.salts, root: hands.duel.root } : null,
    };
    localStorage.setItem(HANDS_PREFIX + tableId, JSON.stringify(slim));
  } catch { /* best effort */ }
}

export function clearHands(tableId) {
  try { localStorage.removeItem(HANDS_PREFIX + tableId); } catch { /* ignore */ }
}

export function shortId(id) {
  return String(id ?? '').slice(0, 8);
}

export function zec(zats) {
  return (Number(zats) / 1e8).toFixed(8);
}
