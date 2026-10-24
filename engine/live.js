// LiveDispatcher — the "real use" mode: a coordinator posts donations as they come in,
// and asks for the best pickup for a volunteer at a given place and time.
// Same structures as the simulator: KineticHeap (ranking), AVLTree (expiry index),
// HashMap (registry + claim locks), time-dependent Dijkstra (exact ETAs).

import { HashMap } from './hashmap.js';
import { AVLTree } from './avl.js';
import { KineticHeap } from './kinetic.js';
import { RoadGraph } from './graph.js';
import { buildScenario, toXY } from './city.js';
import { scenarioView } from './sim.js';

const expiryCmp = (x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
const PICKUP_MIN = 6, DROP_MIN = 5;

export class LiveDispatcher {
  constructor(seed = 7, now = 20 * 60) {
    const scn = buildScenario({ seed, donations: 0, volunteers: 0 });
    this.city = scenarioView(scn);
    this.graph = scn.graph;
    this.shelters = scn.shelters;
    this.now = now;
    this.donations = new HashMap(64);
    this.claims = new HashMap(32);
    this.kheap = new KineticHeap(now);
    this.avl = new AVLTree(expiryCmp);
    this.nextId = 1;
  }

  setTime(t) {
    if (t < this.now) throw new Error('time cannot go backwards');
    this.now = t;
    this.kheap.advance(t);
    const expired = this.avl.popUpTo([t, '￿']);
    for (const id of expired) {
      this.kheap.remove(id);
      const d = this.donations.get(id);
      if (d) d.status = 'spoiled';
    }
    return expired;
  }

  post({ donor = 'Donor', lat, lng, x, y, portions, lifeMinutes, t }) {
    if (t !== undefined) this.setTime(t);
    const p = x !== undefined ? { x, y } : toXY(lat, lng);
    portions = Math.max(1, Math.round(portions));
    lifeMinutes = Math.max(10, Math.round(lifeMinutes));
    const d = {
      id: 'L' + String(this.nextId++).padStart(3, '0'), donor, node: this.graph.nearestNode(p.x, p.y),
      portions, remaining: portions, posted: this.now, expiry: this.now + lifeMinutes, life: lifeMinutes, status: 'open',
    };
    this.donations.set(d.id, d);
    this.kheap.insert({ id: d.id, a: (d.remaining * d.expiry) / d.life, b: d.remaining / d.life });
    this.avl.insert([d.expiry, d.id], d.id);
    return this.view(d);
  }

  value(d) { return Math.max(0, (d.remaining * (d.expiry - this.now)) / d.life); }

  view(d) {
    const n = this.graph.nodes[d.node];
    return { id: d.id, donor: d.donor, portions: d.portions, remaining: d.remaining, posted: d.posted, expiry: d.expiry,
      status: d.status, claimedBy: this.claims.get(d.id) ?? null, value: +this.value(d).toFixed(1),
      minutesLeft: Math.round(d.expiry - this.now), x: n.x, y: n.y, node: d.node };
  }

  /** Open donations, ranked by the kinetic heap (value still savable right now). */
  ranked(k = 20) { return this.kheap.topK(k).map((it) => this.view(this.donations.get(it.id))); }

  /** AVL range query: open donations spoiling within the next `minutes`. */
  urgent(minutes = 60) {
    return this.avl.rangeQuery([this.now, ''], [this.now + minutes, '￿']).map((id) => this.view(this.donations.get(id)));
  }

  /** Best feasible pickup for a volunteer: exact time-dependent routes for both legs. */
  recommend({ lat, lng, x, y, cap = 45, volunteer = 'V' }) {
    const p = x !== undefined ? { x, y } : toXY(lat, lng);
    const start = this.graph.nearestNode(p.x, p.y);
    const ids = new HashMap(32);
    for (const it of this.kheap.topK(16)) ids.set(it.id, true);
    for (const id of this.avl.rangeQuery([this.now, ''], [this.now + 90, '￿'])) ids.set(id, true);
    const cands = [...ids.keys()].filter((id) => !this.claims.has(id));
    if (!cands.length) return { options: [], reason: 'No open donations.' };
    const res = this.graph.timeDependentDijkstra([{ node: start, t: this.now }],
      { targets: new Set(cands.map((id) => this.donations.get(id).node)) });
    const options = [];
    for (const id of cands) {
      const d = this.donations.get(id);
      const ta = res.arrive[d.node];
      const load = Math.min(cap, d.remaining);
      const sTargets = new Set(this.shelters.map((s) => s.node));
      const r2 = this.graph.timeDependentDijkstra([{ node: d.node, t: ta + PICKUP_MIN }], { targets: sTargets, firstTarget: true });
      const eta = r2.arrive[r2.hit] + DROP_MIN;
      const shelter = this.shelters.find((s) => s.node === r2.hit);
      const feasible = eta <= d.expiry - 3;
      const minutes = eta - this.now;
      const urgency = 1 + 0.6 * Math.max(0, 1 - (d.expiry - eta) / 90);
      options.push({
        donation: this.view(d), feasible, load, arriveDonor: ta, deliverBy: eta, shelter: shelter?.name,
        minutes: +minutes.toFixed(1), score: feasible ? +((load / minutes) * urgency).toFixed(3) : 0,
        routeToDonor: RoadGraph.path(res, d.node).map((q) => q.node),
        routeToShelter: RoadGraph.path(r2, r2.hit).map((q) => q.node),
      });
    }
    options.sort((a, b) => b.score - a.score || a.minutes - b.minutes);
    return { volunteer, from: start, options };
  }

  claim(id, volunteer) {
    const d = this.donations.get(id);
    if (!d) throw new Error('unknown donation ' + id);
    if (this.claims.has(id)) throw new Error(`${id} already claimed by ${this.claims.get(id)}`);
    this.claims.set(id, volunteer);
    d.status = 'claimed';
    return this.view(d);
  }

  complete(id) {
    const d = this.donations.get(id);
    if (!d) throw new Error('unknown donation ' + id);
    this.claims.delete(id);
    this.kheap.remove(id);
    this.avl.delete([d.expiry, d.id]);
    d.status = 'collected';
    return this.view(d);
  }

  state() {
    return { now: this.now, open: this.kheap.size, ranked: this.ranked(), urgent: this.urgent(60),
      avlHeight: this.avl.height(), kineticEvents: this.kheap.stats.events };
  }
}
