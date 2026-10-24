// Benchmarks used by the API, the CLI and the frontend "Benchmarks" tab.

import { BST } from './bst.js';
import { AVLTree } from './avl.js';
import { KineticHeap } from './kinetic.js';
import { mulberry32 } from './city.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Insert n keys in arrival order (nearly sorted, like expiry times of donations posted
 * through the evening), then run n lookups. Reports height, comparisons and time.
 */
export function benchTrees(sizes = [250, 500, 1000, 2000, 4000]) {
  const rows = [];
  for (const n of sizes) {
    const rng = mulberry32(n);
    // nearly-sorted expiry minutes: arrival order + small jitter
    const keys = Array.from({ length: n }, (_, i) => i * 3 + Math.floor(rng() * 4) + (i % 7) * 0.001);
    const row = { n };
    for (const [name, Tree] of [['bst', BST], ['avl', AVLTree]]) {
      const tr = new Tree();
      const t0 = now();
      for (const k of keys) tr.insert(k);
      const insertCmp = tr.stats.comparisons;
      for (let i = 0; i < n; i++) tr.find(keys[Math.floor(rng() * n)]);
      const t1 = now();
      row[name] = { height: tr.height(), insertCmp, findCmp: tr.stats.comparisons - insertCmp, ms: +(t1 - t0).toFixed(2),
        rotations: tr.stats.rotations ?? 0 };
    }
    rows.push(row);
  }
  return rows;
}

/**
 * n items with linearly decaying priorities over `minutes`.
 * Naive: every minute recompute every priority and rebuild the order (n per tick, plus n log n sort).
 * Kinetic: only certificate failures are processed.
 */
export function benchKinetic(sizes = [100, 250, 500, 1000, 2000], minutes = 360) {
  const rows = [];
  for (const n of sizes) {
    const rng = mulberry32(n * 3 + 1);
    const items = Array.from({ length: n }, (_, i) => {
      const portions = 10 + rng() * 200, life = 90 + rng() * 300, expiry = rng() * minutes + life * 0.5;
      return { id: 'i' + i, a: (portions * expiry) / life, b: portions / life };
    });
    const kh = new KineticHeap(0);
    let t0 = now();
    for (const it of items) kh.insert({ ...it });
    for (let t = 1; t <= minutes; t++) kh.advance(t);
    const kMs = now() - t0;

    t0 = now();
    let naiveOps = 0, checksum = 0;
    for (let t = 1; t <= minutes; t++) {
      const vals = items.map((it) => it.a - it.b * t);
      naiveOps += n;
      vals.sort((x, y) => y - x);
      naiveOps += Math.ceil(n * Math.log2(n));
      checksum += vals[0];
    }
    const nMs = now() - t0;
    rows.push({ n, minutes, kineticEvents: kh.stats.events, kineticSwaps: kh.stats.swaps, kineticCertUpdates: kh.stats.certUpdates,
      kineticMs: +kMs.toFixed(2), naiveOps, naiveMs: +nMs.toFixed(2), checksum: Math.round(checksum) });
  }
  return rows;
}
