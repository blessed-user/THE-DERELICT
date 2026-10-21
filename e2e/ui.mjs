// Browser smoke test: open the built client against a compressed-clock server,
// play a practice voyage to settlement, and require the client-side audit to
// pass. Also grabs screenshots for review.
//
//   node e2e/ui.mjs

import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8794;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = join(ROOT, 'data-ui');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

await rm(DATA, { recursive: true, force: true });
await mkdir(DATA, { recursive: true });

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    PHASE_SCALE: '0.1',
    DATA_DIR: DATA,
    CHAIN_MODE: 'off',
    HTTP_LOG: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[srv] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error('server did not start');
}
await waitHealth();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('requestfailed', (req) => errors.push(`request failed: ${req.url()} ${req.failure()?.errorText}`));

const hasText = (t) => page.evaluate((needle) => document.body.innerText.includes(needle), t);
const waitText = async (needle, timeout = 25_000) => {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 100 }, needle);
};
const clickButton = async (test) => page.evaluate((src) => {
  const re = new RegExp(src);
  const buttons = [...document.querySelectorAll('button')];
  const el = buttons.find((b) => re.test(b.innerText.replace(/\s+/g, ' ').trim()) && !b.disabled);
  if (!el) return false;
  el.click();
  return true;
}, test.source);
const clickText = (text) => clickButton(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

let failure = null;
try {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await waitText('THE DERELICT', 10_000);
  await page.screenshot({ path: join(ROOT, 'e2e', 'ui-landing.png'), fullPage: true });

  if (!(await clickText('TAKE A SEAT'))) throw new Error('no practice button');
  await waitText('SIDE DEALS', 30_000);
  if (!(await hasText('SOUND ON'))) throw new Error('sound toggle missing from the bar');
  await page.screenshot({ path: join(ROOT, 'e2e', 'ui-table.png'), fullPage: true });

  const deadline = Date.now() + 100_000;
  let sawChallenge = false;
  let sawSeal = false;
  while (Date.now() < deadline) {
    if (await hasText('THE E-CARD DUEL')) break;
    if (await hasText('NAME A SEAT')) {
      sawChallenge = true;
      await clickText('LET THE DECK DECIDE');
    }
    if (!sawSeal && (await hasText('CHOOSE ONE'))) {
      const faces = await page.evaluate(() => [...document.querySelectorAll('.play-panel .card')]
        .map((card) => Boolean(card.querySelector('.card-art svg'))));
      if (faces.length && faces.some((drawn) => !drawn)) throw new Error('a card face failed to draw');
    }
    if (await clickButton(/^SEAL (ROCK|PAPER|SCISSORS)/)) sawSeal = true;
    await sleep(120);
  }
  await waitText('THE E-CARD DUEL', 10_000);
  await page.screenshot({ path: join(ROOT, 'e2e', 'ui-finale.png'), fullPage: true });

  const duelDeadline = Date.now() + 90_000;
  while (Date.now() < duelDeadline) {
    if (await hasText('VOYAGE ENDED')) break;
    await clickButton(/^SEAL CARD \+ BET$/);
    await sleep(120);
  }
  await waitText('VOYAGE ENDED', 20_000);
  await waitText('Every hand rebuilds', 30_000);
  await page.screenshot({ path: join(ROOT, 'e2e', 'ui-result.png'), fullPage: true });

  const body = await page.evaluate(() => document.body.innerText);
  if (!body.includes('AUDIT')) throw new Error('audit panel missing');
  const verdict = await page.evaluate(() => document.querySelector('.result-verdict')?.innerText ?? '');
  if (!verdict.trim()) throw new Error('result verdict missing');
  console.log('  verdict:', verdict.trim());
  console.log('UI voyage complete.');
  console.log('  challenge panel seen:', sawChallenge);
  console.log('  manual seal button seen:', sawSeal);
  console.log('  audit text:', body.split('\n').filter((l) => l.includes('hand rebuilds') || l.includes('AUDIT')).join(' | '));
} catch (error) {
  failure = error;
  console.error('UI TEST FAILED:', error.message);
  try { await page.screenshot({ path: join(ROOT, 'e2e', 'ui-failure.png'), fullPage: true }); } catch {}
  try {
    const text = await page.evaluate(() => document.body.innerText);
    console.error(text.slice(0, 4000));
  } catch {}
} finally {
  if (errors.length) {
    console.error('\nBrowser errors:');
    for (const e of [...new Set(errors)].slice(0, 20)) console.error(' -', e);
  }
  await browser.close();
  server.kill();
}
if (failure || errors.length) process.exit(1);
process.exit(0);
