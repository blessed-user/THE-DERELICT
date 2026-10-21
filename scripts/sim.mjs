import { Table } from '../server/game.mjs';

const table = new Table({
  mode: 'practice',
  phaseScale: Number(process.env.SCALE ?? 0.02),
  onSettle: (t) => {
    console.log('\nSETTLED', t.settlement);
    console.log('phase', t.phase, 'status', t.status, 'cycles', t.cycle);
    console.log('finale', t.finale && {
      a: t.finale.a, b: t.finale.b, roles: t.finale.roles,
      chips: t.finale.chips, winner: t.finale.winner, rounds: t.finale.rounds.length,
    });
    console.log('audit complete', t.audit?.complete, 'rounds', t.audit?.act1.rounds.length);
    console.log('log tail:');
    for (const e of t.logEntries.slice(-25)) console.log(' ', e.kind, '|', e.text);
    table.dispose();
    process.exit(0);
  },
});

for (let i = 0; i < 4; i++) table.addSeat({ isBot: true, connected: true });

const started = await table.start();
if (!started.ok) { console.error(started); process.exit(1); }
console.log('started', table.id, table.code);

setTimeout(() => {
  console.error('TIMEOUT at phase', table.phase, 'status', table.status, 'cycle', table.cycle);
  console.error('seats', table.seats.map((s) => ({ seat: s.seat, stars: s.stars, alive: s.alive, cards: s.cardsLeft })));
  console.error('pairings', table.pairings, 'plays', Object.keys(table.plays));
  for (const e of table.logEntries.slice(-20)) console.error(' ', e.kind, '|', e.text);
  table.dispose();
  process.exit(2);
}, 45_000);
