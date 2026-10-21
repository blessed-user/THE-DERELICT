// THE DERELICT — durable results.
//
// Nothing here identifies a person. A player is a random local id; the only
// durable facts are voyages, placements, and (for staked runs) a shielded
// payout txid. SQLite via node:sqlite, no native module.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dir = './data') {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'derelict.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS voyages (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        winner_seat INTEGER,
        house_won INTEGER NOT NULL DEFAULT 0,
        split INTEGER NOT NULL DEFAULT 0,
        stake_zats INTEGER NOT NULL DEFAULT 0,
        payout_zats INTEGER NOT NULL DEFAULT 0,
        payout_txid TEXT,
        audit_json TEXT,
        audit_complete INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS placements (
        voyage_id TEXT NOT NULL,
        seat INTEGER NOT NULL,
        player_id TEXT,
        handle TEXT NOT NULL,
        is_bot INTEGER NOT NULL,
        stars INTEGER NOT NULL,
        chips INTEGER NOT NULL,
        alive INTEGER NOT NULL,
        eliminated_cycle INTEGER,
        won INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (voyage_id, seat)
      );
      CREATE INDEX IF NOT EXISTS placements_player ON placements(player_id);
      CREATE TABLE IF NOT EXISTS entries (
        table_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        memo TEXT NOT NULL,
        zats INTEGER NOT NULL,
        txid TEXT,
        ua TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS test_wallets (
        token TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_faucet_at INTEGER NOT NULL DEFAULT 0,
        balance_zats INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Existing demo databases predate the ledger. Add the column once.
    const walletColumns = this.db.prepare('PRAGMA table_info(test_wallets)').all();
    if (!walletColumns.some((column) => column.name === 'balance_zats')) {
      this.db.exec('ALTER TABLE test_wallets ADD COLUMN balance_zats INTEGER NOT NULL DEFAULT 0');
    }
  }

  recordTestWallet({ token, address, createdAt }) {
    this.db.prepare(`
      INSERT INTO test_wallets (token, address, created_at, last_faucet_at, balance_zats)
      VALUES (?, ?, ?, 0, 0)
    `).run(token, address, createdAt);
  }

  testWallet(token) {
    const row = this.db.prepare(`
      SELECT token, address, created_at, last_faucet_at, balance_zats
      FROM test_wallets WHERE token = ?
    `).get(token);
    return row ?? null;
  }

  testWalletByAddress(address) {
    const row = this.db.prepare(`
      SELECT token, address, created_at, last_faucet_at, balance_zats
      FROM test_wallets WHERE address = ? LIMIT 1
    `).get(address);
    return row ?? null;
  }

  creditTestWallet(token, zats) {
    const amount = Math.max(0, Math.floor(Number(zats) || 0));
    if (!amount) return false;
    this.db.prepare('UPDATE test_wallets SET balance_zats = balance_zats + ? WHERE token = ?')
      .run(amount, token);
    return true;
  }

  debitTestWallet(token, zats) {
    const amount = Math.max(0, Math.floor(Number(zats) || 0));
    if (!amount) return false;
    const result = this.db.prepare(`
      UPDATE test_wallets SET balance_zats = balance_zats - ?
      WHERE token = ? AND balance_zats >= ?
    `).run(amount, token, amount);
    return Number(result.changes) === 1;
  }

  countTestWallets() {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM test_wallets').get().n);
  }

  touchTestWallet(token, at) {
    this.db.prepare('UPDATE test_wallets SET last_faucet_at = ? WHERE token = ?').run(at, token);
  }

  // The payout address is needed only while a staked voyage can still settle.
  // Once it has, drop the linkage instead of keeping it in the database.
  clearPayoutAddress(tableId) {
    this.db.prepare('UPDATE entries SET ua = NULL WHERE table_id = ?').run(tableId);
  }

  recordEntry(table) {
    if (!table.deposit) return;
    this.db.prepare(`
      INSERT INTO entries (table_id, address, memo, zats, txid, ua, status, created_at, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(table_id) DO UPDATE SET
        txid = excluded.txid, status = excluded.status, confirmed_at = excluded.confirmed_at
    `).run(
      table.id,
      table.deposit.address,
      table.deposit.memo,
      table.deposit.zats,
      table.entry?.txid ?? null,
      table.entry?.ua ?? null,
      table.entry ? 'confirmed' : 'awaiting',
      table.deposit.createdAt,
      table.entry?.confirmedAt ?? null,
    );
  }

  recordSettlement(table) {
    if (!table.settlement) return;
    const settlement = table.settlement;
    const finished = table.finishedAt ?? Date.now();
    this.db.prepare(`
      INSERT INTO voyages (id, mode, created_at, finished_at, winner_seat, house_won, split,
        stake_zats, payout_zats, payout_txid, audit_json, audit_complete)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        finished_at = excluded.finished_at,
        winner_seat = excluded.winner_seat,
        house_won = excluded.house_won,
        split = excluded.split,
        payout_zats = excluded.payout_zats,
        payout_txid = excluded.payout_txid,
        audit_json = excluded.audit_json,
        audit_complete = excluded.audit_complete
    `).run(
      table.id,
      table.mode,
      table.createdAt,
      finished,
      settlement.winnerSeat ?? null,
      settlement.houseWon ? 1 : 0,
      settlement.split ? 1 : 0,
      settlement.stakeZats ?? 0,
      settlement.payoutZats ?? 0,
      settlement.txid ?? null,
      JSON.stringify(table.audit ?? null),
      table.audit?.complete ? 1 : 0,
    );

    const insert = this.db.prepare(`
      INSERT INTO placements (voyage_id, seat, player_id, handle, is_bot, stars, chips, alive,
        eliminated_cycle, won)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(voyage_id, seat) DO UPDATE SET
        stars = excluded.stars, chips = excluded.chips, alive = excluded.alive, won = excluded.won
    `);
    for (const seat of table.seats) {
      insert.run(
        table.id,
        seat.seat,
        seat.playerId ?? null,
        seat.handle,
        seat.isBot ? 1 : 0,
        seat.stars,
        seat.chips,
        seat.alive ? 1 : 0,
        seat.eliminatedCycle,
        settlement.winnerSeat === seat.seat ? 1 : 0,
      );
    }
  }

  leaderboard(limit = 25) {
    const rows = this.db.prepare(`
      SELECT p.player_id AS playerId,
             COUNT(*) AS voyages,
             SUM(p.won) AS wins,
             MAX(v.finished_at) AS lastVoyage
      FROM placements p
      JOIN voyages v ON v.id = p.voyage_id
      WHERE p.is_bot = 0 AND p.player_id IS NOT NULL
      GROUP BY p.player_id
      ORDER BY wins DESC, voyages DESC, lastVoyage DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, limit)));
    return rows.map((r) => ({
      playerId: String(r.playerId).slice(0, 12),
      voyages: Number(r.voyages),
      wins: Number(r.wins),
      lastVoyage: Number(r.lastVoyage),
    }));
  }

  recent(limit = 20) {
    const rows = this.db.prepare(`
      SELECT id, mode, finished_at, winner_seat, house_won, split, stake_zats, payout_zats,
             payout_txid, audit_complete
      FROM voyages
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, limit)));
    return rows.map((r) => ({
      tableId: r.id,
      mode: r.mode,
      finishedAt: Number(r.finished_at),
      winnerSeat: r.winner_seat == null ? null : Number(r.winner_seat),
      houseWon: Boolean(r.house_won),
      split: Boolean(r.split),
      stakeZats: Number(r.stake_zats),
      payoutZats: Number(r.payout_zats),
      payoutTxid: r.payout_txid,
      auditComplete: Boolean(r.audit_complete),
    }));
  }

  audit(tableId) {
    const row = this.db.prepare('SELECT audit_json FROM voyages WHERE id = ?').get(tableId);
    return row?.audit_json ? JSON.parse(row.audit_json) : null;
  }

  updateAudit(table) {
    if (!table.audit) return;
    this.db.prepare(`
      UPDATE voyages SET audit_json = ?, audit_complete = ? WHERE id = ?
    `).run(JSON.stringify(table.audit), table.audit.complete ? 1 : 0, table.id);
  }

  close() {
    this.db.close();
  }
}
