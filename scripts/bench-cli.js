import { benchTrees, benchKinetic } from '../engine/bench.js';
import { compare } from '../engine/sim.js';

console.log('\nBST vs AVL — nearly-sorted expiry keys (n inserts + n lookups)');
console.table(benchTrees().map((r) => ({ n: r.n, 'BST height': r.bst.height, 'AVL height': r.avl.height,
  'BST comparisons': r.bst.insertCmp + r.bst.findCmp, 'AVL comparisons': r.avl.insertCmp + r.avl.findCmp,
  'AVL rotations': r.avl.rotations, 'BST ms': r.bst.ms, 'AVL ms': r.avl.ms })));

console.log('Kinetic heap vs naive re-sort every minute (6-hour evening)');
console.table(benchKinetic().map((r) => ({ n: r.n, 'kinetic events': r.kineticEvents, 'kinetic ms': r.kineticMs,
  'naive ops': r.naiveOps, 'naive ms': r.naiveMs, 'work ratio': (r.naiveOps / Math.max(1, r.kineticCertUpdates)).toFixed(1) + '×' })));

console.log('Dispatch strategies — Bengaluru evening, seed 7');
const { results } = compare({ seed: 7, record: false });
console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
  'meals saved': v.metrics.saved, 'rescue %': (v.metrics.rescueRate * 100).toFixed(1),
  'spoiled at donor': v.metrics.spoiledAtDonor, 'spoiled in transit': v.metrics.spoiledInTransit, 'shelter full': v.metrics.shelterOverflow,
  'wasted trips': v.metrics.wastedTrips, 'meals / volunteer-hour': v.metrics.mealsPerVolunteerHour.toFixed(1) }])));
