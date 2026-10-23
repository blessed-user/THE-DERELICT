// Browser test for the staked regtest flow: open a solo table, pay the fare
// through the house-funding button, and require the voyage to cast off.
//
//   docker compose up --build -d
//   node e2e/ui-stake.mjs
//
// Uses the same throwaway payout address as e2e/stack.mjs (a BIP-39 test
// vector derived offline; it is not in the house wallet).

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.DERELICT_URL || 'http://127.0.0.1:8791';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAYOUT_UA = process.env.PAYOUT_UA ||
  'uregtest1kvnhj65x5xgrlf2xap6h8t20n534934eh6ngfvvtpunpazje26vgt5n0vf2x702l6arysdm228ht7utlkngnu3y0jtnwv5uvdykr7epp';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${BASE}/api/health`)).json();
if (!health.chain?.staked) throw new Error(`stack is not staked: ${JSON.stringify(health.chain)}`);

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
page.on('requestfailed', (req) => {
  const url = req.url();
  // Closing the tab aborts an in-flight WS; not a page error.
  if (!url.startsWith('ws')) errors.push(`request failed: ${url} ${req.failure()?.errorText}`);
});

const waitText = (needle, timeout = 30_000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 100 }, needle);
const hasText = (t) => page.evaluate((needle) => document.body.innerText.includes(needle), t);
const clickButton = async (src) => page.evaluate((source) => {
  const re = new RegExp(source);
  const el = [...document.querySelectorAll('button')]
    .find((b) => re.test(b.innerText.replace(/\s+/g, ' ').trim()) && !b.disabled);
  if (!el) return false;
  el.click();
  return true;
}, src.source);

let failure = null;
try {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await waitText('THE DERELICT', 10_000);

  if (!(await clickButton(/STAKE A FARE/i))) throw new Error('no staked button');
  await waitText('CHOOSE YOUR ENTRY FARE', 10_000);

  const inputs = await page.$$('input');
  if (inputs.length < 2) throw new Error('stake form missing inputs');
  await inputs[1].type(PAYOUT_UA, { delay: 0 });

  if (!(await clickButton(/CONTINUE TO PAYMENT/i))) throw new Error('could not continue to fare payment');
  await waitText('SEND THE FARE', 30_000);
  await page.screenshot({ path: join(ROOT, 'e2e', 'ui-deposit.png'), fullPage: true });

  if (!(await clickButton(/PAY THE FARE FROM THE HOUSE/i))) throw new Error('no house-fund button');
  await waitText('SIDE DEALS', 60_000);
  await page.screenshot({ path: join(ROOT, 'e2e', 'ui-staked-table.png'), fullPage: true });

  if (!(await hasText('SIDE DEALS'))) throw new Error('voyage did not cast off');
  console.log('STAKED UI FLOW OK');
  console.log('  deposit screen seen: true');
  console.log('  house-covered fare accepted: true');
  console.log('  voyage cast off: true');
} catch (error) {
  failure = error;
  console.error('STAKED UI TEST FAILED:', error.message);
  try { await page.screenshot({ path: join(ROOT, 'e2e', 'ui-stake-failure.png'), fullPage: true }); } catch {}
  try {
    const text = await page.evaluate(() => document.body.innerText);
    console.error(text.slice(0, 3000));
  } catch {}
} finally {
  if (errors.length) {
    console.error('\nBrowser errors:');
    for (const e of [...new Set(errors)].slice(0, 20)) console.error(' -', e);
  }
  await sleep(200);
  await browser.close();
}
process.exit(failure || errors.length ? 1 : 0);
