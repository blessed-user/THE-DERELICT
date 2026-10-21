// Development: the game server and the Vite client, one command.
// Vite proxies /api and /ws to the server's port.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT ?? '8791' },
});

let vite;
const startVite = () => {
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  vite = spawn(process.execPath, [viteBin], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
};

// Give the game server a beat to bind before Vite starts proxying.
setTimeout(startVite, 500);

function end(code = 0) {
  try { server.kill(); } catch { /* already gone */ }
  try { vite?.kill(); } catch { /* already gone */ }
  process.exit(code);
}
server.on('exit', (code) => { if (code && code !== 0) end(code); });
process.on('SIGINT', () => end(0));
process.on('SIGTERM', () => end(0));
