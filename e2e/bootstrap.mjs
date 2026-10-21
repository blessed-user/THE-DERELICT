// DERELICT regtest bring-up: mine coinbase to maturity, shield it in the house
// wallet, and verify a spendable shielded note exists. One-shot compose job.
const ZEBRA_URL = process.env.ZEBRA_URL || 'http://zebra:18234/';
const FUNDER_URL = process.env.FUNDER_URL || 'http://funder:18242/';
const FUNDER_USER = process.env.FUNDER_USER || 'funder';
const FUNDER_PASS = process.env.FUNDER_PASS || 'regtest-funder-pw';
const BRINGUP_BLOCKS = Number(process.env.BRINGUP_BLOCKS || 105);
const TIMEOUT_MS = Number(process.env.BOOTSTRAP_TIMEOUT_MS || 600_000);

const SHIELDED_POOLS = new Set(['sapling', 'orchard', 'ironwood']);
const deadline = Date.now() + TIMEOUT_MS;

async function zebra(method, params) {
  const res = await fetch(ZEBRA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function funder(method, params) {
  const res = await fetch(FUNDER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Basic ' + Buffer.from(`${FUNDER_USER}:${FUNDER_PASS}`).toString('base64'),
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'bootstrap', method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

function until(fn, label, stepMs = 2000) {
  return (async () => {
    while (Date.now() < deadline) {
      try {
        if (await fn()) return;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, stepMs));
    }
    throw new Error(`timeout: ${label}`);
  })();
}

async function mineTo(target) {
  for (;;) {
    const height = Number(await zebra('getblockcount', []));
    if (height >= target) {
      console.log(`bootstrap: height ${height} >= ${target}`);
      return;
    }
    const batch = Math.min(25, target - height);
    await zebra('generate', [batch]);
    console.log(`bootstrap: mined ${batch} (height now ${await zebra('getblockcount', [])})`);
  }
}

async function hasShieldedNote() {
  const utxos = await funder('listunspent', [1]);
  return Array.isArray(utxos) && utxos.some((u) => SHIELDED_POOLS.has(u.pool));
}

async function main() {
  console.log(`bootstrap: mining to height ${BRINGUP_BLOCKS} (coinbase matures at 100)`);
  await until(async () => Number(await zebra('getblockcount', [])) >= 0, 'zebra RPC');
  await mineTo(BRINGUP_BLOCKS);

  await until(async () => {
    await funder('getwalletinfo', []);
    return true;
  }, 'funder RPC');
  console.log('bootstrap: funder RPC up');

  if (await hasShieldedNote()) {
    console.log('bootstrap: funder already holds a shielded note — nothing to do');
    return;
  }

  const ua = await funder('getnewaddress', []);
  let res = null;
  await until(async () => {
    try {
      res = await funder('z_shieldcoinbase', ['*', ua, null, 10]);
    } catch (e) {
      console.log(`bootstrap: shield not ready yet (${e.message})`);
      return false;
    }
    return Boolean(res?.opid && res?.shieldingUTXOs > 0);
  }, 'z_shieldcoinbase finding mature coinbase', 3000);
  console.log(`bootstrap: shielding ${res.shieldingUTXOs} coinbase UTXOs (opid ${res.opid})`);

  await until(async () => {
    const entries = await funder('z_getoperationstatus', [[res.opid]]);
    const entry = Array.isArray(entries) ? entries[0] : null;
    if (entry?.status === 'success') return true;
    if (entry?.status === 'failed') throw new Error(`shield failed: ${JSON.stringify(entry.error)}`);
    return false;
  }, 'shield opid');
  console.log('bootstrap: shield confirmed by wallet');

  await mineTo(BRINGUP_BLOCKS + 3);
  await until(hasShieldedNote, 'shielded note in listunspent');
  console.log('bootstrap: funder holds a spendable shielded note — ready to settle fares');
}

main().catch((e) => {
  console.error(`bootstrap FAILED: ${e.message}`);
  process.exit(1);
});
