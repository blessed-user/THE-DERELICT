import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TAUNTS } from '@shared/flavor.js';
import { playCue } from './sound.js';
import { CardArt } from './card-art.jsx';

// ------------------------------------------------------------------ atoms

export function Logo({ size = 34, className = '', decorative = false }) {
  return (
    <svg
      className={`logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'THE DERELICT'}
      aria-hidden={decorative ? 'true' : undefined}
      focusable="false"
    >
      <path d="M10 2h44l8 8v44l-8 8H10l-8-8V10l8-8Z" fill="#0c0b09" stroke="#4a3626" strokeWidth="1.6" />
      <path d="M13 7h38l6 6v38l-6 6H13l-6-6V13l6-6Z" stroke="#2a2119" strokeWidth="1" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="#6a5847" />
      <circle cx="8.5" cy="55.5" r="1.5" fill="#6a5847" />
      <circle cx="55.5" cy="55.5" r="1.5" fill="#6a5847" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 13h12c11 0 18 8 18 19s-7 19-18 19H14V13Zm7 7v24h5c7 0 11-4.8 11-12s-4-12-11-12h-5Z"
        fill="#e7dcc6"
      />
      <path d="M45 54 58 10" stroke="#0c0b09" strokeWidth="9" strokeLinecap="square" />
      <path d="M45 54 58 10" stroke="#ff7a18" strokeWidth="5" strokeLinecap="square" />
    </svg>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, eyebrow, title, children, actions, tone = 'default', size = 'normal' }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const body = document.body;
    const appRoot = document.getElementById('root');
    const previousOverflow = body.style.overflow;
    const previousInert = appRoot?.inert ?? false;
    body.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;

    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll(FOCUSABLE) ?? [])
      .filter((el) => el.getClientRects().length > 0);
    const focusTimer = setTimeout(() => {
      const preferred = panel?.querySelector('[data-autofocus]');
      (preferred ?? focusables()[0] ?? panel)?.focus();
    }, 30);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = previousInert;
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
        setTimeout(() => restore.focus(), 0);
      }
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={`modal-backdrop tone-${tone}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current?.(); }}
    >
      <div
        className={`modal ${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
      >
        <span className="modal-rail" aria-hidden="true" />
        <header className="modal-head">
          <div className="modal-heading">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="modal-close" onClick={() => closeRef.current?.()} aria-label="Close dialog">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {actions && <footer className="modal-actions">{actions}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function RulesModal({ open, onClose }) {
  const [tab, setTab] = useState('how');

  // Always open on the quick-start page; reset while the book is closed so the
  // next open does not flash the last tab.
  useEffect(() => { if (!open) setTab('how'); }, [open]);

  const onTabKey = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'how' ? 'rules' : 'how';
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`rules-tab-${next}`)?.focus());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="THE VOYAGE · HOW IT RUNS"
      title="THE RULES OF THE HOLD"
      size="wide"
      actions={<button type="button" className="btn" data-autofocus onClick={onClose}>CLOSE THE BOOK</button>}
    >
      <div className="rules-tabs" role="tablist" aria-label="Rules sections" onKeyDown={onTabKey}>
        <button
          type="button"
          role="tab"
          id="rules-tab-how"
          className="rules-tab"
          aria-selected={tab === 'how'}
          aria-controls="rules-panel-how"
          tabIndex={tab === 'how' ? 0 : -1}
          onClick={() => setTab('how')}
        >
          HOW TO PLAY
        </button>
        <button
          type="button"
          role="tab"
          id="rules-tab-rules"
          className="rules-tab"
          aria-selected={tab === 'rules'}
          aria-controls="rules-panel-rules"
          tabIndex={tab === 'rules' ? 0 : -1}
          onClick={() => setTab('rules')}
        >
          THE FULL RULES
        </button>
      </div>

      <div id="rules-panel-how" role="tabpanel" aria-labelledby="rules-tab-how" hidden={tab !== 'how'}>
        <p className="how-lede">
          Four seats fight over two numbers: <strong>stars</strong> keep you alive, and{' '}
          <strong>chips</strong> are what you carry into the back room. Play is free until you
          pick a staked run; then the chips are slices of real ZEC — one fare in, one pot out.
        </p>
        <div className="how-cols">
          <section className="how-card">
            <h3>STARS · LIVES AND RANK</h3>
            <p>You start with 3. Win a challenge and take one from the loser. At 0 stars you are <strong>OUT</strong>. When the hold closes, the top two by stars — then chips — reach the back room.</p>
          </section>
          <section className="how-card">
            <h3>CHIPS · STACK AND MONEY</h3>
            <p>You start with 40. Buy a star for 50, sell one for 20, trade chips seat to seat, or take the loan. Chips break finalist ties — and in a staked run they are your bankroll.</p>
          </section>
        </div>
        <section className="how-money">
          <h3>WHERE THE ZEC IS</h3>
          <p>
            Only two moments are Zcash transactions: <strong>the fare in</strong> and{' '}
            <strong>the payout out</strong>. Side deals, dealer trades, the loan and every duel
            bet move <strong>chips</strong> inside the table — no wallet signs them, and no ZEC
            changes hands per bet.
          </p>
          <ol className="how-steps">
            <li><strong>CHOOSE YOUR ENTRY FARE.</strong> In <strong>STAKE A FARE</strong>, choose 0.01–0.20 ZEC (default 0.05). Choose your test wallet or enter a shielded address for any payout.</li>
            <li><strong>PAY ONCE, SHIELDED.</strong> Send the exact fare to the table&apos;s fresh address with the memo shown, or press <strong>PAY THE FARE FROM TEST WALLET</strong>. The house holds it as your bankroll; it is not a bet against another player.</li>
            <li><strong>CHIPS CARRY THE VALUE.</strong> The fare buys your 40 Act I chips, so one chip is worth fare ÷ 40. Trade chips away and you carry less into the back room; win chips and you carry more.</li>
            <li><strong>THE HOUSE MATCHES THE BACK ROOM.</strong> Your surviving chips are rescaled to 100 back-room chips worth your surviving bankroll. The house puts up the same amount, making the pot 2× your bankroll.</li>
            <li><strong>ONE PAYOUT.</strong> Win the duel and the house sends you the matched pot. Tie and your bankroll comes back. Lose the duel or fall in Act I and nothing is paid. For a test wallet the pot is credited to its house-held ledger; for an external wallet it arrives at your shielded address.</li>
          </ol>
          <div className="how-holders">
            <div><span>YOUR WALLET</span><p>Pays the fare once; receives the payout once.</p></div>
            <div><span>HOUSE BANKROLL</span><p>Holds the fare during the voyage and matches it in the back room.</p></div>
            <div><span>TABLE CHIPS</span><p>Move between seats in deals and duel rounds. No wallet is involved in a bet.</p></div>
          </div>
          <p className="how-scope">
            A test wallet is a house-custodied regtest ledger, not a private wallet. It exists so
            you can walk entry → play → payout without installing a wallet; it has no real value.
          </p>
        </section>
        <div className="how-example">
          <span className="how-example-label">WORKED EXAMPLE · 0.05 ZEC FARE</span>
          <p>40 chips × 0.00125 ZEC each. You survive Act I with 32 chips → bankroll 0.04 ZEC.</p>
          <p>Back room: 100 chips × 0.0004 ZEC; the house matches 0.04 → pot 0.08 ZEC.</p>
          <p><strong>WIN 0.08 ZEC</strong> shielded · <strong>TIE 0.04 ZEC</strong> back · <strong>LOSE 0</strong>.</p>
        </div>
        <div className="rules-grid">
          <section>
            <h3>01 · PICK A TABLE</h3>
            <p><strong>TAKE A SEAT</strong> is free: you against three house seats, no wallet, no fare. <strong>OPEN A TABLE</strong> is a free private table — share the six-character code; up to four humans, empty chairs become house. <strong>JOIN WITH CODE</strong> enters a friend&apos;s table. <strong>STAKE A FARE</strong> is the only mode with ZEC: a solo run against three house seats with the fare as your bankroll.</p>
          </section>
          <section>
            <h3>02 · SEAL YOUR HAND</h3>
            <p>Six cards: two Rock, two Paper, two Scissors. Your browser salts and hashes them into a Merkle tree and sends only the root. Press <strong>SEAL HAND</strong> and wait for <strong>SEALED</strong>; the table holds for a connected human. The server later receives only the one card you play, with a proof it came from the sealed hand.</p>
          </section>
          <section>
            <h3>03 · TRADE</h3>
            <p><strong>Offers:</strong> pick one living seat and offer a bundle — give stars and/or chips, ask for stars and/or chips. Only that seat sees it; they accept or refuse. <strong>Dealer:</strong> sell a star → +20 chips; buy a star → −50 chips. <strong>Loan:</strong> once per run, +40 chips now, 64 chips due when Act I closes. In a staked run, every chip you trade is a slice of the fare.</p>
          </section>
          <section>
            <h3>04 · CHALLENGE → PLAY → SHOW</h3>
            <p>Name a living seat. Mutual picks pair; everyone else is paired at random, with a bye if the count is odd. Both sides seal one unspent card, then reveal. Rock beats Scissors, Scissors beats Paper, Paper beats Rock. Winner takes a star; a tie moves nothing. Fail to show and you forfeit a star; if both freeze, the house burns one from each.</p>
          </section>
          <section>
            <h3>05 · SURVIVE ACT I</h3>
            <p>Zero stars is <strong>OUT</strong>. The hold ends when only two seats remain, when fewer than two seats still hold cards, or after 12 cycles — whichever comes first. Unpaid loans settle first: 64 chips are seized, and a stack that cannot cover it is eliminated. Then the top two by stars, then chips, enter the back room. If only one survives, the house takes the empty chair. Your surviving stack becomes your bankroll.</p>
          </section>
          <section>
            <h3>06 · THE BACK ROOM</h3>
            <p>The higher-ranked survivor is <strong>CROWN</strong>; the other is <strong>REBEL</strong>. Each gets five cards — their role card plus four Citizens — and 100 chips. Five rounds: each side secretly seals a card and a bet of 0–20 chips, then both show. Crown beats Citizen · Citizen beats Rebel · Rebel beats Crown; same card ties. The round winner takes the matched bet, doubled when Rebel wins. The bigger stack after five rounds takes the duel; equal stacks split. In a staked run the pot is your entering bankroll plus the house match — not your final chip count.</p>
          </section>
        </div>
      </div>

      <div id="rules-panel-rules" role="tabpanel" aria-labelledby="rules-tab-rules" hidden={tab !== 'rules'}>
        <div className="rules-grid">
          <section>
            <h3>01 · THE TABLE</h3>
            <p>Four seats, three stars each, forty chips. Every seat seals a private six-card hand: two rock, two paper, two scissors. Your cards stay in this browser; the dealer receives a commitment, not the hand.</p>
          </section>
          <section>
            <h3>02 · ONE CYCLE</h3>
            <p>A cycle runs <strong>trade → challenge → play → show</strong>. Winners take a star. Ties move nothing. A seat that fails to show forfeits a star; if both freeze, the house burns one from each.</p>
          </section>
          <section>
            <h3>03 · THE SIDE MARKET</h3>
            <p>Send sealed one-to-one offers: stars, chips, or both. The dealer buys a star for 20 chips and sells one for 50. The loan shark gives 40 chips for a 64-chip note, seized when Act I closes.</p>
          </section>
          <section>
            <h3>04 · THE BACK ROOM</h3>
            <p>The two surviving seats enter Act II as <strong>Crown</strong> and <strong>Rebel</strong>. Each seals five cards — one Special, four Citizens — and five rounds of hidden card and bet decide the pot. Rebel wins pay double.</p>
          </section>
          <section>
            <h3>05 · ELIMINATION</h3>
            <p>At zero stars a seat is out. The hold ends at two survivors, when every card is spent, or at the cycle cap. Unpaid debt is settled at the end of Act I. The higher stack after the duel takes the pot. In a staked solo run the fare backs the chip stack: your surviving Act I chips become the back-room bankroll, the house matches it, a win pays the matched pot, and a split returns your bankroll.</p>
          </section>
          <section>
            <h3>06 · THE AUDIT</h3>
            <p>After settlement every hand is revealed. The audit rebuilds each Merkle root, checks every play proof and the whole star and chip ledger. Download it from the result screen and verify it offline.</p>
          </section>
        </div>
      </div>
      <p className="modal-note">The clock does not stop while this book is open. The dealer sees the cards you play and full hands after the voyage. It does not see your unplayed hands during play. Offers are private from other seats, not from the operator.</p>
    </Modal>
  );
}

export function LeaveModal({ open, kind = 'leave', state, session, onCancel, onConfirm }) {
  const staked = (state?.mode ?? session?.mode) === 'solo';
  const status = state?.status;
  const live = status === 'act1' || status === 'finale';
  const settled = status === 'settled';
  const lobby = status === 'lobby';
  const fare = status === 'awaiting_deposit';
  const forget = kind === 'forget';
  const fareZec = state?.stakeZats ? (state.stakeZats / 1e8).toFixed(4) : null;

  let eyebrow = 'THE GANGWAY';
  let title = 'LEAVE THE TABLE?';
  let confirmLabel = 'LEAVE';
  let cancelLabel = 'STAY';
  let tone = 'default';

  if (forget) {
    eyebrow = 'ABANDONED SEAT';
    title = 'FORGET THIS TABLE?';
    confirmLabel = 'FORGET IT';
    cancelLabel = 'KEEP IT';
    tone = 'danger';
  } else if (live) {
    eyebrow = 'YOU ARE STILL ABOARD';
    title = 'ABANDON THE TABLE?';
    confirmLabel = 'ABANDON THE TABLE';
    cancelLabel = 'STAY ABOARD';
    tone = 'danger';
  } else if (fare) {
    eyebrow = 'THE FARE HAS NOT CLEARED';
    title = 'LEAVE THE FARE?';
    confirmLabel = 'LEAVE THE FARE';
    cancelLabel = 'WAIT FOR THE FARE';
    tone = 'danger';
  } else if (settled) {
    eyebrow = 'VOYAGE ENDED';
    title = 'CLOSE THE VOYAGE?';
    confirmLabel = 'LEAVE';
    cancelLabel = 'BACK TO THE RESULT';
  } else if (lobby) {
    eyebrow = 'PRIVATE TABLE';
    title = 'LEAVE THE GANGWAY?';
    confirmLabel = 'LEAVE';
    cancelLabel = 'STAY IN THE LOBBY';
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      eyebrow={eyebrow}
      title={title}
      tone={tone}
      actions={(
        <>
          <button type="button" className="btn ghost" data-autofocus onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={`btn ${tone === 'danger' ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </>
      )}
    >
      {forget && (
        <>
          <div className="modal-warning">
            <strong>This browser is the only witness.</strong>
            <p>The saved seat and any sealed hand for this table will be removed. The table itself is not deleted.</p>
          </div>
          <p>Only forget the table once you are sure you will not need the audit or the seat again.</p>
        </>
      )}
      {!forget && live && (
        <>
          <div className="modal-warning">
            <strong>The voyage is still running.</strong>
            <p>Your seat stays at the table, but nobody will play its cards. You forfeit the round and may be eliminated.</p>
          </div>
          <ul className="modal-list">
            {staked
              ? <li>Your fare{fareZec ? ` of ${fareZec} ZEC` : ''} is already in the pot. Abandoning the run forfeits the stake.</li>
              : <li>Your stars and chips stay behind. The table plays on without you.</li>}
            <li>Your sealed hand remains in this browser, but it cannot follow you to another table.</li>
          </ul>
        </>
      )}
      {!forget && fare && (
        <>
          <div className="modal-warning">
            <strong>The fare has not cleared.</strong>
            <p>If you already sent the shielded payment, stay until it confirms. Leaving now may lose track of the deposit.</p>
          </div>
          <p>The table will be cleaned up when its hold expires.</p>
        </>
      )}
      {!forget && settled && (
        <>
          <p>The table is settled and the audit has been published.</p>
          <ul className="modal-list">
            <li>Leaving clears this browser's seat token and the loaded audit.</li>
            <li>Download the audit JSON first if you want a permanent record.</li>
          </ul>
        </>
      )}
      {!forget && lobby && (
        <>
          <p>Your seat will go to the house when the table casts off. You can rejoin with the table ID and code while the gangway is still open.</p>
          <p className="muted tiny">The host may cast off at any moment.</p>
        </>
      )}
      {!forget && !live && !fare && !settled && !lobby && (
        <p>This browser will forget the seat. The table itself is not deleted.</p>
      )}
    </Modal>
  );
}

export function ProfileModal({
  open, onClose, wallet, info, busy, error, onCreate, onFaucet, onRefresh, onForget,
}) {
  const address = info?.address ?? wallet?.address ?? '';
  const balance = info?.balanceZats;
  const faucetZats = info?.faucet?.zats ?? 5_000_000;
  const retryInMs = Math.max(0, Number(info?.faucet?.retryInMs ?? 0));
  const [remaining, setRemaining] = useState(retryInMs);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setRemaining(retryInMs); }, [retryInMs]);
  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1000)), 1000);
    return () => clearInterval(timer);
  }, [remaining > 0]);

  const copy = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
      .catch(() => setCopied(false));
  };
  const faucetLabel = remaining > 0
    ? `FAUCET IN ${String(Math.floor(remaining / 60000)).padStart(2, '0')}:${String(Math.ceil((remaining % 60000) / 1000)).padStart(2, '0')}`
    : `REQUEST ${(faucetZats / 1e8).toFixed(2)} TEST ZEC`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="REGTEST ONLY · HOUSE-CUSTODIED"
      title="TEST WALLET"
      actions={<button type="button" className="btn ghost" data-autofocus onClick={onClose}>CLOSE</button>}
    >
      <div className="wallet-warning">
        <strong>This is not a private wallet.</strong>
        <p>
          The house zecd wallet holds the key to this address. It exists only to exercise the
          shielded deposit and payout flow on the private regtest chain. It has no value, and it
          must never receive mainnet funds.
        </p>
        <p className="wallet-scope">
          Faucet ZEC funds a staked fare. That fare becomes your chip bankroll; a winning run
          pays the matched pot back to this test wallet. It is house-custodied test
          credit, not a private wallet, and it has no economic value.
        </p>
      </div>

      {error && <p className="wallet-error" role="alert">{error}</p>}

      {!wallet ? (
        <>
          <p className="muted">
            Create a test address, ask the regtest faucet for a little ZEC, and use it to walk the
            staked entry without an external wallet.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={busy} onClick={onCreate}>
              {busy ? 'OPENING A WALLET…' : 'CREATE TEST WALLET'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="wallet-field">
            <span className="wallet-label">SHIELDED TEST ADDRESS</span>
            <code className="wallet-address">{address || 'reading the wallet…'}</code>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={copy} disabled={!address}>
                {copied ? 'COPIED' : 'COPY ADDRESS'}
              </button>
              <button type="button" className="btn small ghost" onClick={onRefresh} disabled={busy}>
                REFRESH
              </button>
            </div>
          </div>

          <div className="wallet-balance">
            <div>
              <span className="wallet-label">TEST LEDGER BALANCE</span>
              <strong>{balance == null ? '—' : `${(balance / 1e8).toFixed(4)} ZEC`}</strong>
            </div>
            <span className="muted tiny">house-custodied regtest credit · no economic value</span>
          </div>

          <div className="btn-row">
            <button type="button" className="btn primary" onClick={onFaucet} disabled={busy || remaining > 0}>
              {busy ? 'SENDING…' : faucetLabel}
            </button>
          </div>
          <p className="muted tiny">
            The faucet sends shielded regtest ZEC to this address. It allows one request per minute.
          </p>
          <button type="button" className="wallet-forget" onClick={onForget}>FORGET THIS TEST WALLET</button>
        </>
      )}
    </Modal>
  );
}

export function Stars({ n = 0, max = 3 }) {
  const count = Math.max(0, Number(n) || 0);
  return (
    <span className="stars" aria-label={`${count} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`star ${i < count ? 'on' : ''}`} aria-hidden="true">★</span>
      ))}
    </span>
  );
}

export function useNow(interval = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
  return Date.now();
}

export function remainingMs(endsAt, serverNow, receivedAt) {
  if (!endsAt || !serverNow || !receivedAt) return null;
  return Math.max(0, endsAt - (Date.now() + (serverNow - receivedAt)));
}

const AUDIBLE_PHASES = new Set(['trade', 'challenge', 'play', 'reveal', 'duel_commit', 'duel_reveal']);

export function Clock({ state, receivedAt }) {
  useNow(250);
  const left = remainingMs(state?.phaseEndsAt, state?.serverNow, receivedAt);
  const cueKey = state?.phaseEndsAt ? `${state.phase}:${state.phaseEndsAt}` : '';
  const cues = useRef({ key: '', warned10: false, warned5: false, expired: false });

  // A new phase gets a fresh set of warnings.
  useEffect(() => {
    if (cues.current.key !== cueKey) {
      cues.current = { key: cueKey, warned10: false, warned5: false, expired: false };
    }
  }, [cueKey]);

  useEffect(() => {
    if (left == null || !AUDIBLE_PHASES.has(state?.phase)) return;
    const secs = Math.ceil(left / 1000);
    const cue = cues.current;
    if (secs <= 10 && secs > 0 && !cue.warned10) {
      cue.warned10 = true;
      playCue('warn');
    }
    if (secs <= 5 && secs > 0 && !cue.warned5) {
      cue.warned5 = true;
      playCue('urgent');
    }
    if (left <= 0 && !cue.expired) {
      cue.expired = true;
      playCue('expire');
    }
  }, [left, state?.phase]);

  if (left == null) return <span className="clock">—</span>;
  const secs = Math.ceil(left / 1000);
  const warning = secs <= 10 && secs > 3;
  const urgent = secs <= 3;
  return (
    <span className={`clock ${warning ? 'warn' : ''} ${urgent ? 'urgent' : ''}`.trim()} role="timer">
      {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}
    </span>
  );
}

export function PhaseLabel(state) {
  if (!state) return 'CONNECTING';
  if (state.status === 'awaiting_deposit') return 'THE FARE';
  if (state.status === 'cancelled') return 'THE GANGWAY CLOSED';
  if (state.status === 'lobby') return 'LOBBY';
  if (state.status === 'settled') return 'VOYAGE ENDED';
  if (state.status === 'finale') {
    if (state.phase === 'finale_intro') return 'ACT II — THE BACK ROOM';
    if (state.phase === 'duel_commit') return `DUEL ${state.finale?.round ?? ''} — BETS DOWN`;
    if (state.phase === 'duel_reveal') return `DUEL ${state.finale?.round ?? ''} — SHOW`;
    if (state.phase === 'duel_result') {
      const settledRound = state.finale?.lastRound?.round ?? state.finale?.round ?? '';
      return `DUEL ${settledRound} — SETTLEMENT`;
    }
    return 'ACT II';
  }
  // The engine advances the cycle counter as it settles, but the resolve
  // window belongs to the cycle that was just played.
  const cycleNo = state.phase === 'resolve' && state.cycle ? state.cycle - 1 : state.cycle;
  const cycle = cycleNo ? `CYCLE ${cycleNo}` : '';
  switch (state.phase) {
    case 'muster': return 'MUSTER — SEAL YOUR HAND';
    case 'trade': return `${cycle} — SIDE DEALS`;
    case 'challenge': return `${cycle} — NAME A SEAT`;
    case 'play': return `${cycle} — CARDS DOWN`;
    case 'reveal': return `${cycle} — SHOW`;
    case 'resolve': return `${cycle} — THE HOLD SETTLES`;
    case 'act1_end': return 'ACT I CLOSED';
    default: return state.phase?.toUpperCase() ?? '—';
  }
}

function timecode(t) {
  const secs = Math.max(0, Math.floor((Number(t) || 0) / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ pieces

export function LogPanel({ log }) {
  const ref = useRef(null);
  const last = log?.length ? log[log.length - 1].seq : 0;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <section className="log-panel panel">
      <header className="panel-head">
        <span>SHIP INTERCOM</span>
        <span className="panel-head-sub">REC</span>
      </header>
      <div className="log" ref={ref}>
        {(log ?? []).map((entry) => (
          <div key={entry.seq} className={`log-line kind-${entry.kind}`}>
            <span className="log-t">{timecode(entry.t)}</span>
            <span className="log-text">{entry.text}</span>
          </div>
        ))}
        {!log?.length && <div className="log-line kind-system"><span className="log-t">--:--</span><span className="log-text">The channel is open.</span></div>}
      </div>
    </section>
  );
}

export function SeatCard({ seat, youSeat, pair, isOpponent, bye }) {
  const you = seat.seat === youSeat;
  const dead = !seat.alive;
  const seatLabel = seat.seat < 0 ? 'HOUSE' : `SEAT ${seat.seat + 1}`;
  const shortHandle = seat.handle?.includes('/') ? seat.handle.split('/').slice(1).join('/').trim() : seat.handle;
  const kind = seat.seat < 0 ? 'THE HOUSE' : seat.isBot ? 'HOUSE' : 'PASSENGER';
  return (
    <div className={`seat-card ${you ? 'you' : ''} ${dead ? 'dead' : ''} ${pair ? 'pinned' : ''} ${isOpponent ? 'opponent' : ''} ${bye ? 'bye' : ''}`}>
      <div className="seat-top">
        <span className="seat-id">
          <span className="seat-kind">{kind}</span>
          <span className="seat-name">{shortHandle}{you ? ' · YOU' : ''}</span>
        </span>
        <span className="seat-num">{seatLabel}</span>
      </div>
      <div className="seat-mid">
        <Stars n={seat.stars} />
        <span className="seat-chips">{seat.chips ?? '—'} <small>CHIPS</small></span>
      </div>
      <div className="seat-bottom">
        <span>{seat.isBot ? 'HOUSE' : (seat.connected ? 'LINK' : 'NO LINK')}</span>
        <span>{seat.cardsLeft} <small>CARDS</small></span>
        {seat.handReady && <span className="tag">SEALED</span>}
        {dead && <span className="tag out">OUT</span>}
        {bye && <span className="tag">DECK</span>}
      </div>
    </div>
  );
}

export function SeatGrid({ state, youSeat }) {
  const pairFlat = (state.pairing ?? []).slice();
  return (
    <div className="seat-grid">
      {state.seats.map((seat) => (
        <SeatCard
          key={seat.seat}
          seat={seat}
          youSeat={youSeat}
          pair={pairFlat.includes(seat.seat)}
          isOpponent={state.opponent === seat.seat}
          bye={state.phase !== 'finale' && state.bye && state.you?.seat === seat.seat}
        />
      ))}
      {state.house && (
        <SeatCard
          seat={{ ...state.house, stars: 0, chips: 0, cardsLeft: 0, alive: true, connected: true, handReady: false }}
          youSeat={youSeat}
          pair={false}
        />
      )}
    </div>
  );
}

export function HandFan({ cards, used = [], selected = null, onSelect, disabled = false, compact = false }) {
  const usedSet = useMemo(() => new Set(used), [used]);
  return (
    <div className={`hand-fan ${compact ? 'compact' : ''}`}>
      {(cards ?? []).map((card, index) => {
        const spent = usedSet.has(index);
        const isSelected = selected === index;
        return (
          <button
            key={index}
            type="button"
            className={`card ${card} ${spent ? 'spent' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => !disabled && !spent && onSelect?.(index)}
            disabled={disabled || spent}
            aria-pressed={isSelected}
            aria-label={`${card} card${spent ? ', already played' : ''}`}
          >
            <span className="card-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="card-art"><CardArt card={card} /></span>
            <span className="card-name">{card.toUpperCase()}</span>
            {spent && <span className="card-spent">SPENT</span>}
          </button>
        );
      })}
      {!cards?.length && <div className="hand-empty">Your hand is not in this browser.</div>}
    </div>
  );
}

function OfferTerms({ side }) {
  return (
    <span className="terms">
      {side.stars ? `${side.stars}★` : ''}{side.stars && side.chips ? ' + ' : ''}{side.chips ? `${side.chips} chips` : ''}
      {!side.stars && !side.chips ? 'nothing' : ''}
    </span>
  );
}

// ------------------------------------------------------------------ landing

export function Landing({ config, onCreate, onJoin, busy, notice, initialJoin, onRules, onProfile }) {
  const [joinOpen, setJoinOpen] = useState(Boolean(initialJoin));
  const [tableId, setTableId] = useState(initialJoin ?? '');
  const [code, setCode] = useState('');
  const chain = config?.chain ?? {};
  const stake = config?.stake;

  return (
    <div className="landing">
      <header className="masthead">
        <div className="brand">
          <Logo size={42} decorative />
          <div className="brand-copy">
            <span className="brand-name">THE DERELICT</span>
            <span className="brand-sub">SURVIVAL GAMBLE · TWO ACTS</span>
          </div>
        </div>
        <div className="mast-meta">
          <button type="button" className="mast-link" onClick={onRules}>RULES</button>
          {chain.faucet && <button type="button" className="mast-link faucet-link" onClick={onProfile}>FAUCET</button>}
          <button type="button" className="mast-profile" onClick={onProfile} aria-label="Open the regtest test wallet">PROFILE</button>
          <span>ZECATHON BUILD</span>
          <span className={chain.enabled ? 'good' : 'dim'}>{chain.enabled ? `CHAIN ${String(chain.mode).toUpperCase()}` : 'CHAIN OFFLINE'}</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A SURVIVAL GAMBLE IN TWO ACTS</p>
          <h1>THE<br /><span>DERELICT</span></h1>
          <p className="lede">
            Four anonymous seats. Three stars each. A hand the table cannot read.
            Cut a private deal, name your opponent, spend a card.
            The last two walk into the back room — one Crown, one Rebel,
            and a card that pays double.
          </p>
          <div className="hero-rules">
            <span>ROCK · PAPER · SCISSORS</span>
            <span>3 STARS</span>
            <span>ONE TABLE</span>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn small ghost" onClick={onRules}>READ THE RULES</button>
            <span className="hero-hint">NO ACCOUNTS · NO FREE-TEXT CHAT</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hull">
            <div className="hull-line l1" />
            <div className="hull-line l2" />
            <div className="hull-line l3" />
            <div className="hull-stack s1" />
            <div className="hull-stack s2" />
            <div className="hull-light" />
            <div className="hull-water" />
          </div>
        </div>
      </section>

      {notice && <div className={`notice ${notice.tone ?? ''}`}>{notice.text}</div>}

      <section className="modes">
        <article className="mode-card">
          <header><span>01</span><h2>PRACTICE</h2></header>
          <p>One human seat against three house seats. Free. Starts immediately. The whole voyage, including the back room.</p>
          <ul>
            <li>Private hands, commit–reveal</li>
            <li>Side deals, dealer, loan shark</li>
            <li>Full post-match audit</li>
          </ul>
          <button type="button" className="btn primary" onClick={() => onCreate('practice')} disabled={busy}>
            {busy ? 'OPENING…' : 'TAKE A SEAT'}
          </button>
        </article>

        <article className="mode-card">
          <header><span>02</span><h2>PRIVATE</h2></header>
          <p>Open a table, share the code, let up to three other passengers in. Empty chairs are taken by the house when you cast off.</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => onCreate('private')} disabled={busy}>OPEN A TABLE</button>
            <button type="button" className="btn ghost" onClick={() => setJoinOpen((v) => !v)}>JOIN WITH CODE</button>
          </div>
          {joinOpen && (
            <form className="join-form" onSubmit={(e) => { e.preventDefault(); onJoin({ tableId: tableId.trim(), code: code.trim() }); }}>
              <label>TABLE ID<input value={tableId} onChange={(e) => setTableId(e.target.value)} placeholder="24 hex characters" autoComplete="off" /></label>
              <label>CODE<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="6 characters" maxLength={8} autoComplete="off" /></label>
              <button type="submit" className="btn primary" disabled={busy || !tableId || !code}>ENTER</button>
            </form>
          )}
        </article>

        <article className={`mode-card ${!chain.staked ? 'disabled' : ''}`}>
          <header><span>03</span><h2>STAKED</h2></header>
          <p>A solo run with a real shielded fare. The fare becomes your chip bankroll; every Act I deal and back-room bet moves its value. Win the duel and the house pays the matched pot. Custodial, not escrow.</p>
          <ul>
            <li>Entry: shielded ZEC + memo</li>
            <li>Stake {stake ? `${(stake.minZats / 1e8).toFixed(2)}–${(stake.maxZats / 1e8).toFixed(2)} ZEC` : '—'}</li>
            <li>House matches your bankroll in the back room</li>
          </ul>
          {chain.staked ? (
            <button type="button" className="btn primary" onClick={() => onCreate('solo')} disabled={busy}>
              {busy ? 'OPENING…' : 'STAKE A FARE'}
            </button>
          ) : (
            <div className="offline-note">CHAIN OFFLINE — free tables only</div>
          )}
        </article>
      </section>

      <section className="privacy-strip">
        <div>
          <h3>YOUR HAND IS YOURS</h3>
          <p>Each hand is committed as a Merkle root. The server sees only the cards you actually play, each with a proof — not the rest of the hand. After the voyage every hand is revealed so anyone can audit the table.</p>
        </div>
        <div>
          <h3>THE DEALER NEVER SEES THE REST</h3>
          <p>Offers are delivered only to the seat they name. Bets are sealed before the show. The dealer never learns your unused cards. No free-text chat — only canned intercom lines.</p>
        </div>
        <div>
          <h3>SETTLEMENT IS SHIELDED</h3>
          <p>Staked fares arrive at a fresh shielded address with a table-bound memo. Payouts leave to your unified address. No transparent addresses, no names, no accounts.</p>
        </div>
      </section>

      <footer className="landing-foot">
        <span>THE DERELICT · v1</span>
        <span>PRACTICE TABLES ARE PLAY MONEY. STAKED RUNS ARE A HACKATHON DEMO; WAGER ONLY WHAT YOU CAN LOSE.</span>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ deposit

export function DepositView({
  state, session, config, wallet, walletInfo, onWalletPay, onDemoFund, onWallet, onLeave, busy, notice,
}) {
  const deposit = session?.deposit;
  useNow(1000);
  if (!deposit) {
    return (
      <div className="center-screen">
        <div className="panel narrow">
          <h2>THE FARE</h2>
          <p>The table is waiting for a deposit record that this browser no longer has. Open a new run.</p>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={onLeave}>BACK TO THE HARBOUR</button>
          </div>
        </div>
      </div>
    );
  }
  const left = Math.max(0, Math.floor((deposit.expiresAt - Date.now()) / 1000));
  const usingWallet = Boolean(session?.walletPay);
  const walletBalance = Number(walletInfo?.balanceZats ?? 0);
  const enough = walletBalance >= Number(deposit.zats ?? 0);
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be denied */ }
  };
  return (
    <div className="center-screen">
      <div className="panel deposit">
        <p className="eyebrow">STAKED RUN · {state?.tableId ? short(session.tableId) : ''}</p>
        <h2>SEND THE FARE</h2>
        <p className="deposit-amount">{deposit.zec} <small>ZEC</small></p>
        <p className="muted">
          The fare is your bankroll: 40 Act I chips, then the back room rescales your surviving
          stack onto 100 chips and the house matches it. The table casts off when the fare confirms.
        </p>
        {usingWallet && (
          <div className="faucet demo-fare wallet-fare">
            <h3>TEST WALLET · PAY THE FARE</h3>
            <p>
              Your house-custodied test ledger holds{' '}
              <strong>{(walletBalance / 1e8).toFixed(4)} ZEC</strong>. Paying debits the fare
              and sends the real shielded transaction to this table&apos;s fresh address with the memo.
            </p>
            <button type="button" className="btn primary" onClick={onWalletPay} disabled={busy || !enough}>
              {busy ? 'SENDING…' : enough ? 'PAY THE FARE FROM TEST WALLET' : 'TEST WALLET SHORT'}
            </button>
            {!enough && (
              <p className="muted tiny">
                The ledger is short. Request test ZEC from the profile sheet, then come back.
              </p>
            )}
            <button type="button" className="btn small ghost" onClick={onWallet}>OPEN TEST WALLET</button>
          </div>
        )}
        {!usingWallet && config?.chain?.faucet && (
          <div className="faucet demo-fare">
            <h3>REGTEST · LET THE HOUSE COVER THE FARE</h3>
            <p>This is a private regtest chain. The house sends the exact fare from its shielded bankroll to the deposit address with the memo, so you can walk the whole entry → voyage → payout round trip without an external wallet.</p>
            <button type="button" className="btn primary" onClick={onDemoFund} disabled={busy}>
              {busy ? 'SENDING…' : 'PAY THE FARE FROM THE HOUSE'}
            </button>
          </div>
        )}
        <div className="field-block">
          <label>SHIELDED ADDRESS</label>
          <div className="copy-row"><code>{deposit.address}</code><button type="button" className="btn small" onClick={() => copy(deposit.address)}>COPY</button></div>
        </div>
        <div className="field-block">
          <label>MEMO (REQUIRED)</label>
          <div className="copy-row"><code>{deposit.memo}</code><button type="button" className="btn small" onClick={() => copy(deposit.memo)}>COPY</button></div>
        </div>
        <div className="deposit-foot">
          <span>EXPIRES IN {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
          <span className="pulse-dot" /> WATCHING
        </div>
        {notice && <div className={`notice ${notice.tone ?? ''}`}>{notice.text}</div>}
        <div className="btn-row deposit-leave">
          <button type="button" className="btn small ghost" onClick={onLeave}>LEAVE THE FARE</button>
          <span className="muted tiny">If you already sent the payment, stay until it confirms.</span>
        </div>
      </div>
    </div>
  );
}

function short(id) { return String(id ?? '').slice(0, 8); }

// ------------------------------------------------------------------ stake

export function StakePrompt({ config, wallet, walletInfo, onSubmit, onCancel, onWallet, busy, notice }) {
  const minZats = config?.stake?.minZats ?? 1_000_000;
  const maxZats = config?.stake?.maxZats ?? 20_000_000;
  const min = minZats / 1e8;
  const max = maxZats / 1e8;
  const startChips = config?.stake?.startChips ?? 40;
  const duelChips = config?.stake?.duelStartChips ?? 100;
  const defaultFare = Math.min(Math.max(0.05, min), max);
  const [zecAmount, setZecAmount] = useState(String(defaultFare));
  const [ua, setUa] = useState('');
  const [payFromWallet, setPayFromWallet] = useState(Boolean(wallet?.address));
  useEffect(() => { if (wallet?.address) setPayFromWallet(true); }, [wallet?.address]);

  const zats = Math.round(Number(zecAmount) * 1e8);
  const valid = Number.isInteger(zats) && zats >= minZats && zats <= maxZats;
  const balance = Number(walletInfo?.balanceZats ?? 0);
  const enough = !payFromWallet || balance >= zats;
  const chipZec = valid ? zats / startChips / 1e8 : null;
  const canSubmit = valid && enough && (payFromWallet ? Boolean(wallet?.address) : Boolean(ua.trim()));
  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(payFromWallet
      ? { stakeZats: zats, ua: wallet.address, walletToken: wallet.token }
      : { stakeZats: zats, ua: ua.trim() });
  };

  return (
    <div className="center-screen">
      <form className="panel stake" onSubmit={submit}>
        <h2>CHOOSE YOUR ENTRY FARE</h2>
        <p className="muted">
          This is the ZEC amount you pay to enter. It buys {startChips} Act I chips and is held by the
          house as your bankroll. Your chips and stars change during the voyage; they are not separate
          ZEC transactions.
        </p>
        <div className="field-block">
          <label htmlFor="stake-fare">ENTRY AMOUNT · {min.toFixed(2)}–{max.toFixed(2)} ZEC</label>
          <input id="stake-fare" type="number" step="0.0001" min={min} max={max} value={zecAmount} onChange={(e) => setZecAmount(e.target.value)} />
        </div>
        <p className="stake-breakdown">
          At this fare, each Act I chip represents {chipZec == null ? '—' : `${chipZec.toFixed(5)} ZEC`}.
        </p>
        <div className="stake-outcome">
          <strong>HOW THE PAYOUT WORKS</strong>
          <p>
            At the back room, your surviving chips become your bankroll, shown as {duelChips} duel chips.
            The house matches that bankroll. Win and you receive both; tie and you get your bankroll
            back; lose and there is no payout.
          </p>
        </div>

        {wallet?.address ? (
          <div className="wallet-choice">
            <label className={payFromWallet ? 'on' : ''}>
              <input type="radio" name="fare-source" checked={payFromWallet} onChange={() => setPayFromWallet(true)} />
              PAY WITH TEST WALLET
            </label>
            <span className="muted tiny">
              ledger {(balance / 1e8).toFixed(4)} ZEC · {wallet.address.slice(0, 16)}…
            </span>
            <button type="button" className="btn small ghost" onClick={onWallet}>FAUCET / PROFILE</button>
            <label className={!payFromWallet ? 'on' : ''}>
              <input type="radio" name="fare-source" checked={!payFromWallet} onChange={() => setPayFromWallet(false)} />
              PAY WITH EXTERNAL WALLET
            </label>
            {!payFromWallet && (
              <div className="field-block">
                <label>SHIELDED ADDRESS FOR YOUR PAYOUT</label>
                <input value={ua} onChange={(e) => setUa(e.target.value)} placeholder="u1…" autoComplete="off" spellCheck={false} />
                <p className="muted tiny">Enter a Unified Address (u1…) or Sapling address (zs…). You will need to send the fare with the table memo.</p>
              </div>
            )}
            {payFromWallet && !enough && (
              <p className="wallet-short">
                The test ledger is short by {((zats - balance) / 1e8).toFixed(4)} ZEC. Use the
                faucet, or pay from an external wallet.
              </p>
            )}
          </div>
        ) : (
          <div className="field-block">
            <label>SHIELDED ADDRESS FOR YOUR PAYOUT</label>
            <input value={ua} onChange={(e) => setUa(e.target.value)} placeholder="u1…" autoComplete="off" spellCheck={false} />
            <p className="muted tiny">Enter a Unified Address (u1…) or Sapling address (zs…). You will need to send the fare with the table memo. Create a test wallet from PROFILE to pay without an external wallet.</p>
          </div>
        )}

        <p className="muted tiny">The house holds the fare; it is not protected by an escrow contract. Regtest demo only—never use a funded wallet.</p>
        {notice && <div className={`notice ${notice.tone ?? ''}`}>{notice.text}</div>}
        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={busy || !canSubmit}>{busy ? 'OPENING…' : 'OPEN THE TABLE'}</button>
          <button type="button" className="btn ghost" onClick={onCancel}>BACK</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ lobby

export function LobbyView({ state, session, onStart, onLeave, onCopy }) {
  const host = session.seat === 0;
  const link = `${location.origin}/?join=${session.tableId}`;
  const empty = Math.max(0, 4 - state.seats.length);
  const [castOpen, setCastOpen] = useState(false);
  const castOff = () => {
    if (empty > 0) setCastOpen(true);
    else onStart();
  };
  return (
    <div className="center-screen">
      <div className="panel lobby">
        <p className="eyebrow">PRIVATE TABLE</p>
        <h2>THE GANGWAY IS OPEN</h2>
        <div className="lobby-code">
          <span>CODE</span>
          <strong>{state.code}</strong>
          <button type="button" className="btn small" onClick={() => onCopy(state.code)}>COPY</button>
        </div>
        <div className="lobby-seats">
          {Array.from({ length: state.seats.length || 4 }, (_, i) => state.seats[i] ?? { seat: i, handle: 'EMPTY', alive: true, stars: 0 }).map((s, i) => (
            <div key={s.seat ?? i} className={`lobby-seat ${s.handle === 'EMPTY' ? 'empty' : ''}`}>
              <span className="seat-num">SEAT {i + 1}</span>
              <span>{s.handle ?? 'EMPTY'}</span>
            </div>
          ))}
        </div>
        <p className="muted">
          Share the table ID and code, or send the link below. Empty chairs are taken by the house
          when you cast off. If you are waiting for passengers, keep the gangway open.
        </p>
        <div className="copy-row"><code className="link-code">{link}</code><button type="button" className="btn small" onClick={() => onCopy(link)}>COPY LINK</button></div>
        <div className="btn-row">
          {host
            ? <button type="button" className="btn primary" onClick={castOff}>CAST OFF</button>
            : <span className="waiting">WAITING FOR THE HOST TO CAST OFF…</span>}
          <button type="button" className="btn ghost" onClick={onLeave}>LEAVE</button>
        </div>
        <p className="muted tiny">Table ID: <code>{session.tableId}</code></p>
      </div>
      <Modal
        open={castOpen}
        onClose={() => setCastOpen(false)}
        eyebrow="CAST OFF"
        title={empty === 1 ? 'ONE CHAIR IS EMPTY' : `${empty} CHAIRS ARE EMPTY`}
        tone="danger"
        actions={(
          <>
            <button type="button" className="btn ghost" data-autofocus onClick={() => setCastOpen(false)}>HOLD THE GANGWAY</button>
            <button type="button" className="btn danger" onClick={() => { setCastOpen(false); onStart(); }}>CAST OFF ANYWAY</button>
          </>
        )}
      >
        <p>
          The house will take {empty === 1 ? 'the empty chair' : 'the empty chairs'} and play to win.
          Your own seat stays yours; the house does not take it.
        </p>
        <p className="muted">
          If friends are still on their way, close this and share the table link. The lobby waits.
        </p>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ act I panels

export function TradePanel({ state, onOffer, onRespond, onDealer, onLoan, onTaunt, busy }) {
  const you = state.you;
  const others = state.seats.filter((s) => s.alive && s.seat !== you.seat);
  const [to, setTo] = useState(others[0]?.seat ?? null);
  const [giveStars, setGiveStars] = useState(0);
  const [giveChips, setGiveChips] = useState(5);
  const [wantStars, setWantStars] = useState(0);
  const [wantChips, setWantChips] = useState(0);
  const [taunt, setTaunt] = useState(0);
  const [loanOpen, setLoanOpen] = useState(false);
  useEffect(() => {
    if (to == null || !others.some((s) => s.seat === to)) setTo(others[0]?.seat ?? null);
  }, [others.map((s) => s.seat).join(','), to]);
  useEffect(() => {
    if (loanOpen && (you.debt > 0 || busy)) setLoanOpen(false);
  }, [loanOpen, you.debt, busy]);

  if (!you.alive) return <div className="panel action-panel"><p className="muted">You are out. The table still deals; watch the audit.</p></div>;

  const offerDisabled = to == null || busy || (giveStars + giveChips + wantStars + wantChips === 0);
  return (
    <div className="action-panel-stack">
      <section className="panel action-panel">
        <header className="panel-head"><span>SIDE DEALS</span><span className="panel-head-sub">SEALED NOTES</span></header>
        <p className="muted tiny trade-economy-note">
          Deals and dealer trades move chips or stars, never ZEC directly. In a staked run, your
          remaining chips determine your ZEC bankroll; in free tables, chips have no cash value.
        </p>
        {!!state.offersToYou?.length && (
          <div className="offers">
            {state.offersToYou.map((o) => (
              <div key={o.id} className="offer incoming">
                <div className="offer-head"><strong>{o.fromName}</strong> offers</div>
                <div className="offer-terms">They put up <OfferTerms side={o.give} /> · they want <OfferTerms side={o.want} /></div>
                <div className="btn-row">
                  <button type="button" className="btn small primary" disabled={busy} onClick={() => onRespond(o.id, true)}>ACCEPT</button>
                  <button type="button" className="btn small ghost" disabled={busy} onClick={() => onRespond(o.id, false)}>REFUSE</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!!state.yourOffers?.length && (
          <div className="offers">
            {state.yourOffers.map((o) => (
              <div key={o.id} className="offer outgoing">
                <div className="offer-head">TO <strong>{o.toName}</strong></div>
                <div className="offer-terms">You put up <OfferTerms side={o.give} /> · you want <OfferTerms side={o.want} /></div>
                <div className="muted tiny">AWAITING AN ANSWER</div>
              </div>
            ))}
          </div>
        )}
        <form className="offer-form" onSubmit={(e) => { e.preventDefault(); onOffer({ to, give: { stars: giveStars, chips: giveChips }, want: { stars: wantStars, chips: wantChips } }); }}>
          <div className="form-row">
            <label>TO
              <select value={to ?? ''} onChange={(e) => setTo(Number(e.target.value))}>
                {others.map((s) => <option key={s.seat} value={s.seat}>{s.handle} (★{s.stars})</option>)}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>YOU GIVE ★<input type="number" min="0" max={you.stars - 1} value={giveStars} onChange={(e) => setGiveStars(Math.max(0, Number(e.target.value) || 0))} /></label>
            <label>YOU GIVE CHIPS<input type="number" min="0" max={you.chips} value={giveChips} onChange={(e) => setGiveChips(Math.max(0, Number(e.target.value) || 0))} /></label>
            <label>YOU WANT ★<input type="number" min="0" max="6" value={wantStars} onChange={(e) => setWantStars(Math.max(0, Number(e.target.value) || 0))} /></label>
            <label>YOU WANT CHIPS<input type="number" min="0" max="500" value={wantChips} onChange={(e) => setWantChips(Math.max(0, Number(e.target.value) || 0))} /></label>
          </div>
          <button type="submit" className="btn small primary" disabled={offerDisabled}>SEND SEALED NOTE</button>
          <p className="muted tiny">A deal may not leave either seat at zero stars. Three notes per cycle.</p>
        </form>
      </section>

      <section className="panel action-panel dealer">
        <header className="panel-head"><span>THE DEALER</span><span className="panel-head-sub">NO CREDIT</span></header>
        <div className="btn-row">
          <button type="button" className="btn small" disabled={busy || you.stars <= 1} onClick={() => onDealer('buy_star')}>SELL ★ · +20 CHIPS</button>
          <button type="button" className="btn small" disabled={busy || you.chips < 50} onClick={() => onDealer('sell_star')}>BUY ★ · −50 CHIPS</button>
        </div>
        <div className="loan-row">
          <span>NOTE: +40 CHIPS, OWE 64 AT ACT I END</span>
          <button type="button" className="btn small danger" disabled={busy || you.debt > 0} onClick={() => setLoanOpen(true)}>
            {you.debt > 0 ? 'SIGNED' : 'SIGN THE NOTE'}
          </button>
        </div>
        {you.debt > 0 && <p className="muted tiny">Debt {you.debt} chips. If you cannot cover it when Act I closes, you are seized.</p>}
        <div className="form-row taunt-row">
          <label>INTERCOM
            <select value={taunt} onChange={(e) => setTaunt(Number(e.target.value))}>
              {TAUNTS.map((line, i) => <option key={i} value={i}>{line}</option>)}
            </select>
          </label>
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => onTaunt(taunt)}>SAY IT</button>
        </div>
      </section>

      <Modal
        open={loanOpen}
        onClose={() => setLoanOpen(false)}
        eyebrow="THE LOAN SHARK · NO CREDIT"
        title="SIGN THE NOTE?"
        tone="danger"
        actions={(
          <>
            <button type="button" className="btn ghost" data-autofocus onClick={() => setLoanOpen(false)}>NOT YET</button>
            <button type="button" className="btn danger" onClick={() => { setLoanOpen(false); onLoan(); }}>SIGN IT</button>
          </>
        )}
      >
        <div className="modal-terms">
          <div className="term-box"><span>YOU RECEIVE NOW</span><b>+40</b><small>CHIPS</small></div>
          <div className="term-box debt"><span>YOU OWE AT ACT I END</span><b>64</b><small>CHIPS</small></div>
        </div>
        <div className="modal-warning">
          <strong>The note comes due when the hold closes.</strong>
          <p>If you cannot cover 64 chips, the shark seizes what you have and you leave the voyage.</p>
        </div>
        <p>A signed note cannot be cancelled. The chips are yours to trade, buy a star with, or lose at the table.</p>
      </Modal>
    </div>
  );
}

export function ChallengePanel({ state, onChallenge, busy }) {
  const options = state.seats.filter((s) => s.alive && s.cardsLeft > 0 && s.seat !== state.you.seat);
  return (
    <section className="panel action-panel">
      <header className="panel-head"><span>NAME A SEAT</span><span className="panel-head-sub">THE DECK WILL PAIR YOU</span></header>
      <div className="challenge-grid">
        {options.map((s) => (
          <button key={s.seat} type="button" className="challenge-seat" disabled={busy} onClick={() => onChallenge(s.seat)}>
            <strong>{s.handle}</strong>
            <span>{s.stars}★ · {s.cardsLeft} cards</span>
          </button>
        ))}
        {!options.length && <p className="muted">No seat can answer.</p>}
      </div>
      <button type="button" className="btn ghost small" disabled={busy} onClick={() => onChallenge(null)}>LET THE DECK DECIDE</button>
    </section>
  );
}

export function PlayPanel({ state, hands, selected, setSelected, onCommit, busy }) {
  const you = state.you;
  const opp = state.seats.find((s) => s.seat === state.opponent);
  if (!you.alive) return <div className="panel action-panel"><p className="muted">You are out.</p></div>;
  if (!state.pairing) {
    return (
      <div className="panel action-panel">
        <header className="panel-head"><span>THE DECK HOLDS YOU</span><span className="panel-head-sub">NO PAIR THIS CYCLE</span></header>
        <p className="muted">You sit this one out. Watch the stars move.</p>
      </div>
    );
  }
  const committed = state.yourPlay?.committed;
  const revealed = state.yourPlay?.revealed;
  const phase = state.phase;
  return (
    <section className="panel action-panel play-panel">
      <header className="panel-head">
        <span>YOU vs {opp?.handle ?? '—'}</span>
        <span className="panel-head-sub">{phase === 'play' ? (committed ? 'YOUR CARD IS SEALED' : 'CHOOSE ONE') : phase === 'reveal' ? (revealed ? 'CARD SHOWN' : 'SHOW') : 'THE HOLD'}</span>
      </header>
      <HandFan cards={hands.act1?.cards} used={hands.usedRps} selected={selected} onSelect={setSelected} disabled={busy || committed || phase !== 'play'} />
      <div className="play-foot">
        <div className="opp-state">
          {opp ? <>OPPONENT: <strong>{opp.handle}</strong> · {state.opponentPlay?.revealed ? 'SHOWN' : state.opponentPlay?.committed ? 'SEALED' : 'THINKING'}</> : '—'}
        </div>
        {phase === 'play' && (
          <button type="button" className="btn primary" disabled={busy || committed || selected == null} onClick={() => onCommit(selected)}>
            {committed ? 'SEALED' : `SEAL ${selected != null ? hands.act1?.cards[selected]?.toUpperCase() : 'CARD'}`}
          </button>
        )}
        {phase === 'reveal' && <span className={`tag ${revealed ? 'good' : 'warn'}`}>{revealed ? 'YOUR CARD IS IN THE LIGHT' : committed ? 'SHOWING…' : 'NO COMMITMENT — FORFEIT'}</span>}
      </div>
    </section>
  );
}

export function WaitingPanel({ state }) {
  const texts = {
    muster: 'Sealing hands. The table will open when every seat is ready.',
    resolve: 'The hold settles. Stars move.',
    act1_end: 'Act I is closed. The back room is being prepared.',
    finale_intro: 'The back room. Two seats. One Crown, one Rebel.',
    settled: 'The voyage is over.',
  };
  return (
    <section className="panel action-panel">
      <header className="panel-head"><span>{PhaseLabel(state)}</span><span className="panel-head-sub">HOLD</span></header>
      <p className="muted">{texts[state.phase] ?? 'The table is moving.'}</p>
    </section>
  );
}

// The resolve window is the only moment the player learns the round outcome.
// Make it unmissable: who won, the two cards, and the star that moved.
export function RoundResult({ state }) {
  const you = state.you;
  if (!you) return null;
  if (!you.alive) {
    return (
      <section className="panel round-result lose" role="status">
        <p className="round-kicker">CYCLE {state.cycle ? state.cycle - 1 : ''} · THE HOLD SETTLES</p>
        <h2>YOU ARE OUT</h2>
        <p className="round-detail">Zero stars. The table plays on without you.</p>
      </section>
    );
  }
  if (state.bye) {
    return (
      <section className="panel round-result tie" role="status">
        <p className="round-kicker">CYCLE {state.cycle ? state.cycle - 1 : ''} · THE HOLD SETTLES</p>
        <h2>BYE — THE DECK HOLDS YOU</h2>
        <p className="round-detail">No pair this cycle. Your stars and chips stay put.</p>
      </section>
    );
  }
  const rec = state.lastRound;
  if (!rec) return null;
  const side = rec.pair?.[0] === you.seat ? 'a' : 'b';
  const other = side === 'a' ? 'b' : 'a';
  const oppSeat = rec.pair?.[side === 'a' ? 1 : 0];
  const opp = state.seats.find((s) => s.seat === oppSeat);
  const oppName = opp?.handle ?? 'THE OTHER SEAT';
  const yourCard = rec.cards?.[side]?.toUpperCase() ?? 'NO CARD';
  const oppCard = rec.cards?.[other]?.toUpperCase() ?? 'NO CARD';
  const delta = (rec.starsAfter?.[side] ?? 0) - (rec.starsBefore?.[side] ?? 0);
  const starsNow = rec.starsAfter?.[side] ?? you.stars;

  let tone = 'tie';
  let title = 'TIE — NO STAR MOVES';
  if (rec.outcome === 'both-forfeit') {
    tone = 'lose';
    title = 'BOTH FROZE — A STAR BURNS FROM EACH';
  } else if (rec.outcome === `forfeit-${you.seat}`) {
    tone = 'lose';
    title = 'YOU DID NOT SHOW — A STAR IS LOST';
  } else if (rec.outcome === `forfeit-${oppSeat}`) {
    tone = 'win';
    title = 'NO-SHOW — YOU TAKE A STAR';
  } else if (rec.outcome === side) {
    tone = 'win';
    title = 'YOU WIN THE ROUND';
  } else if (rec.outcome === other) {
    tone = 'lose';
    title = 'YOU LOSE THE ROUND';
  }

  const starLine = delta > 0 ? '+1 STAR' : delta < 0 ? '−1 STAR' : 'NO STAR MOVES';
  return (
    <section className={`panel round-result ${tone}`} role="status">
      <p className="round-kicker">CYCLE {rec.cycle ?? state.cycle} · THE HOLD SETTLES</p>
      <h2>{title}</h2>
      <p className="round-cards">
        <span>YOU <b>{yourCard}</b></span>
        <span className="round-vs">VS</span>
        <span>{oppName} <b>{oppCard}</b></span>
      </p>
      <p className={`round-detail ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
        {starLine} · YOU NOW HOLD {starsNow} {starsNow === 1 ? 'STAR' : 'STARS'}
      </p>
      {!you.alive && <p className="round-out">ZERO STARS — OUT OF THE HOLD</p>}
    </section>
  );
}

// ------------------------------------------------------------------ finale

export function FinalePanel({ state, hands, selected, setSelected, bet, setBet, onCommit, busy }) {
  const f = state.finale;
  const you = state.you;
  if (!f) return null;
  const side = f.yourSide;
  const nameFor = (s) => f.names?.[s] ?? (f[s] === -1 ? 'THE HOUSE' : `SEAT ${f[s] + 1}`);
  const rounds = f.rounds ?? [];
  const yourChips = side ? f.yourChips : null;
  const maxBet = Math.max(0, Math.min(20, yourChips ?? 0));
  const isCommit = state.phase === 'duel_commit';
  const committed = f.yourCommitted;
  const revealed = f.yourRevealed;
  const playing = side && you.alive;
  const used = hands.usedDuel ?? [];
  // While the round settles, the board still belongs to the round just played.
  const shownRound = state.phase === 'duel_result' && f.lastRound ? f.lastRound.round : f.round;

  return (
    <section className="finale">
      <div className="finale-head">
        <p className="eyebrow">ACT II · THE BACK ROOM</p>
        <h2>THE E-CARD DUEL</h2>
        <p className="muted">Crown beats Citizen. Citizen beats Rebel. Rebel beats Crown. A Rebel win pays double. Five rounds, five cards, hidden bets.</p>
        {f.bankrollZats > 0 && (
          <p className="duel-value">
            BANKROLL {zec(f.bankrollZats)} ZEC · EACH CHIP {zec(f.bankrollZats / 100)} ZEC ·
            MATCHED POT {zec(f.potZats ?? f.bankrollZats * 2)} ZEC
          </p>
        )}
      </div>
      <div className="duel-board">
        <DuelSide
          side="a"
          name={nameFor('a')}
          role={f.roles?.a}
          chips={f.chips?.a ?? rounds[rounds.length - 1]?.chipsAfter?.a ?? 100}
          you={side === 'a'}
          sealed={f.committed?.a}
          revealed={f.revealed?.a}
        />
        <div className="duel-center">
          <span className="duel-vs">VS</span>
          <span className="duel-round">ROUND {Math.min(shownRound ?? 1, 5)} / 5</span>
          <span className={`tag ${f.yourCommitted ? 'good' : ''}`}>{f.yourCommitted ? 'YOUR BET IS SEALED' : 'BETS OPEN'}</span>
        </div>
        <DuelSide
          side="b"
          name={nameFor('b')}
          role={f.roles?.b}
          chips={f.chips?.b ?? rounds[rounds.length - 1]?.chipsAfter?.b ?? 100}
          you={side === 'b'}
          sealed={f.committed?.b}
          revealed={f.revealed?.b}
        />
      </div>

      {state.phase === 'duel_result' && <DuelCallout f={f} />}

      {playing && (
        <div className="panel action-panel duel-actions">
          <header className="panel-head">
            <span>YOUR HAND · {String(f.yourRole ?? '').toUpperCase()}</span>
            <span className="panel-head-sub">{isCommit ? (committed ? 'SEALED' : 'PLACE A CARD AND A BET') : state.phase === 'duel_reveal' ? 'SHOW' : 'ROUND SETTLING'}</span>
          </header>
          <HandFan cards={hands.duel?.cards} used={used} selected={selected} onSelect={setSelected} disabled={busy || committed || !isCommit} compact />
          <div className="bet-row">
            <label>BET <input type="number" min="0" max={maxBet} value={bet} onChange={(e) => setBet(Math.max(0, Math.min(maxBet, Number(e.target.value) || 0)))} disabled={!isCommit || committed} /></label>
            <span className="muted tiny">
              MAX {maxBet} · YOUR STACK {yourChips}
              {f.bankrollZats > 0 ? ` · ${zec((yourChips * f.bankrollZats) / 100)} ZEC` : ''}
            </span>
            <button type="button" className="btn primary" disabled={busy || committed || !isCommit || selected == null} onClick={() => onCommit(selected, bet)}>
              {committed ? 'SEALED' : 'SEAL CARD + BET'}
            </button>
          </div>
          {state.phase === 'duel_reveal' && !revealed && <p className="muted">Showing your card. The other side is showing too.</p>}
        </div>
      )}

      {!playing && (
        <div className="panel action-panel">
          <p className="muted">You are not in the back room. The two survivors settle it in the dark.</p>
        </div>
      )}

      {!!rounds.length && (
        <div className="panel duel-history">
          <header className="panel-head"><span>THE ROUNDS</span><span className="panel-head-sub">REVEALED</span></header>
          <table>
            <thead><tr><th>#</th><th>{nameFor('a')}</th><th>{nameFor('b')}</th><th>OUTCOME</th><th>CHIPS</th></tr></thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.round}>
                  <td>{r.round}</td>
                  <td>{r.cards?.a?.toUpperCase()} · {r.bets?.a}</td>
                  <td>{r.cards?.b?.toUpperCase()} · {r.bets?.b}</td>
                  <td>{r.outcome === 'tie' ? 'TIE' : `${r.outcome?.toUpperCase()} · ${r.transfer ? `+${r.transfer}${r.multiplier === 2 ? ' ×2' : ''}` : 'NO MATCH'}`}</td>
                  <td>{r.chipsAfter?.a} / {r.chipsAfter?.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DuelCallout({ f }) {
  const r = f.lastRound;
  const side = f.yourSide;
  if (!r || !side) return null;
  const other = side === 'a' ? 'b' : 'a';
  const mine = r.cards?.[side]?.toUpperCase() ?? 'NO CARD';
  const theirs = r.cards?.[other]?.toUpperCase() ?? 'NO CARD';
  const myBet = r.bets?.[side] ?? 0;
  const theirBet = r.bets?.[other] ?? 0;
  const amount = r.transfer ?? 0;
  const won = r.outcome === side;
  const tie = r.outcome === 'tie';
  // A round can be won with no chips matched when the other side bets zero.
  // That is still a won round — do not dress it up as a tie.
  const noMoney = !tie && amount === 0;
  const roleFor = (s) => String(f.roles?.[s] ?? '').toUpperCase();
  const nameFor = (s) => f.names?.[s] ?? (f[s] === -1 ? 'THE HOUSE' : `SEAT ${f[s] + 1}`);
  const title = tie
    ? 'ROUND TIE — NO CHIPS MOVE'
    : won
      ? (noMoney ? 'YOU WIN THE ROUND — NO CHIPS MATCHED' : 'YOU WIN THE ROUND')
      : (noMoney ? 'YOU LOSE THE ROUND — NO CHIPS MATCHED' : 'YOU LOSE THE ROUND');
  const money = tie || noMoney ? '' : `${won ? '+' : '−'}${amount} CHIP${amount === 1 ? '' : 'S'}${won && r.multiplier === 2 ? ' · REBEL ×2' : ''}`;
  return (
    <div className={`duel-callout ${tie ? 'tie' : won ? 'win' : 'lose'}`} role="status">
      <p className="round-kicker">ROUND {r.round ?? f.round} · THE BACK ROOM SETTLES</p>
      <h3>{title}{money ? ` · ${money}` : ''}</h3>
      <p className="round-cards">
        <span>YOU <b>{mine}</b> · BET {myBet}</span>
        <span className="round-vs">VS</span>
        <span>{nameFor(other)} <b>{theirs}</b> · BET {theirBet}</span>
      </p>
      <p className="round-detail">
        {roleFor(side)} VS {roleFor(other)} · STACKS {r.chipsAfter?.a} / {r.chipsAfter?.b}
      </p>
    </div>
  );
}

function DuelSide({ name, role, chips, you, sealed, revealed }) {
  return (
    <div className={`duel-side ${you ? 'you' : ''} role-${role}`}>
      <span className="duel-seat">{you ? 'YOU' : 'SEAT'}</span>
      <strong className="duel-name">{name}</strong>
      <span className={`duel-role ${role}`}>{String(role ?? '').toUpperCase()}</span>
      <div className="duel-chips">{chips} <small>CHIPS</small></div>
      <div className="card-backs" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => <span key={i} className={`card-back ${sealed ? 'sealed' : ''} ${revealed ? 'open' : ''}`} />)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ result

export function ResultPanel({ state, audit, verdict, verifying, onDownload, onLeave, onAgain }) {
  const winner = state.settlement?.winnerSeat;
  const youWon = winner === state.you?.seat;
  const split = state.settlement?.split;
  const houseWon = state.settlement?.houseWon;
  const staked = state.mode === 'solo' && (state.settlement?.bankrollZats ?? 0) > 0;
  const title = split
    ? 'THE POT IS SPLIT'
    : houseWon
      ? (staked ? 'THE HOUSE KEEPS THE POT' : 'THE HOUSE TAKES THE BACK ROOM')
      : youWon
        ? (staked ? 'YOU TAKE THE POT' : 'YOU TAKE THE BACK ROOM')
        : `${nameOf(state, winner)} ${staked ? 'TAKES THE POT' : 'TAKES THE BACK ROOM'}`;

  // A verdict that reads at a glance, before any of the ledger detail.
  let verdictTone = 'lose';
  let verdictHead = 'YOU LOST';
  let verdictDetail = 'The back room went to another seat.';
  if (!state.you || !state.you.alive) {
    verdictHead = 'YOU WERE ELIMINATED';
    verdictDetail = staked
      ? 'Zero stars in Act I. Your fare stayed with the house.'
      : 'Zero stars in Act I. You never reached the back room.';
  } else if (!state.yourSide) {
    verdictHead = 'YOU MISSED THE BACK ROOM';
    verdictDetail = 'You survived Act I, but only the top two seats advanced.';
  } else if (split) {
    verdictTone = 'tie';
    verdictHead = 'THE POT IS SPLIT — YOUR BANKROLL COMES BACK';
    verdictDetail = state.settlement?.payoutZats > 0
      ? `${zec(state.settlement.payoutZats)} ZEC is being returned to you.`
      : 'Both stacks stand equal. No side takes the pot.';
  } else if (youWon) {
    verdictTone = 'win';
    verdictHead = 'YOU WON';
    verdictDetail = staked ? 'You took the back room and the matched pot.' : 'You won the back room.';
  } else {
    verdictHead = 'YOU LOST THE BACK ROOM';
    verdictDetail = staked && houseWon
      ? 'The house took the back room and kept your fare.'
      : `${nameOf(state, winner)} took the back room.`;
  }
  const standings = [...state.seats].sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.stars - a.stars || (a.seat - b.seat));
  return (
    <div className="result">
      <p className="eyebrow">VOYAGE ENDED · {short(state.id)}</p>
      <h2 className={youWon ? 'win' : ''}>{title}</h2>
      <p className={`result-verdict ${verdictTone}`} role="status">{verdictHead}</p>
      <p className="result-verdict-detail">{verdictDetail}</p>
      {state.mode === 'solo' && state.settlement?.bankrollZats > 0 && (
        <p className="result-money">
          BANKROLL {zec(state.settlement.bankrollZats)} ZEC · MATCHED POT {zec(state.settlement.potZats ?? state.settlement.bankrollZats * 2)} ZEC
        </p>
      )}
      {state.settlement?.payoutZats > 0 && (
        <p className="payout">
          {zec(state.settlement.payoutZats)} ZEC · {state.settlement.status?.toUpperCase()}
          {state.settlement.txid ? ` · ${short(state.settlement.txid)}…` : ''}
          {state.settlement.walletCredited ? ' · CREDITED TO TEST WALLET' : ''}
        </p>
      )}
      {state.mode === 'solo' && state.settlement && !state.settlement.payoutZats && (
        <p className="muted tiny">The fare stayed with the house. A staked payout requires winning the back room.</p>
      )}
      <div className="standings">
        {standings.map((s) => (
          <div key={s.seat} className={`standing ${s.seat === winner ? 'winner' : ''} ${!s.alive ? 'dead' : ''}`}>
            <span className="seat-num">SEAT {s.seat + 1}</span>
            <span>{s.handle}{s.seat === state.you?.seat ? ' · YOU' : ''}</span>
            <Stars n={s.stars} />
            <span>{s.isBot ? 'HOUSE' : s.connected ? 'LINK' : 'NO LINK'}{!s.alive ? ' · OUT' : ''}</span>
          </div>
        ))}
      </div>
      {state.finale && (
        <p className="muted mono tiny">
          BACK ROOM · {state.finale.names?.a} {state.finale.chips?.a} — {state.finale.names?.b} {state.finale.chips?.b}
        </p>
      )}

      <div className={`panel audit-panel ${verdict?.ok ? 'ok' : verdict ? 'bad' : ''}`}>
        <header className="panel-head"><span>THE AUDIT</span><span className="panel-head-sub">{verifying ? 'VERIFYING…' : verdict?.ok ? 'OK' : verdict ? 'FAILED' : 'PENDING'}</span></header>
        {verifying && <p className="muted">Rebuilding every hand, proof and ledger locally…</p>}
        {!verifying && verdict && (
          <>
            <p className={verdict.ok ? 'good' : 'bad'}>
              {verdict.ok
                ? `Every hand rebuilds. Every play is inside its hand. The ledger balances. ${audit?.act1?.rounds?.length ?? 0} Act I rounds, ${audit?.finale?.rounds?.length ?? 0} duel rounds.`
                : `${verdict.errors.length} problem${verdict.errors.length === 1 ? '' : 's'} found. Do not trust this voyage.`}
            </p>
            {!verdict.ok && <ul className="audit-errors">{verdict.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>}
            <p className="muted tiny">Hands revealed: {audit?.complete ? 'all' : 'incomplete'} · audit document {audit ? 'present' : 'not yet served'}</p>
          </>
        )}
        {!verifying && !verdict && <p className="muted">The audit is not ready yet. Hands are revealed as the voyage closes.</p>}
        <div className="btn-row">
          <button type="button" className="btn small" disabled={!audit} onClick={onDownload}>DOWNLOAD AUDIT JSON</button>
          <button type="button" className="btn small ghost" onClick={onAgain}>NEW VOYAGE</button>
          <button type="button" className="btn small ghost" onClick={onLeave}>LEAVE</button>
        </div>
        <p className="muted tiny">Verify offline: <code>node scripts/verify-audit.mjs audit.json</code></p>
      </div>
    </div>
  );
}

function nameOf(state, seat) {
  if (state.finale?.winnerSeat === seat) return state.finale.names?.[state.finale.winner] ?? `SEAT ${seat + 1}`;
  return state.seats.find((s) => s.seat === seat)?.handle ?? (seat === -1 ? 'THE HOUSE' : `SEAT ${(seat ?? 0) + 1}`);
}

function zec(zats) { return (Number(zats) / 1e8).toFixed(8); }
