// THE DERELICT — shielded settlement.
//
// The chain side is deliberately small: one house wallet (zecd), one fresh
// shielded address per staked seat, and a memo that binds the deposit to the
// table. Entry and payout are both shielded transactions. The server is the
// house bankroll, not an escrow contract; docs/THREAT-MODEL.md says so.

const ZAT = 1e8;

function zecString(zats) {
  return (zats / ZAT).toFixed(8);
}

function memoHex(memo) {
  return Buffer.from(memo, 'utf8').toString('hex');
}

function basic(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export class Chain {
  constructor({
    mode = 'off',
    zecdUrl = '',
    zecdUser = '',
    zecdPass = '',
    zebraUrl = '',
    autoMine = false,
    payoutTimeoutMs = 180_000,
  } = {}) {
    this.mode = mode;
    this.zecdUrl = zecdUrl;
    this.zecdUser = zecdUser;
    this.zecdPass = zecdPass;
    this.zebraUrl = zebraUrl;
    this.autoMine = autoMine;
    this.payoutTimeoutMs = payoutTimeoutMs;
    this.lastError = null;
  }

  get enabled() {
    return Boolean(this.zecdUrl);
  }

  get stakedEnabled() {
    return this.enabled && this.mode !== 'off';
  }

  async rpc(method, params = []) {
    if (!this.enabled) throw new Error('the chain is not configured');
    const res = await fetch(this.zecdUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: basic(this.zecdUser, this.zecdPass),
      },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'derelict', method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        detail = parsed?.error?.message ?? body;
      } catch { /* non-JSON error body */ }
      throw new Error(`zecd HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
    }
    const body = await res.json();
    if (body.error) throw new Error(body.error.message || 'zecd rpc error');
    return body.result;
  }

  async zebraRpc(method, params = []) {
    if (!this.zebraUrl) throw new Error('zebra is not configured');
    const res = await fetch(this.zebraUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'derelict', method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`zebra HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message || 'zebra rpc error');
    return body.result;
  }

  async ready() {
    if (!this.enabled) return { ok: false, reason: 'chain off' };
    try {
      const [info, height] = await Promise.all([
        this.rpc('getblockchaininfo', []),
        this.zebraRpc('getblockchaininfo', []).catch(() => null),
      ]);
      return {
        ok: true,
        mode: this.mode,
        zecd: { chain: info.chain, blocks: info.blocks, connections: info.connections },
        zebraHeight: height?.blocks ?? null,
      };
    } catch (error) {
      this.lastError = error.message;
      return { ok: false, reason: error.message };
    }
  }

  async newAddress() {
    const address = await this.rpc('getnewaddress', []);
    if (typeof address !== 'string' || !address) throw new Error('zecd returned no address');
    return address;
  }

  async validateAddress(address) {
    if (typeof address !== 'string' || address.length < 10 || address.length > 200) {
      return { ok: false, reason: 'not a shielded address' };
    }
    if (!address.startsWith('u') && !address.startsWith('z')) {
      return { ok: false, reason: 'not a shielded address' };
    }
    try {
      const info = await this.rpc('z_validateaddress', [address]);
      return { ok: Boolean(info?.isvalid), mine: Boolean(info?.ismine), info };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  async balance(address) {
    // zecd 0.8.2 does not implement z_getbalance; fall back to its unspent
    // note list. Only exact address matches count, so house change notes with
    // an empty address field never inflate a test wallet.
    try {
      const amount = await this.rpc('z_getbalance', [address, 0]);
      const zats = Math.round(Number(amount) * ZAT);
      if (Number.isFinite(zats) && zats >= 0) return zats;
    } catch (error) {
      if (!/method not found/i.test(error.message)) throw error;
    }
    const notes = await this.rpc('listunspent', [0, 999_999]);
    const zats = (Array.isArray(notes) ? notes : [])
      .filter((note) => note?.address === address)
      .reduce((sum, note) => sum + Math.round(Number(note.amount) * ZAT), 0);
    if (!Number.isFinite(zats) || zats < 0) throw new Error('zecd returned a bad balance');
    return zats;
  }

  async listTransactions(count = 200) {
    const rows = await this.rpc('listtransactions', ['*', count]);
    return Array.isArray(rows) ? rows : [];
  }

  async createDeposit({ tableId, seat, zats, ttlMs = 30 * 60_000 }) {
    const address = await this.newAddress();
    const memo = `derelict:${tableId}:${seat}`;
    return {
      address,
      memo,
      memoHex: memoHex(memo),
      zats,
      zec: zecString(zats),
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
  }

  // Sum confirmed receive rows carrying the table's memo. Returns null while
  // the fare is still in the water. The memo is unique to one table+seat, and
  // the address is fresh, so no time window is needed — regtest wallets report
  // the chain's synthetic block time, not wall-clock time.
  async findDeposit({ memo, zats, minConf = 1 }) {
    const rows = await this.listTransactions(300);
    const seen = new Map();
    for (const row of rows) {
      if (row.category !== 'receive') continue;
      if (row.memoStr !== memo) continue;
      const amount = Math.round(Number(row.amount) * ZAT);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if ((row.confirmations ?? 0) < minConf) continue;
      seen.set(row.txid, { txid: row.txid, amount, confirmations: row.confirmations ?? 0, time: row.time });
    }
    const entries = [...seen.values()];
    const total = entries.reduce((sum, e) => sum + e.amount, 0);
    if (total < zats) return null;
    return { txid: entries[0].txid, zats: total, confirmations: Math.min(...entries.map((e) => e.confirmations)) };
  }

  async fundedAddress() {
    try {
      const notes = await this.rpc('listunspent', [0, 999_999]);
      // Shielded notes only. Falling back to a transparent coinbase note would
      // reveal the house's sending address and amount, and zecd's default
      // privacy policy refuses it anyway.
      const shielded = (Array.isArray(notes) ? notes : [])
        .filter((n) => n.address && Number(n.amount) > 0)
        .filter((n) => ['sapling', 'orchard', 'ironwood'].includes(n.pool) || /^[uz]/.test(n.address))
        .sort((a, b) => Number(b.amount) - Number(a.amount));
      return shielded[0]?.address ?? null;
    } catch {
      return null;
    }
  }

  async waitForOperation(opid) {
    const deadline = Date.now() + this.payoutTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_500));
      let entries;
      try {
        entries = await this.rpc('z_getoperationstatus', [[opid]]);
      } catch (error) {
        this.lastError = error.message;
        continue;
      }
      const entry = Array.isArray(entries) ? entries[0] : null;
      if (!entry) continue;
      if (entry.status === 'success') {
        return { txid: entry.result?.txid ?? null, opid, status: 'success' };
      }
      if (entry.status === 'failed') {
        throw new Error(entry.error?.message || String(entry.error || 'operation failed'));
      }
    }
    throw new Error('operation timed out');
  }

  async send({ to, zats, memo = null }) {
    if (!this.enabled) throw new Error('the chain is not configured');
    const from = await this.fundedAddress();
    if (!from) throw new Error('the house has no spendable shielded note');
    const output = { address: to, amount: zecString(zats) };
    if (memo) output.memo = memoHex(memo);
    const opid = await this.rpc('z_sendmany', [from, [output]]);
    return this.waitForOperation(opid);
  }

  async payout({ to, zats, tableId }) {
    const result = await this.send({ to, zats, memo: `derelict-payout:${tableId}` });
    if (this.autoMine) {
      try { await this.mine(1); } catch { /* the node may be unavailable */ }
    }
    return result.txid;
  }

  async faucet({ to, zats = 5_000_000 }) {
    if (this.mode !== 'regtest') throw new Error('the faucet only runs on regtest');
    return this.send({ to, zats, memo: 'derelict-faucet' });
  }

  async mine(n = 1) {
    if (this.mode !== 'regtest') throw new Error('mining is only exposed on regtest');
    return this.zebraRpc('generate', [Math.max(1, Math.min(100, n))]);
  }

  async height() {
    try {
      const info = await this.zebraRpc('getblockchaininfo', []);
      return info.blocks;
    } catch {
      return null;
    }
  }
}
