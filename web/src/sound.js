// Short synthesised cues for the table clock and round results.
//
// The browser will not let a page make noise before a gesture, so the App
// unlocks the context on the first pointer/key event. Everything here is a
// no-op when sound is muted or WebAudio is unavailable.

const STORAGE_KEY = 'derelict.sound.v1';
let context = null;
let muted = (() => {
  try { return localStorage.getItem(STORAGE_KEY) === 'off'; } catch { return false; }
})();

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = Boolean(next);
  try { localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on'); } catch { /* storage may be denied */ }
  if (!muted) unlockAudio();
}

export function unlockAudio() {
  const ctx = ensureContext();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

function ensureContext() {
  if (muted) return null;
  try {
    if (!context) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      context = new AudioCtor();
    }
    return context;
  } catch {
    return null;
  }
}

function tone(ctx, { freq, endFreq = null, dur = 0.08, type = 'square', gain = 0.035, at = 0 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export function playCue(name) {
  if (muted) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = 0;
  switch (name) {
    case 'phase':
      // A short two-note "look up" when a decision window opens.
      tone(ctx, { freq: 660, dur: 0.055, gain: 0.028 });
      tone(ctx, { freq: 880, dur: 0.07, gain: 0.03, at: 0.075 });
      break;
    case 'warn':
      // Ten seconds left.
      tone(ctx, { freq: 880, dur: 0.07, gain: 0.04 });
      tone(ctx, { freq: 880, dur: 0.07, gain: 0.04, at: 0.14 });
      break;
    case 'urgent':
      // Five seconds left.
      for (let i = 0; i < 3; i += 1) {
        tone(ctx, { freq: 1180, dur: 0.05, gain: 0.045, at: i * 0.11 });
      }
      break;
    case 'expire':
      // The window is gone.
      tone(ctx, { freq: 300, endFreq: 140, dur: 0.32, type: 'sawtooth', gain: 0.05, at: now });
      buzz(140);
      break;
    case 'roundwin':
      tone(ctx, { freq: 660, dur: 0.08, gain: 0.04 });
      tone(ctx, { freq: 990, dur: 0.12, gain: 0.045, at: 0.09 });
      break;
    case 'roundloss':
      tone(ctx, { freq: 392, dur: 0.1, gain: 0.04 });
      tone(ctx, { freq: 247, dur: 0.16, gain: 0.045, at: 0.1 });
      break;
    case 'tie':
      tone(ctx, { freq: 440, dur: 0.07, gain: 0.035 });
      tone(ctx, { freq: 440, dur: 0.09, gain: 0.035, at: 0.1 });
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((freq, i) => {
        tone(ctx, { freq, dur: 0.12, gain: 0.045, at: i * 0.1 });
      });
      buzz([40, 50, 80]);
      break;
    case 'lose':
      tone(ctx, { freq: 392, endFreq: 196, dur: 0.4, type: 'sawtooth', gain: 0.05 });
      buzz(180);
      break;
    default:
      break;
  }
}
