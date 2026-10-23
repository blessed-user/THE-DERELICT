#!/usr/bin/env node
// Verify a DERELICT audit document offline.
//
//   node scripts/verify-audit.mjs e2e/audit.json
//   curl -s localhost:8791/api/tables/<id>/audit | node scripts/verify-audit.mjs -

import { readFile } from 'node:fs/promises';
import { verifyAudit, verifyEconomyAnchorTransaction } from '../shared/audit.js';
import { Chain } from '../server/chain.mjs';

const args = process.argv.slice(2);
const verifyChain = args.includes('--verify-chain');
const path = args.find((arg) => arg !== '--verify-chain');
if (!path) {
  console.error('usage: node scripts/verify-audit.mjs <audit.json|-> [--verify-chain]');
  process.exit(2);
}

let text;
if (path === '-') {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  text = Buffer.concat(chunks).toString('utf8');
} else {
  text = await readFile(path, 'utf8');
}

let audit;
try {
  audit = JSON.parse(text);
} catch (error) {
  console.error('not JSON:', error.message);
  process.exit(2);
}

let chainTransactions = null;
if (verifyChain) {
  if (!process.env.ZECD_URL) {
    console.error('--verify-chain requires ZECD_URL for a trusted Zcash wallet RPC endpoint.');
    process.exit(2);
  }
  if (!audit?.settlement?.economyAnchor?.txid) {
    console.error('the audit has no published economy-anchor transaction to verify.');
    process.exit(1);
  }
  try {
    const chain = new Chain({
      mode: process.env.CHAIN_MODE ?? 'off',
      zecdUrl: process.env.ZECD_URL,
      zecdUser: process.env.ZECD_USER ?? '',
      zecdPass: process.env.ZECD_PASS ?? '',
    });
    chainTransactions = await chain.listTransactions(1000);
  } catch (error) {
    console.error(`could not query the configured wallet RPC: ${error.message}`);
    process.exit(2);
  }
}

const verdict = await verifyAudit(audit, { chainTransactions });
const chainVerdict = verifyChain
  ? verifyEconomyAnchorTransaction(audit, chainTransactions)
  : null;
console.log(JSON.stringify(verdict.stats, null, 2));
if (verdict.warnings.length) {
  console.log(`\nwarnings (${verdict.warnings.length}):`);
  for (const w of verdict.warnings) console.log('  ~', w);
}
if (!verdict.ok) {
  console.log(`\nFAILED (${verdict.errors.length}):`);
  for (const e of verdict.errors) console.log('  -', e);
  process.exit(1);
}
console.log('\nGAME AUDIT OK — every hand rebuilds, every play is in its hand, the ledger balances.');
if (chainVerdict?.ok) {
  console.log(`CHAIN VERIFIED — wallet found the transaction, matching memo, and ${chainVerdict.confirmations} confirmation(s).`);
} else if (verifyChain) {
  console.error(`CHAIN VERIFICATION FAILED — ${chainVerdict.reason}`);
  process.exit(1);
} else if (verdict.warnings.some((warning) => /transaction.*not verified offline/.test(warning))) {
  console.log('CHAIN STATUS UNVERIFIED — check the transaction and recipient-side memo in your wallet.');
}
