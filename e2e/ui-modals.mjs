// Browser test for the shared dialog layer and the lobby regression:
// rules modal, escape/focus handling, live abandon, loan note, private lobby.
//
//   docker compose up --build -d
//   node e2e/ui-modals.mjs

import assert from 'node:assert/strict';
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
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [];

async function openPage(width, height) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    if (!req.url().startsWith('ws')) errors.push(`request failed: ${req.url()}`);
  });
  return { context, page };
}

const waitText = async (page, needle, timeout = 30_000) => {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 100 }, needle);
  } catch (error) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.error(`WAIT FAILED for "${needle}"; page says: ${text.replace(/\s+/g, ' ').slice(0, 900)}`);
    throw error;
  }
};

const waitButton = (page, re, timeout = 30_000) =>
  page.waitForFunction((src) => {
    const r = new RegExp(src);
    return [...document.querySelectorAll('button')].some((el) => r.test(el.innerText.replace(/\s+/g, ' ').trim()) && !el.disabled);
  }, { timeout, polling: 100 }, re.source);

const clickButton = (page, re, scope = 'body') => page.evaluate((src, rootSel) => {
  const r = new RegExp(src);
  const root = document.querySelector(rootSel) ?? document.body;
  const el = [...root.querySelectorAll('button')]
    .find((b) => r.test(b.innerText.replace(/\s+/g, ' ').trim()) && !b.disabled);
  if (!el) return false;
  el.click();
  return true;
}, re.source, scope);

const modalTitle = (page) => page.evaluate(() => document.querySelector('.modal h2')?.innerText ?? null);

let failure = null;
try {
  // ---------------------------------------------------------------- landing + rules
  {
    const { context, page } = await openPage(1440, 1000);
    try {
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      await waitText(page, 'A SURVIVAL GAMBLE IN TWO ACTS');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.masthead svg.logo').length), 1, 'masthead logo missing');
      assert.equal(await page.evaluate(() => document.querySelector('.brand-name')?.innerText), 'THE DERELICT');

      assert.ok(await clickButton(page, /READ THE RULES/i), 'no rules button');
      await waitText(page, 'THE RULES OF THE HOLD');
      await sleep(240);
      assert.equal(await page.evaluate(() => document.activeElement?.innerText), 'CLOSE THE BOOK', 'rules did not take focus');
      await page.screenshot({ path: join(ROOT, 'e2e', 'ui-modal-rules.png') });

      await waitText(page, '01 · PICK A TABLE');
      await waitText(page, 'WHERE THE ZEC IS');
      await waitText(page, 'WORKED EXAMPLE');
      assert.equal(
        await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').includes('No wallet is involved in a bet')),
        true,
        'money explainer did not render',
      );
      assert.equal(await page.evaluate(() => document.body.innerText.includes('01 · THE TABLE')), false, 'full rules visible on the how-to tab');
      assert.ok(await clickButton(page, /THE FULL RULES/i, '.modal'), 'no full-rules tab');
      await waitText(page, '01 · THE TABLE');
      assert.ok(await clickButton(page, /HOW TO PLAY/i, '.modal'), 'no how-to tab');
      await waitText(page, '01 · PICK A TABLE');

      await page.keyboard.press('Escape');
      await sleep(250);
      assert.equal(await page.evaluate(() => document.body.innerText.includes('THE RULES OF THE HOLD')), false, 'Escape did not close rules');
      assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'body scroll lock not released');
      console.log('rules modal OK');
    } finally {
      await context.close();
    }
  }

  // ---------------------------------------------------------------- regtest profile
  {
    const { context, page } = await openPage(1440, 1000);
    try {
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      assert.ok(await clickButton(page, /^PROFILE$/), 'no profile button');
      await waitText(page, 'TEST WALLET');
      await waitText(page, 'THIS IS NOT A PRIVATE WALLET');
      assert.ok(await clickButton(page, /CREATE TEST WALLET/i, '.modal'), 'no wallet create button');
      await waitText(page, 'SHIELDED TEST ADDRESS', 30_000);
      assert.equal(await page.evaluate(() => document.querySelector('.wallet-address')?.innerText.startsWith('uregtest1')), true, 'test address missing');
      assert.ok(await clickButton(page, /^CLOSE$/i, '.modal'), 'no wallet close button');
      console.log('regtest profile wallet OK');
    } finally {
      await context.close();
    }
  }

  // ---------------------------------------------------------------- private lobby
  {
    const { context, page } = await openPage(1440, 1000);
    try {
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      assert.ok(await clickButton(page, /OPEN A TABLE/i), 'no private table button');
      await waitText(page, 'THE GANGWAY IS OPEN');
      assert.ok(await page.evaluate(() => document.querySelectorAll('.lobby-seat').length >= 1), 'lobby seats did not render');

      assert.ok(await clickButton(page, /^CAST OFF$/), 'no cast-off button');
      await waitText(page, '3 CHAIRS ARE EMPTY');
      assert.equal(await modalTitle(page), '3 CHAIRS ARE EMPTY');
      assert.ok(await clickButton(page, /HOLD THE GANGWAY/i, '.modal'), 'no cast-off hold');
      await sleep(200);
      assert.equal(await page.evaluate(() => Boolean(document.querySelector('.lobby'))), true, 'hold left the lobby');

      assert.ok(await clickButton(page, /^LEAVE$/), 'no lobby leave button');
      await waitText(page, 'STAY IN THE LOBBY');
      assert.equal(await modalTitle(page), 'LEAVE THE GANGWAY?');
      assert.ok(await clickButton(page, /STAY IN THE LOBBY/i, '.modal'), 'no lobby cancel');
      await sleep(200);
      assert.equal(await page.evaluate(() => Boolean(document.querySelector('.lobby'))), true, 'cancel left the lobby');
      console.log('private lobby OK');
    } finally {
      await context.close();
    }
  }

  // ---------------------------------------------------------------- live table, loan, abandon
  {
    const { context, page } = await openPage(1440, 1000);
    try {
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      assert.ok(await clickButton(page, /TAKE A SEAT/i), 'no practice button');
      await waitButton(page, /SIGN THE NOTE/i);

      assert.ok(await clickButton(page, /SIGN THE NOTE/i), 'no loan button');
      await waitText(page, 'THE NOTE COMES DUE WHEN THE HOLD CLOSES');
      await sleep(240);
      assert.equal(await modalTitle(page), 'SIGN THE NOTE?');
      assert.equal(await page.evaluate(() => document.activeElement?.innerText), 'NOT YET', 'loan did not focus the safe action');
      await page.screenshot({ path: join(ROOT, 'e2e', 'ui-modal-loan.png') });
      assert.ok(await clickButton(page, /NOT YET/i, '.modal'), 'no loan cancel');
      await sleep(200);
      assert.equal(await page.evaluate(() => document.body.innerText.includes('SIGN THE NOTE?')), false, 'loan modal stayed open');

      assert.ok(await clickButton(page, /^LEAVE$/), 'no live leave button');
      await waitText(page, 'STAY ABOARD');
      assert.equal(await modalTitle(page), 'ABANDON THE TABLE?');
      await sleep(240);
      await page.screenshot({ path: join(ROOT, 'e2e', 'ui-modal-leave.png') });
      assert.ok(await clickButton(page, /ABANDON THE TABLE/i, '.modal'), 'no abandon confirm');
      await waitText(page, 'A SURVIVAL GAMBLE IN TWO ACTS', 10_000);
      assert.ok(await page.evaluate(() => Boolean(document.querySelector('.landing'))), 'did not return to the harbour');
      console.log('loan + live abandon OK');
    } finally {
      await context.close();
    }
  }

  // ---------------------------------------------------------------- staked fare
  {
    const { context, page } = await openPage(1440, 1000);
    try {
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      assert.ok(await clickButton(page, /STAKE A FARE/i), 'no staked button');
      await waitText(page, 'NAME YOUR FARE');
      const inputs = await page.$$('input');
      assert.ok(inputs.length >= 2, 'stake form missing inputs');
      await inputs[1].type(PAYOUT_UA, { delay: 0 });
      assert.ok(await clickButton(page, /OPEN THE TABLE/i), 'no stake submit');
      await waitText(page, 'SEND THE FARE', 30_000);

      assert.ok(await clickButton(page, /LEAVE THE FARE/i), 'no fare leave button');
      await waitText(page, 'WAIT FOR THE FARE');
      assert.equal(await modalTitle(page), 'LEAVE THE FARE?');
      assert.ok(await clickButton(page, /WAIT FOR THE FARE/i, '.modal'), 'no fare cancel');
      await sleep(200);
      assert.ok(await page.evaluate(() => document.body.innerText.includes('SEND THE FARE')), 'fare cancel left the deposit');

      assert.ok(await clickButton(page, /LEAVE THE FARE/i), 'no second fare leave');
      await waitText(page, 'WAIT FOR THE FARE');
      assert.ok(await clickButton(page, /LEAVE THE FARE/i, '.modal'), 'no fare confirm');
      await waitText(page, 'A SURVIVAL GAMBLE IN TWO ACTS', 10_000);
      console.log('staked fare leave OK');
    } finally {
      await context.close();
    }
  }

  // ---------------------------------------------------------------- mobile sheet
  {
    const { context, page } = await openPage(390, 844);
    try {
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      assert.ok(await clickButton(page, /READ THE RULES/i), 'no mobile rules button');
      await waitText(page, 'THE RULES OF THE HOLD');
      await sleep(260);
      const box = await page.evaluate(() => {
        const el = document.querySelector('.modal');
        const r = el.getBoundingClientRect();
        return { width: r.width, bottom: r.bottom, height: r.height, viewport: innerHeight };
      });
      assert.ok(box.width <= 390 && box.bottom <= 844, `mobile sheet overflows: ${JSON.stringify(box)}`);
      assert.ok(box.height > 400, 'mobile sheet collapsed');
      await page.screenshot({ path: join(ROOT, 'e2e', 'ui-modal-rules-mobile.png') });
      await clickButton(page, /CLOSE THE BOOK/i, '.modal');
      await sleep(200);

      assert.ok(await clickButton(page, /OPEN A TABLE/i), 'no mobile private button');
      await waitText(page, 'THE GANGWAY IS OPEN');
      assert.ok(await clickButton(page, /^LEAVE$/), 'no mobile lobby leave');
      await waitText(page, 'STAY IN THE LOBBY');
      await page.screenshot({ path: join(ROOT, 'e2e', 'ui-modal-leave-mobile.png') });
      assert.equal(await modalTitle(page), 'LEAVE THE GANGWAY?');
      console.log('mobile sheets OK');
    } finally {
      await context.close();
    }
  }
} catch (error) {
  failure = error;
  console.error('MODAL UI TEST FAILED:', error.message);
} finally {
  if (errors.length) {
    console.error('\nBrowser errors:');
    for (const e of [...new Set(errors)].slice(0, 20)) console.error(' -', e);
  }
  await sleep(150);
  await browser.close();
}
process.exit(failure || errors.length ? 1 : 0);
