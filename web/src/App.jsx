import { useEffect, useMemo, useRef, useState } from 'react';

import {
  makeHand, handCommit, duelHandCommit, playCommit, duelPlayCommit,
  buildHandTree, proofFor, shuffle, randomHex,
} from '@shared/crypto.js';
import { RPS_HAND } from '@shared/constants.js';
import { handFor } from '@shared/ecard.js';
import { verifyAudit } from '@shared/audit.js';

import {
  Landing, StakePrompt, DepositView, LobbyView, SeatGrid, TradePanel,
  ChallengePanel, PlayPanel, WaitingPanel, RoundResult, FinalePanel, LogPanel, ResultPanel,
  PhaseLabel, Clock, remainingMs, Logo, RulesModal, LeaveModal, ProfileModal,
} from './views.jsx';
import { isMuted, setMuted, unlockAudio, playCue } from './sound.js';
import {
  api, wsUrl, loadSession, saveSession, clearSession, newPlayerId,
  loadHands, saveHands, clearHands, emptyHands,
  loadTestWallet, saveTestWallet, clearTestWallet,
} from './net.js';

const PLAYER_KEY = 'derelict.player.v1';
const CUED_PHASES = new Set(['trade', 'challenge', 'play', 'reveal', 'duel_commit', 'duel_reveal']);

function playerId() {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) { id = newPlayerId(); localStorage.setItem(PLAYER_KEY, id); }
    return id;
  } catch {
    return newPlayerId();
  }
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [session, setSession] = useState(() => loadSession());
  const [state, setState] = useState(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [conn, setConn] = useState('idle');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stakeOpen, setStakeOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveKind, setLeaveKind] = useState('leave');
  const [profileOpen, setProfileOpen] = useState(false);
  const [testWallet, setTestWallet] = useState(() => loadTestWallet());
  const [walletInfo, setWalletInfo] = useState(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState(null);
  const [hands, setHands] = useState(() => {
    const s = loadSession();
    return s ? loadHands(s.tableId) : emptyHands();
  });
  const [selectedRps, setSelectedRps] = useState(null);
  const [selectedDuel, setSelectedDuel] = useState(null);
  const [duelBet, setDuelBet] = useState(5);
  const [audit, setAudit] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [soundOff, setSoundOff] = useState(() => isMuted());

  const sessionRef = useRef(session);
  const stateRef = useRef(state);
  const handsRef = useRef(hands);
  const wsRef = useRef(null);
  const pendingRef = useRef(new Map());
  const flagsRef = useRef(new Set());
  const inflightRef = useRef(new Set());
  const seqRef = useRef(0);
  const receivedRef = useRef(0);
  const noticeTimer = useRef(null);
  const treeCache = useRef(new Map());
  const driveTickRef = useRef(0);
  const [driveTick, setDriveTick] = useState(0);
  const auditTries = useRef(0);
  const notifyRef = useRef(() => {});
  const cueRef = useRef({ phase: '', round: '', duel: '', settled: '' });

  sessionRef.current = session;
  stateRef.current = state;
  handsRef.current = hands;
  receivedRef.current = receivedAt;

  const initialJoin = useMemo(() => new URLSearchParams(location.search).get('join') ?? '', []);

  function notify(text, tone = '') {
    if (!text) return;
    setNotice({ text: String(text), tone, id: Date.now() });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), tone === 'bad' ? 8000 : 4500);
  }
  notifyRef.current = notify;

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // Browsers only start audio after a gesture. Arm it on the first one.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  function toggleSound() {
    const next = !soundOff;
    setSoundOff(next);
    setMuted(next);
    if (!next) playCue('phase');
  }

  // A cue when a decision window opens — or when the last one ran out.
  useEffect(() => {
    if (!state) return;
    const key = `${state.id}:${state.status}:${state.phase}:${state.phaseEndsAt ?? ''}`;
    if (cueRef.current.phase === key) return;
    const prev = cueRef.current.prev;
    let timedOut = false;
    if (prev && prev.id === state.id && prev.phase !== state.phase && CUED_PHASES.has(prev.phase) && prev.endsAt) {
      const left = remainingMs(prev.endsAt, state.serverNow, receivedAt);
      timedOut = left != null && left <= 800;
    }
    cueRef.current.phase = key;
    cueRef.current.prev = { id: state.id, phase: state.phase, endsAt: state.phaseEndsAt };
    if (CUED_PHASES.has(state.phase)) playCue(timedOut ? 'expire' : 'phase');
  }, [state?.status, state?.phase, state?.phaseEndsAt, receivedAt]);

  // Act I: one cue per resolved round, from this seat's point of view.
  useEffect(() => {
    if (state?.status !== 'act1' || state.phase !== 'resolve' || !state.you) return;
    const rec = state.lastRound;
    const key = `${state.id}:${state.cycle}:${rec ? `${rec.pair?.join('-')}:${rec.outcome}` : 'bye'}`;
    if (cueRef.current.round === key) return;
    cueRef.current.round = key;
    if (state.bye || !rec || rec.outcome === 'tie') { playCue('tie'); return; }
    if (rec.outcome === 'both-forfeit') { playCue('roundloss'); return; }
    const side = rec.pair?.[0] === state.you.seat ? 'a' : 'b';
    const oppSeat = rec.pair?.[side === 'a' ? 1 : 0];
    if (rec.outcome === side || rec.outcome === `forfeit-${oppSeat}`) playCue('roundwin');
    else playCue('roundloss');
  }, [state?.status, state?.phase, state?.lastRound, state?.cycle]);

  // Act II: one cue per revealed duel round.
  useEffect(() => {
    const f = state?.finale;
    if (state?.status !== 'finale' || state.phase !== 'duel_result' || !f?.lastRound || !f.yourSide) return;
    const r = f.lastRound;
    const key = `${state.id}:${r.round}:${r.outcome}:${r.transfer}`;
    if (cueRef.current.duel === key) return;
    cueRef.current.duel = key;
    // A win with no chips matched (the other side bet zero) is still a win.
    if (r.outcome === 'tie') playCue('tie');
    else if (r.outcome === f.yourSide) playCue('roundwin');
    else playCue('roundloss');
  }, [state?.status, state?.phase, state?.finale]);

  // The voyage is over: make the outcome audible once.
  useEffect(() => {
    if (state?.status !== 'settled' || !state.id) return;
    if (cueRef.current.settled === state.id) return;
    cueRef.current.settled = state.id;
    if (state.settlement?.split) playCue('tie');
    else if (state.you && state.settlement?.winnerSeat === state.you.seat) playCue('win');
    else playCue('lose');
  }, [state?.status]);

  // ---------------------------------------------------------------- config
  useEffect(() => {
    let alive = true;
    api('/api/config').then((data) => { if (alive) setConfig(data); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // ------------------------------------------------------------ test wallet
  useEffect(() => {
    if (!profileOpen || !testWallet?.token) return undefined;
    let alive = true;
    setWalletBusy(true);
    setWalletError(null);
    api('/api/test-wallet/status', { method: 'POST', body: { token: testWallet.token } })
      .then((data) => {
        if (!alive) return;
        if (data.ok) setWalletInfo({ ...data.wallet, faucet: data.faucet });
        else setWalletError(data.error ?? 'could not read the test wallet');
      })
      .catch((error) => { if (alive) setWalletError(error.message); })
      .finally(() => { if (alive) setWalletBusy(false); });
    return () => { alive = false; };
  }, [profileOpen, testWallet?.token]);

  // Opening the fare sheet is also a wallet moment: show the ledger balance so
  // the player can choose the test wallet instead of pasting an external UA.
  useEffect(() => {
    if (!stakeOpen || !testWallet?.token) return undefined;
    let alive = true;
    api('/api/test-wallet/status', { method: 'POST', body: { token: testWallet.token } })
      .then((data) => {
        if (alive && data.ok) setWalletInfo({ ...data.wallet, faucet: data.faucet });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [stakeOpen, testWallet?.token]);

  async function refreshTestWallet() {
    if (!testWallet?.token || walletBusy) return;
    setWalletBusy(true);
    setWalletError(null);
    try {
      const data = await api('/api/test-wallet/status', { method: 'POST', body: { token: testWallet.token } });
      if (data.ok) setWalletInfo({ ...data.wallet, faucet: data.faucet });
      else setWalletError(data.error ?? 'could not read the test wallet');
    } catch (error) {
      setWalletError(error.message);
    } finally {
      setWalletBusy(false);
    }
  }

  async function createTestWallet() {
    if (walletBusy) return;
    setWalletBusy(true);
    setWalletError(null);
    try {
      const data = await api('/api/test-wallet', { method: 'POST', body: {} });
      if (!data.ok) {
        setWalletError(data.error ?? 'could not create a test wallet');
        return;
      }
      const wallet = { token: data.wallet.token, address: data.wallet.address };
      saveTestWallet(wallet);
      setTestWallet(wallet);
      setWalletInfo({ ...data.wallet, faucet: data.faucet });
      notify('test wallet created', 'good');
    } catch (error) {
      setWalletError(error.message);
    } finally {
      setWalletBusy(false);
    }
  }

  async function faucetTestWallet() {
    if (!testWallet?.token || walletBusy) return;
    setWalletBusy(true);
    setWalletError(null);
    try {
      const data = await api('/api/test-wallet/faucet', { method: 'POST', body: { token: testWallet.token } });
      if (!data.ok) {
        setWalletError(data.error ?? 'the test faucet is dry');
        if (data.retryInMs) {
          setWalletInfo((prev) => (prev ? {
            ...prev,
            faucet: { ...(prev.faucet ?? {}), retryInMs: data.retryInMs },
          } : prev));
        }
        return;
      }
      setWalletInfo((prev) => (prev ? {
        ...prev,
        balanceZats: data.balanceZats ?? prev.balanceZats,
        faucet: { ...(prev.faucet ?? {}), zats: data.zats, retryInMs: data.cooldownMs },
      } : prev));
      notify(`test faucet sent ${(data.zats / 1e8).toFixed(2)} ZEC · ${String(data.txid).slice(0, 12)}…`, 'good');
    } catch (error) {
      setWalletError(error.message);
    } finally {
      setWalletBusy(false);
    }
  }

  function forgetTestWallet() {
    clearTestWallet();
    setTestWallet(null);
    setWalletInfo(null);
    setWalletError(null);
  }

  useEffect(() => {
    if (session && initialJoin) history.replaceState({}, '', location.pathname);
  }, [session, initialJoin]);

  // --------------------------------------------------------------- hands
  function updateHands(updater) {
    setHands((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      handsRef.current = next;
      if (sessionRef.current) saveHands(sessionRef.current.tableId, next);
      return next;
    });
  }

  useEffect(() => {
    if (!session) return;
    const h = loadHands(session.tableId);
    handsRef.current = h;
    setHands(h);
  }, [session?.tableId]);

  async function treeOf(hand) {
    if (!hand) return null;
    const cached = treeCache.current.get(hand.root);
    if (cached) return cached;
    const tree = await buildHandTree(hand.cards, hand.salts);
    treeCache.current.set(hand.root, tree);
    return tree;
  }

  // --------------------------------------------------------------- socket
  useEffect(() => {
    if (!session?.tableId || !session?.token) { setConn('idle'); return; }
    let alive = true;
    let attempts = 0;
    let timer = null;
    let ws = null;

    const connect = () => {
      ws = new WebSocket(wsUrl(`/ws?table=${encodeURIComponent(session.tableId)}&token=${encodeURIComponent(session.token)}`));
      wsRef.current = ws;
      setConn(attempts ? 'reconnecting' : 'connecting');
      ws.onopen = () => {
        if (!alive) return;
        attempts = 0;
        setConn('open');
      };
      ws.onmessage = (event) => {
        if (!alive) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'state') {
          receivedRef.current = Date.now();
          setReceivedAt(Date.now());
          setState(msg.state);
          return;
        }
        if (msg.type === 'ack') {
          if (msg.requestId && pendingRef.current.has(msg.requestId)) {
            const p = pendingRef.current.get(msg.requestId);
            clearTimeout(p.timer);
            pendingRef.current.delete(msg.requestId);
            p.resolve(msg);
          } else if (msg.action === 'start' && msg.ok === false) {
            notifyRef.current(msg.error ?? 'the table refused to cast off', 'bad');
          }
          return;
        }
        if (msg.type === 'error') notifyRef.current(msg.error ?? 'the link complained', 'bad');
      };
      ws.onclose = () => {
        if (!alive) return;
        wsRef.current = null;
        setConn('lost');
        attempts += 1;
        timer = setTimeout(connect, Math.min(8000, 700 * 2 ** Math.min(attempts, 4)));
      };
      ws.onerror = () => {};
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already gone */ }
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [session?.tableId, session?.token]);

  function act(name, payload = {}) {
    return new Promise((resolve) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) { resolve({ ok: false, error: 'the link is down' }); return; }
      const requestId = `r${++seqRef.current}`;
      const timer = setTimeout(() => {
        pendingRef.current.delete(requestId);
        resolve({ ok: false, error: 'the table did not answer' });
      }, 12_000);
      pendingRef.current.set(requestId, { resolve, timer });
      ws.send(JSON.stringify({ type: 'action', action: name, payload, requestId }));
    });
  }

  // ---------------------------------------------------------------- drive
  const driveRef = useRef(null);
  driveRef.current = async () => {
    const s = stateRef.current;
    const sess = sessionRef.current;
    const h = handsRef.current;
    if (!s || !sess || !s.you) return;

    const once = async (key, fn) => {
      if (flagsRef.current.has(key)) return;
      flagsRef.current.add(key);
      try { await fn(); } catch (error) { notify(`not sent: ${error.message}`, 'bad'); }
      finally { flagsRef.current.delete(key); }
    };

    // Full-hand reveals for the audit. These happen even after elimination.
    if (s.needHandReveal) {
      if (!h.act1) {
        const key = `missing-act1-hand:${sess.tableId}`;
        if (!flagsRef.current.has(key)) {
          flagsRef.current.add(key);
          notify(`hand reveal: this browser has no saved hand for seat ${s.you.seat}`, 'bad');
        }
      } else {
        await once(`reveal-act1:${sess.tableId}`, async () => {
          const ack = await act('hand_reveal', { act: 'act1', cards: h.act1.cards, salts: h.act1.salts });
          if (!ack.ok) notify(`hand reveal: ${ack.error}`, 'bad');
        });
      }
    }
    if (s.needDuelHandReveal) {
      if (!h.duel) {
        const key = `missing-duel-hand:${sess.tableId}`;
        if (!flagsRef.current.has(key)) {
          flagsRef.current.add(key);
          notify(`duel hand reveal: this browser has no saved hand for seat ${s.you.seat}`, 'bad');
        }
      } else {
        await once(`reveal-duel:${sess.tableId}`, async () => {
          const ack = await act('hand_reveal', { act: 'duel', cards: h.duel.cards, salts: h.duel.salts });
          if (!ack.ok) notify(`duel reveal: ${ack.error}`, 'bad');
        });
      }
    }

    if (s.needHandCommit && !h.act1) {
      await once('act1-hand', async () => {
        const hand = await makeHand(shuffle(RPS_HAND));
        const commit = await handCommit(sess.tableId, s.you.seat, hand.root);
        updateHands((prev) => ({ ...prev, act1: { cards: hand.cards, salts: hand.salts, root: hand.root } }));
        const ack = await act('hand_commit', { root: hand.root, commit });
        if (!ack.ok) notify(`hand: ${ack.error}`, 'bad');
      });
    }

    if (s.status === 'finale' && s.finale?.needHandCommit && !h.duel && s.finale.yourRole) {
      await once('duel-hand', async () => {
        const hand = await makeHand(shuffle(handFor(s.finale.yourRole)));
        const commit = await duelHandCommit(sess.tableId, s.you.seat, hand.root);
        updateHands((prev) => ({ ...prev, duel: { cards: hand.cards, salts: hand.salts, root: hand.root } }));
        const ack = await act('duel_hand_commit', { root: hand.root, commit });
        if (!ack.ok) notify(`duel hand: ${ack.error}`, 'bad');
      });
    }

    if (s.status === 'act1' && s.phase === 'reveal' && s.yourPlay?.committed && !s.yourPlay.revealed) {
      const staged = h.stagedRps?.[s.cycle];
      if (staged) {
        await once(`rps-reveal:${s.cycle}`, async () => {
          const ack = await revealRps(s, h, staged);
          if (!ack.ok) notify(`show: ${ack.error}`, 'bad');
        });
      }
    }

    if (s.status === 'finale' && s.phase === 'duel_reveal' && s.finale?.yourSide && s.finale.yourCommitted && !s.finale.yourRevealed) {
      const staged = h.stagedDuel?.[s.finale.round];
      if (staged) {
        await once(`duel-reveal:${s.finale.round}`, async () => {
          const ack = await revealDuel(s, h, staged);
          if (!ack.ok) notify(`show: ${ack.error}`, 'bad');
        });
      }
    }
  };

  useEffect(() => {
    if (!state) return;
    driveRef.current?.();
  }, [state, hands, driveTick]);

  // A slow heartbeat recovers a send whose ack was lost with a socket.
  useEffect(() => {
    if (!state || (state.status === 'settled' && !state.needHandReveal && !state.needDuelHandReveal)) return;
    const id = setInterval(() => setDriveTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, [state?.status, state?.needHandReveal, state?.needDuelHandReveal]);

  // --------------------------------------------------------- deadline picks
  useEffect(() => {
    if (!state) return;
    const left = remainingMs(state.phaseEndsAt, state.serverNow, receivedAt);
    if (state.status === 'act1' && state.phase === 'play' && state.yourPlay && !state.yourPlay.committed
        && !handsRef.current.stagedRps?.[state.cycle] && left != null) {
      const id = setTimeout(() => autoPlay(), Math.max(250, left - 1800));
      return () => clearTimeout(id);
    }
    if (state.status === 'finale' && state.phase === 'duel_commit' && state.finale?.yourSide
        && !state.finale.yourCommitted && left != null) {
      const id = setTimeout(() => autoDuel(), Math.max(250, left - 2200));
      return () => clearTimeout(id);
    }
  }, [state, receivedAt, hands]);

  // ------------------------------------------------------------ selections
  useEffect(() => {
    if (!state || state.phase !== 'play' || state.yourPlay?.committed || !hands.act1) return;
    const used = new Set(hands.usedRps);
    setSelectedRps((prev) => (prev != null && !used.has(prev) ? prev : hands.act1.cards.findIndex((_, i) => !used.has(i))));
  }, [state?.phase, state?.cycle, state?.yourPlay?.committed, hands]);

  useEffect(() => {
    if (!state || state.status !== 'finale' || state.phase !== 'duel_commit' || state.finale?.yourCommitted) return;
    const used = new Set(hands.usedDuel);
    const cards = hands.duel?.cards ?? [];
    setSelectedDuel((prev) => (prev != null && !used.has(prev) ? prev : cards.findIndex((_, i) => !used.has(i))));
    setDuelBet((bet) => Math.min(Math.max(0, bet), Math.min(20, state.finale?.yourChips ?? 0)));
  }, [state?.phase, state?.finale?.round, state?.finale?.yourCommitted, hands]);

  // -------------------------------------------------------------- actions
  async function commitPlay(index) {
    const s = stateRef.current;
    const h = handsRef.current;
    if (!s || !h.act1 || s.yourPlay?.committed || h.stagedRps?.[s.cycle]) return;
    const card = h.act1.cards[index];
    if (!card) return;
    const key = `commit:${s.cycle}`;
    if (inflightRef.current.has(key)) return;
    inflightRef.current.add(key);
    try {
      const playSalt = randomHex(16);
      const commit = await playCommit(s.id, s.cycle, s.you.seat, card, playSalt);
      const ack = await act('play_commit', { commit });
      if (ack.ok) {
        updateHands((prev) => ({ ...prev, stagedRps: { ...prev.stagedRps, [s.cycle]: { index, card, playSalt } } }));
        setSelectedRps(index);
      } else {
        notify(ack.error ?? 'the table refused the card', 'bad');
      }
    } finally {
      inflightRef.current.delete(key);
    }
  }

  async function commitDuel(index, bet) {
    const s = stateRef.current;
    const h = handsRef.current;
    if (!s?.finale || !h.duel || s.finale.yourCommitted || !s.finale.yourSide) return;
    const card = h.duel.cards[index];
    if (!card) return;
    const round = s.finale.round;
    const key = `duel-commit:${round}`;
    if (inflightRef.current.has(key)) return;
    inflightRef.current.add(key);
    try {
      const playSalt = randomHex(16);
      const commit = await duelPlayCommit(s.id, round, s.you.seat, card, bet, playSalt);
      const ack = await act('duel_commit', { commit });
      if (ack.ok) {
        updateHands((prev) => ({ ...prev, stagedDuel: { ...prev.stagedDuel, [round]: { index, card, bet, playSalt } } }));
        setSelectedDuel(index);
      } else {
        notify(ack.error ?? 'the bet was refused', 'bad');
      }
    } finally {
      inflightRef.current.delete(key);
    }
  }

  async function revealRps(s, h, staged) {
    const tree = await treeOf(h.act1);
    const ack = await act('play_reveal', {
      card: staged.card,
      index: staged.index,
      salt: h.act1.salts[staged.index],
      proof: proofFor(tree, staged.index),
      playSalt: staged.playSalt,
    });
    if (ack.ok) {
      updateHands((prev) => ({
        ...prev,
        usedRps: prev.usedRps.includes(staged.index) ? prev.usedRps : [...prev.usedRps, staged.index],
      }));
    }
    return ack;
  }

  async function revealDuel(s, h, staged) {
    const tree = await treeOf(h.duel);
    const ack = await act('duel_reveal', {
      card: staged.card,
      index: staged.index,
      salt: h.duel.salts[staged.index],
      proof: proofFor(tree, staged.index),
      bet: staged.bet,
      playSalt: staged.playSalt,
    });
    if (ack.ok) {
      updateHands((prev) => ({
        ...prev,
        usedDuel: prev.usedDuel.includes(staged.index) ? prev.usedDuel : [...prev.usedDuel, staged.index],
      }));
    }
    return ack;
  }

  function autoPlay() {
    const s = stateRef.current;
    const h = handsRef.current;
    if (!s || s.phase !== 'play' || s.yourPlay?.committed || !h.act1) return;
    if (h.stagedRps?.[s.cycle]) return;
    const used = new Set(h.usedRps);
    const index = h.act1.cards.findIndex((_, i) => !used.has(i));
    if (index >= 0) commitPlay(index);
  }

  function autoDuel() {
    const s = stateRef.current;
    const h = handsRef.current;
    if (!s?.finale || s.phase !== 'duel_commit' || s.finale.yourCommitted || !h.duel) return;
    if (h.stagedDuel?.[s.finale.round]) return;
    const used = new Set(h.usedDuel);
    const maxBet = Math.max(0, Math.min(20, s.finale.yourChips ?? 0));
    const bet = Math.min(5, maxBet);
    const index = h.duel.cards.findIndex((_, i) => !used.has(i));
    if (index >= 0) commitDuel(index, bet);
  }

  async function run(fn) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  async function onOffer(payload) {
    await run(async () => {
      const ack = await act('offer', payload);
      if (!ack.ok) notify(ack.error ?? 'the note was refused', 'bad');
    });
  }
  async function onRespond(offerId, accept) {
    await run(async () => {
      const ack = await act('offer_response', { offerId, accept });
      if (!ack.ok) notify(ack.error ?? 'the note was spent', 'bad');
    });
  }
  async function onDealer(op) {
    await run(async () => {
      const ack = await act('dealer', { op });
      if (!ack.ok) notify(ack.error ?? 'the dealer refused', 'bad');
    });
  }
  async function onLoan() {
    await run(async () => {
      const ack = await act('loan');
      if (!ack.ok) notify(ack.error ?? 'the note was refused', 'bad');
    });
  }
  async function onTaunt(id) {
    await run(async () => {
      const ack = await act('taunt', { id });
      if (!ack.ok) notify(ack.error ?? 'the intercom is dead', 'bad');
    });
  }
  async function onChallenge(target) {
    await run(async () => {
      const ack = await act('challenge', { target });
      if (!ack.ok) notify(ack.error ?? 'the challenge was refused', 'bad');
    });
  }

  // --------------------------------------------------------------- tables
  async function createTable(mode, extra = {}) {
    setBusy(true);
    try {
      const data = await api('/api/tables', { method: 'POST', body: { mode, playerId: playerId(), ...extra } });
      if (!data.ok) { notify(data.error ?? 'could not open a table', 'bad'); return; }
      adoptSession(data);
    } catch (error) {
      notify(error.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function joinTable({ tableId: id, code }) {
    setBusy(true);
    try {
      const data = await api(`/api/tables/${encodeURIComponent(id.trim())}/join`, {
        method: 'POST',
        body: { code, playerId: playerId() },
      });
      if (!data.ok) { notify(data.error ?? 'could not join', 'bad'); return; }
      adoptSession(data);
    } catch (error) {
      notify(error.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  function adoptSession(data) {
    const next = {
      tableId: data.tableId,
      token: data.token,
      seat: data.seat,
      code: data.code,
      mode: data.mode,
      deposit: data.deposit ?? null,
      walletPay: Boolean(data.walletPay),
      playerId: playerId(),
    };
    saveSession(next);
    sessionRef.current = next;
    setSession(next);
    setState(null);
    setAudit(null);
    setVerdict(null);
    auditTries.current = 0;
    flagsRef.current.clear();
    inflightRef.current.clear();
    const h = loadHands(next.tableId);
    handsRef.current = h;
    setHands(h);
  }

  async function startTable() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) { notify('the link is not open', 'bad'); return; }
    ws.send(JSON.stringify({ type: 'start' }));
  }

  function requestLeave(kind = 'leave') {
    setLeaveKind(kind);
    setLeaveOpen(true);
  }

  function leaveNow(kind = 'leave') {
    const tableId = sessionRef.current?.tableId;
    try { wsRef.current?.close(); } catch { /* ignore */ }
    if (kind === 'forget' && tableId) clearHands(tableId);
    clearSession();
    sessionRef.current = null;
    setSession(null);
    setState(null);
    setConn('idle');
    setAudit(null);
    setVerdict(null);
    setSelectedRps(null);
    setSelectedDuel(null);
    setLeaveOpen(false);
  }

  function leave(ask = true) {
    if (ask) requestLeave('leave');
    else leaveNow('leave');
  }

  async function again() {
    const old = session;
    try { wsRef.current?.close(); } catch { /* ignore */ }
    clearSession();
    if (old) {
      // The hands stay in local storage so the finished audit remains reproducible,
      // but they can never be used at a different table.
    }
    setSession(null);
    setState(null);
    setAudit(null);
    setVerdict(null);
    setTimeout(() => createTable('practice'), 60);
  }

  async function demoFund() {
    if (!session) return;
    setBusy(true);
    try {
      const data = await api(`/api/tables/${session.tableId}/demo-fund`, { method: 'POST' });
      if (!data.ok) notify(data.error ?? 'the house could not send the fare', 'bad');
      else notify(`house paid ${(data.zats / 1e8).toFixed(2)} ZEC · ${String(data.txid).slice(0, 12)}…`, 'good');
    } finally {
      setBusy(false);
    }
  }

  async function payWalletFare() {
    if (!session || !testWallet?.token) return;
    setBusy(true);
    try {
      const data = await api('/api/test-wallet/pay', {
        method: 'POST',
        body: { token: testWallet.token, tableId: session.tableId },
      });
      if (!data.ok) {
        notify(data.error ?? 'the test wallet could not pay the fare', 'bad');
        if (data.balanceZats != null) {
          setWalletInfo((prev) => (prev ? { ...prev, balanceZats: data.balanceZats } : prev));
        }
      } else {
        setWalletInfo((prev) => (prev ? { ...prev, balanceZats: data.balanceZats } : prev));
        notify(`test wallet paid ${(data.zats / 1e8).toFixed(4)} ZEC · ${String(data.txid).slice(0, 12)}…`, 'good');
      }
    } catch (error) {
      notify(error.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- audit
  useEffect(() => {
    if (state?.status !== 'settled' || !session) return;
    let cancelled = false;
    auditTries.current = 0;
    const load = async () => {
      setVerifying(true);
      try {
        const data = await api(`/api/tables/${session.tableId}/audit`);
        if (cancelled) return;
        if (data?.version) {
          setAudit(data);
          try {
            const v = await verifyAudit(data);
            if (!cancelled) setVerdict(v);
          } catch (error) {
            if (!cancelled) setVerdict({ ok: false, errors: [String(error.message ?? error)], warnings: [] });
          }
          if (!data.complete && auditTries.current < 8) {
            auditTries.current += 1;
            setTimeout(() => { if (!cancelled) load(); }, 2000);
          }
        } else if (auditTries.current < 8) {
          auditTries.current += 1;
          setTimeout(() => { if (!cancelled) load(); }, 2000);
        }
      } catch (error) {
        if (!cancelled) notify(`audit: ${error.message}`, 'bad');
      } finally {
        if (!cancelled) setVerifying(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [state?.status, state?.needHandReveal, state?.needDuelHandReveal, session?.tableId]);

  function downloadAudit() {
    if (!audit) return;
    const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `derelict-audit-${session.tableId.slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------- views
  let content;
  if (!session) {
    if (stakeOpen) {
      content = (
        <StakePrompt
          config={config}
          wallet={testWallet}
          walletInfo={walletInfo}
          busy={busy}
          notice={notice}
          onCancel={() => setStakeOpen(false)}
          onWallet={() => setProfileOpen(true)}
          onSubmit={async ({ stakeZats, ua, walletToken }) => {
            await createTable('solo', { stakeZats, ua, walletToken });
            setStakeOpen(false);
          }}
        />
      );
    } else {
      content = (
        <Landing
          config={config}
          busy={busy}
          notice={notice}
          initialJoin={initialJoin}
          onCreate={(mode) => (mode === 'solo' ? setStakeOpen(true) : createTable(mode))}
          onJoin={joinTable}
          onRules={() => setRulesOpen(true)}
          onProfile={() => setProfileOpen(true)}
        />
      );
    }
  } else if (!state) {
    content = (
      <div className="center-screen">
        <div className="panel narrow">
          <p className="eyebrow">TABLE {session.tableId.slice(0, 8)}</p>
          <h2>{conn === 'lost' ? 'THE LINK IS LOST' : 'BOARDING…'}</h2>
          <p className="muted">
            {conn === 'lost'
              ? 'The harbour is not answering. The table may have been cleaned up, or the link is reconnecting.'
              : 'Opening a private channel to your seat.'}
          </p>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => requestLeave('forget')}>FORGET THIS TABLE</button>
          </div>
        </div>
      </div>
    );
  } else if (state.status === 'awaiting_deposit') {
    content = (
      <DepositView
        state={state}
        session={session}
        config={config}
        wallet={testWallet}
        walletInfo={walletInfo}
        busy={busy}
        notice={notice}
        onWalletPay={payWalletFare}
        onDemoFund={demoFund}
        onWallet={() => setProfileOpen(true)}
        onLeave={() => leave()}
      />
    );
  } else if (state.status === 'lobby') {
    content = (
      <LobbyView
        state={state}
        session={session}
        onStart={startTable}
        onLeave={() => leave()}
        onCopy={(text) => navigator.clipboard?.writeText(text).catch(() => {})}
      />
    );
  } else {
    content = (
      <div className="app">
        <header className="bar">
          <div className="bar-left">
            <Logo size={26} decorative />
            <span className="bar-title">THE DERELICT</span>
            <span className="bar-mode">{String(state.mode).toUpperCase()}</span>
            {state.code && <span className="bar-code">CODE {state.code}</span>}
          </div>
          <div className="bar-mid">
            <span className="bar-phase">{PhaseLabel(state)}</span>
            <Clock state={state} receivedAt={receivedAt} />
          </div>
          <div className="bar-right">
            <span className={`link-dot ${conn === 'open' ? 'on' : ''}`} />
            <span className="bar-link">{conn === 'open' ? 'LINKED' : conn === 'reconnecting' ? 'RE-LINKING' : 'LOST'}</span>
            {config?.chain?.faucet && (
              <button type="button" className="btn tiny ghost" onClick={() => setProfileOpen(true)}>PROFILE</button>
            )}
            <button type="button" className="btn tiny ghost" onClick={() => setRulesOpen(true)}>RULES</button>
            <button
              type="button"
              className={`btn tiny ghost sound-btn ${soundOff ? 'off' : ''}`}
              aria-pressed={!soundOff}
              title={soundOff ? 'Sound is off' : 'Sound is on'}
              onClick={toggleSound}
            >
              {soundOff ? 'SOUND OFF' : 'SOUND ON'}
            </button>
            <button type="button" className="btn tiny ghost" onClick={() => leave()}>LEAVE</button>
          </div>
        </header>

        {conn !== 'open' && (
          <div className="link-banner">
            {conn === 'lost' ? 'LINK LOST — the table may have moved on. Reconnecting…' : 'RE-LINKING TO THE TABLE…'}
          </div>
        )}

        <main className="layout">
          <div className="main-col">
            {state.status === 'settled' ? (
              <ResultPanel
                state={state}
                audit={audit}
                verdict={verdict}
                verifying={verifying}
                onDownload={downloadAudit}
                onAgain={again}
                onLeave={() => leave()}
              />
            ) : state.status === 'cancelled' ? (
              <div className="center-screen"><div className="panel narrow"><h2>THE GANGWAY CLOSED</h2><p className="muted">The fare never cleared.</p><button type="button" className="btn" onClick={() => leave(false)}>BACK TO THE HARBOUR</button></div></div>
            ) : (
              <>
                <div className="table-strip">
                  <span>{state.mode === 'solo' ? `STAKE ${(state.stakeZats / 1e8).toFixed(4)} ZEC` : state.mode === 'private' ? 'PRIVATE TABLE' : 'PRACTICE TABLE'}</span>
                  {state.mode === 'solo' && <span>BANKROLL {(state.bankrollZats / 1e8).toFixed(4)} ZEC</span>}
                  <span>{state.mode === 'solo' ? `POT ${(state.potZats / 1e8).toFixed(4)} ZEC` : `SEATS ${state.seats.length}/4`}</span>
                  <span>{state.you ? `YOU ARE ${state.seats.find((s) => s.seat === state.you.seat)?.handle ?? '—'}` : ''}</span>
                  {state.you?.debt > 0 && <span className="bad">DEBT {state.you.debt}</span>}
                </div>

                <SeatGrid state={state} youSeat={state.you?.seat} />

                {state.status === 'act1' && (
                  <>
                    {state.phase === 'trade' && (
                      <TradePanel
                        state={state}
                        busy={busy}
                        onOffer={onOffer}
                        onRespond={onRespond}
                        onDealer={onDealer}
                        onLoan={onLoan}
                        onTaunt={onTaunt}
                      />
                    )}
                    {state.phase === 'challenge' && <ChallengePanel state={state} busy={busy} onChallenge={onChallenge} />}
                    {(state.phase === 'play' || state.phase === 'reveal') && (
                      <PlayPanel
                        state={state}
                        hands={hands}
                        selected={selectedRps}
                        setSelected={setSelectedRps}
                        busy={busy}
                        onCommit={(index) => run(() => commitPlay(index))}
                      />
                    )}
                    {state.phase === 'resolve' && <RoundResult state={state} />}
                    {['muster', 'act1_end'].includes(state.phase) && <WaitingPanel state={state} />}
                  </>
                )}

                {state.status === 'muster' && <WaitingPanel state={state} />}

                {state.status === 'finale' && (
                  <>
                    <FinalePanel
                      state={state}
                      hands={hands}
                      selected={selectedDuel}
                      setSelected={setSelectedDuel}
                      bet={duelBet}
                      setBet={setDuelBet}
                      busy={busy}
                      onCommit={(index, bet) => run(() => commitDuel(index, bet))}
                    />
                    {state.phase === 'finale_intro' && hands.duel && (
                      <div className="panel action-panel">
                        <p className="muted">Your hand is sealed. The back room opens when both sides are ready.</p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <aside className="side-col">
            <LogPanel log={state.log} />
            <section className="panel howto">
              <header className="panel-head"><span>THE RULES</span></header>
              <p><strong>ACT I.</strong> Three stars. Six cards. Win a round, take a star. Lose one, give one. At zero you are out.</p>
              <p><strong>SIDE DEALS.</strong> Sealed offers are relayed to one seat. The dealer buys and sells stars. The loan comes due when Act I closes.</p>
              <p><strong>ACT II.</strong> Two survivors. Crown and Rebel. Five cards each, hidden card and bet every round. Rebel wins pay double.</p>
              <p className="muted tiny">Your unused cards never leave this browser. After the voyage, every hand is revealed for the audit.</p>
            </section>
          </aside>
        </main>
      </div>
    );
  }

  return (
    <>
      {content}
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        wallet={testWallet}
        info={walletInfo}
        busy={walletBusy}
        error={walletError}
        onCreate={createTestWallet}
        onFaucet={faucetTestWallet}
        onRefresh={refreshTestWallet}
        onForget={forgetTestWallet}
      />
      <LeaveModal
        open={leaveOpen}
        kind={leaveKind}
        state={state}
        session={session}
        onCancel={() => setLeaveOpen(false)}
        onConfirm={() => leaveNow(leaveKind)}
      />
      {notice && <div key={notice.id} className={`toast ${notice.tone ?? ''}`} role="status">{notice.text}</div>}
    </>
  );
}
