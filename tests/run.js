// Test suite: every hand-written structure is checked against a simple reference
// implementation on thousands of random operations, then the simulator's invariants.
// Run: npm test
import { HashMap } from '../engine/hashmap.js';
import { MinHeap } from '../engine/minheap.js';
import { BST } from '../engine/bst.js';
import { AVLTree } from '../engine/avl.js';
import { KineticHeap } from '../engine/kinetic.js';
import { RoadGraph } from '../engine/graph.js';
import { buildScenario, mulberry32 } from '../engine/city.js';
import { simulate, STRATEGIES } from '../engine/sim.js';

let pass = 0, fail = 0;
function test(name, fn) {
  const t0 = Date.now();
  try { fn(); pass++; console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const assert = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

console.log('\nHashMap');
test('matches JS Map over 20,000 random ops (with resizes)', () => {
  const rng = mulberry32(1), h = new HashMap(4), ref = new Map();
  for (let i = 0; i < 20000; i++) {
    const k = rng() < 0.5 ? Math.floor(rng() * 3000) : 'k' + Math.floor(rng() * 3000);
    const op = rng();
    if (op < 0.5) { h.set(k, i); ref.set(k, i); }
    else if (op < 0.75) eq(h.delete(k), ref.delete(k), 'delete');
    else eq(h.get(k), ref.get(k), 'get');
  }
  eq(h.size, ref.size, 'size');
  assert(h.stats.resizes > 5, 'expected resizes');
});

console.log('\nMinHeap (indexed)');
test('pop order equals sorted order', () => {
  const rng = mulberry32(2), hp = new MinHeap(), xs = [];
  for (let i = 0; i < 5000; i++) { const x = rng(); xs.push(x); hp.push(x); }
  xs.sort((a, b) => a - b);
  for (const x of xs) eq(hp.pop(), x);
});
test('upsert / remove by key keep heap order', () => {
  const rng = mulberry32(3), hp = new MinHeap((a, b) => a.p < b.p, (x) => x.k), ref = new Map();
  for (let i = 0; i < 8000; i++) {
    const k = Math.floor(rng() * 400), op = rng();
    if (op < 0.6) { const p = rng(); hp.upsert({ k, p }); ref.set(k, p); }
    else if (op < 0.8) { hp.remove(k); ref.delete(k); }
    else if (ref.size) {
      const min = Math.min(...ref.values());
      eq(hp.peek().p, min, 'min');
    }
  }
  eq(hp.size, ref.size);
});

console.log('\nBST vs AVL');
test('both match a sorted-array reference (insert/delete/range)', () => {
  const rng = mulberry32(4), bst = new BST(), avl = new AVLTree(), ref = new Set();
  for (let i = 0; i < 6000; i++) {
    const k = Math.floor(rng() * 2000);
    if (rng() < 0.65) { bst.insert(k); avl.insert(k); ref.add(k); }
    else { eq(bst.delete(k), ref.has(k)); eq(avl.delete(k), ref.has(k)); ref.delete(k); }
    if (i % 500 === 0) avl.check();
  }
  const sorted = [...ref].sort((a, b) => a - b);
  eq(bst.inorder(), sorted, 'bst inorder'); eq(avl.inorder(), sorted, 'avl inorder');
  const lo = 500, hi = 1200, want = sorted.filter((x) => x >= lo && x <= hi);
  eq(bst.rangeQuery(lo, hi), want, 'bst range'); eq(avl.rangeQuery(lo, hi), want, 'avl range');
  eq(avl.size, ref.size); eq(bst.size, ref.size);
});
test('sorted inserts: BST degenerates to height n, AVL stays ≤ 1.44·log2(n)', () => {
  const n = 4000, bst = new BST(), avl = new AVLTree();
  for (let i = 0; i < n; i++) { bst.insert(i); avl.insert(i); }
  eq(bst.height(), n, 'bst height');
  assert(avl.height() <= Math.ceil(1.44 * Math.log2(n + 2)), 'avl height ' + avl.height());
  avl.check();
});
test('AVL composite key (expiry, id) and popUpTo sweep', () => {
  const cmp = (x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
  const avl = new AVLTree(cmp);
  [[50, 'D2'], [30, 'D1'], [30, 'D3'], [90, 'D4']].forEach((k) => avl.insert(k, k[1]));
  eq(avl.rangeQuery([30, ''], [60, '￿']), ['D1', 'D3', 'D2']);
  eq(avl.popUpTo([50, '￿']), ['D1', 'D3', 'D2']);
  eq(avl.size, 1); avl.check();
});

console.log('\nKinetic heap');
test('top equals brute-force max at 1,000 random times (with inserts/removes)', () => {
  const rng = mulberry32(5), kh = new KineticHeap(0), live = new Map();
  let t = 0, id = 0;
  for (let step = 0; step < 1000; step++) {
    t += rng() * 3;
    kh.advance(t);
    const op = rng();
    if (op < 0.45 || live.size < 3) {
      const it = { id: 'x' + id++, a: 50 + rng() * 300 + t * rng() * 2, b: rng() * 2 };
      kh.insert(it); live.set(it.id, it);
    } else if (op < 0.65) {
      const keys = [...live.keys()]; const k = keys[Math.floor(rng() * keys.length)];
      kh.remove(k); live.delete(k);
    }
    kh.check();
    let best = -Infinity;
    for (const it of live.values()) best = Math.max(best, it.a - it.b * t);
    assert(Math.abs(kh.value(kh.top(), t) - best) < 1e-6, `top wrong at t=${t}`);
  }
  assert(kh.stats.events > 0, 'expected certificate events');
});
test('topK matches sorting all values', () => {
  const rng = mulberry32(6), kh = new KineticHeap(0), items = [];
  for (let i = 0; i < 300; i++) { const it = { id: 'y' + i, a: rng() * 500, b: rng() * 3 }; items.push(it); kh.insert(it); }
  kh.advance(60);
  const want = items.map((it) => it.a - it.b * 60).sort((a, b) => b - a).slice(0, 10);
  const got = kh.topK(10).map((it) => it.a - it.b * 60);
  got.forEach((g, i) => assert(Math.abs(g - want[i]) < 1e-9, 'topK mismatch'));
});
test('kinetic work is far below naive per-minute re-sorting', () => {
  const rng = mulberry32(7), kh = new KineticHeap(0);
  for (let i = 0; i < 500; i++) kh.insert({ id: 'z' + i, a: 100 + rng() * 400, b: rng() * 2 });
  for (let t = 1; t <= 300; t++) kh.advance(t);
  const naive = 500 * 300; // re-evaluating every item every minute
  assert(kh.stats.events < naive / 5, `events ${kh.stats.events} vs naive ${naive}`);
});

console.log('\nTime-dependent graph');
test('Dijkstra equals Bellman–Ford on static weights', () => {
  const g = new RoadGraph(), rng = mulberry32(8);
  for (let i = 0; i < 60; i++) g.addNode({ x: rng() * 10, y: rng() * 10 });
  for (let i = 0; i < 200; i++) { const u = Math.floor(rng() * 60), v = Math.floor(rng() * 60); g.addEdge(u, v, 0.5 + rng() * 3, 30, 'local'); }
  const t0 = 3 * 60; // 03:00 → congestion factor 1.0 everywhere
  const res = g.timeDependentDijkstra([{ node: 0, t: t0 }]);
  const d = new Array(60).fill(Infinity); d[0] = t0;
  for (let k = 0; k < 60; k++) for (let u = 0; u < 60; u++) for (const e of g.adj[u])
    if (d[u] + e.base < d[e.to]) d[e.to] = d[u] + e.base;
  for (let i = 0; i < 60; i++) assert(Math.abs(res.arrive[i] - d[i]) < 1e-6 || (d[i] === Infinity && res.arrive[i] === Infinity), 'node ' + i);
});
test('FIFO: leaving later never arrives earlier (city graph)', () => {
  const scn = buildScenario({ seed: 3 });
  for (let t = 17 * 60; t < 23 * 60; t += 10) {
    const a = scn.graph.timeDependentDijkstra([{ node: 5, t }]).arrive[300];
    const b = scn.graph.timeDependentDijkstra([{ node: 5, t: t + 10 }]).arrive[300];
    assert(b >= a - 1e-9, `FIFO violated at ${t}`);
  }
});
test('peak hour is slower than late night on the same route', () => {
  const scn = buildScenario({ seed: 3 });
  const peak = scn.graph.timeDependentDijkstra([{ node: 40, t: 19 * 60 }]).arrive[380] - 19 * 60;
  const night = scn.graph.timeDependentDijkstra([{ node: 40, t: 23 * 60 + 30 }]).arrive[380] - (23 * 60 + 30);
  assert(peak > night * 1.4, `peak ${peak.toFixed(1)} vs night ${night.toFixed(1)}`);
});

console.log('\nSimulator');
test('portion conservation: saved + spoiled = total, for every strategy', () => {
  const scn = buildScenario({ seed: 11 });
  for (const s of STRATEGIES) {
    const r = simulate(scn, s);
    const sum = r.trace.donations.reduce((a, d) => a + d.saved + d.spoiled, 0);
    eq(sum, r.metrics.totalPortions, s);
    eq(r.metrics.saved, r.trace.donations.reduce((a, d) => a + d.saved, 0), s + ' saved');
  }
});
test('Plate2Place never sends a volunteer on a trip that spoils', () => {
  for (const seed of [1, 2, 3]) {
    const m = simulate(buildScenario({ seed }), 'plate2place', { record: false }).metrics;
    eq(m.wastedTrips, 0, 'wasted trips seed ' + seed);
  }
});
test('Plate2Place saves more meals than both baselines (5 seeds)', () => {
  const tot = { fcfs: 0, nearest: 0, plate2place: 0 };
  for (const seed of [1, 2, 3, 4, 5]) {
    const scn = buildScenario({ seed });
    for (const s of STRATEGIES) tot[s] += simulate(scn, s, { record: false }).metrics.saved;
  }
  assert(tot.plate2place > tot.nearest && tot.nearest > tot.fcfs, JSON.stringify(tot));
});
test('deterministic: same seed gives identical results', () => {
  const a = simulate({ seed: 9 }, 'plate2place', { record: false }).metrics;
  const b = simulate({ seed: 9 }, 'plate2place', { record: false }).metrics;
  eq(a, b);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
