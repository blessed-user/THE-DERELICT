import test from 'node:test';
import assert from 'node:assert/strict';

import { Chain } from '../server/chain.mjs';

test('economy audit receipt sends one zatoshi and the commitment memo to the player', async () => {
  const chain = new Chain({ mode: 'regtest' });
  const output = {
    to: 'uregtest1player',
    memo: `derelict:v1|economy|table-id|${'a'.repeat(64)}`,
  };
  const txid = 'b'.repeat(64);
  let sent;
  chain.send = async (transaction) => {
    sent = transaction;
    return { txid };
  };

  assert.equal(await chain.anchorEconomy(output), txid);
  assert.deepEqual(sent, { to: output.to, zats: 1, memo: output.memo });
});
