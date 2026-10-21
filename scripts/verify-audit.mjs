#!/usr/bin/env node
// Verify a DERELICT audit document offline.
//
//   node scripts/verify-audit.mjs e2e/audit.json
//   curl -s localhost:8791/api/tables/<id>/audit | node scripts/verify-audit.mjs -

import { readFile } from 'node:fs/promises';
import { verifyAudit } from '../shared/audit.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/verify-audit.mjs <audit.json|->');
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

const verdict = await verifyAudit(audit);
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
console.log('\nAUDIT OK — every hand rebuilds, every play is in its hand, the ledger balances.');
