// THE DERELICT — commitments and Merkle-committed hands.
//
// The server never receives a player's full hand. At the start of an act the
// player commits to a Merkle root over its cards; every played card arrives
// with an inclusion proof. The server can verify "this card is in the hand"
// without learning the other five, and cannot replay a leaf.
//
// All hashing uses WebCrypto, available in browsers and Node 20+.

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Unbiased integer in [0, n). Rejection sampling, not modulo bias.
export function randomInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('randomInt needs a positive integer');
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const a = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(a); } while (a[0] >= limit);
  return a[0] % n;
}

export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- leaf canonical strings ----
export function leafMessage(index, card, salt) {
  return `derelict:v1|leaf|${index}|${card}|${salt}`;
}
export function handCommitMessage(tableId, seat, treeRoot) {
  return `derelict:v1|hand|${tableId}|${seat}|${treeRoot}`;
}
export function duelHandCommitMessage(tableId, seat, treeRoot) {
  return `derelict:v1|duelhand|${tableId}|${seat}|${treeRoot}`;
}
export function playCommitMessage(tableId, cycle, seat, card, salt) {
  return `derelict:v1|play|${tableId}|${cycle}|${seat}|${card}|${salt}`;
}
export function duelPlayCommitMessage(tableId, round, seat, card, bet, salt) {
  return `derelict:v1|duel|${tableId}|${round}|${seat}|${card}|${bet}|${salt}`;
}

export async function leafHash(index, card, salt) {
  return sha256Hex(leafMessage(index, card, salt));
}

export async function handCommit(tableId, seat, treeRoot) {
  return sha256Hex(handCommitMessage(tableId, seat, treeRoot));
}

export async function duelHandCommit(tableId, seat, treeRoot) {
  return sha256Hex(duelHandCommitMessage(tableId, seat, treeRoot));
}

export async function playCommit(tableId, cycle, seat, card, salt) {
  return sha256Hex(playCommitMessage(tableId, cycle, seat, card, salt));
}

export async function duelPlayCommit(tableId, round, seat, card, bet, salt) {
  return sha256Hex(duelPlayCommitMessage(tableId, round, seat, card, bet, salt));
}

// ---- Merkle tree ----
// Leaves are padded to the next power of two with a fixed empty leaf. The
// padding is deterministic so the verifier can rebuild the same tree.
export async function buildHandTree(cards, salts) {
  if (!Array.isArray(cards) || !Array.isArray(salts) || cards.length !== salts.length) {
    throw new Error('cards and salts must be parallel arrays');
  }
  const emptyHash = await sha256Hex('derelict:v1|empty');
  const leaves = [];
  for (let i = 0; i < cards.length; i++) {
    leaves.push(await leafHash(i, cards[i], salts[i]));
  }
  let size = 1;
  while (size < Math.max(2, leaves.length)) size *= 2;
  const level0 = [...leaves, ...Array(size - leaves.length).fill(emptyHash)];
  const levels = [level0];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(await sha256Hex(prev[i] + prev[i + 1]));
    levels.push(next);
  }
  return { root: levels[levels.length - 1][0], leaves, levels, size, emptyHash };
}

export function proofFor(tree, index) {
  if (index < 0 || index >= tree.leaves.length) throw new Error('index outside hand');
  const proof = [];
  let idx = index;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level];
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    proof.push({ hash: nodes[sibling], siblingIsLeft: sibling < idx });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export async function verifyProof(leaf, proof, index, root) {
  let h = leaf;
  for (const step of proof) {
    h = step.siblingIsLeft ? await sha256Hex(step.hash + h) : await sha256Hex(h + step.hash);
  }
  return h === root;
}

// Convenience for a client: build the tree and return everything it needs.
export async function makeHand(cards) {
  const salts = cards.map(() => randomHex(16));
  const tree = await buildHandTree(cards, salts);
  return { cards, salts, root: tree.root, tree };
}

// Full-hand reveal used by the post-match audit. Returns the canonical list
// so the verifier can rebuild the root independently.
export function handReveal(cards, salts) {
  return { cards: [...cards], salts: [...salts] };
}
