// RoadGraph — Bengaluru road network as an undirected weighted graph (adjacency lists)
// with TIME-DEPENDENT edge costs: the minutes to cross an edge depend on when you enter it.
//
// travelTime(e, t) = baseMinutes(e) × congestion(roadClass, zone, t)
// Congestion is piecewise-linear in the hour of day, so travel time changes slowly enough
// (slope > -1) for the FIFO property to hold: leaving later never gets you there earlier.
// Under FIFO, Dijkstra on arrival times is exact (time-dependent Dijkstra).
//
// timeDependentDijkstra (single or multi-source)  O((V + E) log V)

import { MinHeap } from './minheap.js';

// Congestion multipliers by hour of day (index 0..23), interpolated linearly in between.
// Shape follows typical Bengaluru weekday traffic: morning peak ~9:00, evening peak ~19:00.
export const PROFILES = {
  arterial: [1.05, 1.0, 1.0, 1.0, 1.0, 1.05, 1.3, 1.7, 2.2, 2.4, 2.0, 1.7, 1.6, 1.6, 1.6, 1.7, 1.9, 2.2, 2.5, 2.6, 2.2, 1.8, 1.45, 1.2],
  local:    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.3, 1.6, 1.7, 1.5, 1.35, 1.3, 1.3, 1.3, 1.35, 1.45, 1.6, 1.75, 1.8, 1.6, 1.4, 1.2, 1.08],
};

/** Congestion factor at absolute time t (minutes since 00:00 of day 0). */
export function congestion(cls, zone, t) {
  const prof = PROFILES[cls] || PROFILES.local;
  const hour = (((t / 60) % 24) + 24) % 24;
  const h0 = Math.floor(hour), h1 = (h0 + 1) % 24, f = hour - h0;
  const base = prof[h0] * (1 - f) + prof[h1] * f;
  // zone > 0 means a congested core (CBD / tech corridor); it amplifies only the peak excess
  return 1 + (base - 1) * (1 + zone);
}

export class RoadGraph {
  constructor() {
    this.nodes = [];   // {id, x, y (km), lat, lng, zone}
    this.adj = [];     // adj[u] = [{to, km, base, cls}]
    this.edgeCount = 0;
  }

  addNode(n) {
    const id = this.nodes.length;
    this.nodes.push({ id, zone: 0, ...n });
    this.adj.push([]);
    return id;
  }

  addEdge(u, v, km, speedKmh, cls) {
    if (u === v || this.adj[u].some((e) => e.to === v)) return;
    const base = (km / speedKmh) * 60;   // free-flow minutes
    this.adj[u].push({ to: v, km, base, cls });
    this.adj[v].push({ to: u, km, base, cls });
    this.edgeCount++;
  }

  travelTime(u, e, t) {
    const zone = (this.nodes[u].zone + this.nodes[e.to].zone) / 2;
    return e.base * congestion(e.cls, zone, t);
  }

  distKm(u, v) {
    const a = this.nodes[u], b = this.nodes[v];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  nearestNode(x, y) {
    let best = 0, bd = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  /**
   * Time-dependent Dijkstra, single- or multi-source.
   * sources: [{node, t, tag}] — each source departs `node` at time `t`.
   * Returns earliest arrival per node, which source got there first (tag) and predecessors.
   * With several sources this computes a "who-arrives-first" partition of the city in ONE pass,
   * instead of one Dijkstra per volunteer.
   * opts.targets: Set of nodes — stop early once all are settled
   *   (or, with opts.firstTarget, as soon as the first one is settled: result.hit).
   */
  timeDependentDijkstra(sources, opts = {}) {
    const n = this.nodes.length;
    const arrive = new Float64Array(n).fill(Infinity);
    const tag = new Int32Array(n).fill(-1);
    const prev = new Int32Array(n).fill(-1);
    const km = new Float64Array(n).fill(0);
    const done = new Uint8Array(n);
    const pq = new MinHeap((x, y) => x[0] < y[0]);
    let settled = 0, hit = -1;

    for (const s of sources) {
      if (s.t < arrive[s.node]) {
        arrive[s.node] = s.t; tag[s.node] = s.tag ?? 0; prev[s.node] = -1;
        pq.push([s.t, s.node]);
      }
    }
    let remaining = opts.targets ? opts.targets.size : -1;

    while (pq.size) {
      const [t, u] = pq.pop();
      if (done[u]) continue;                 // stale entry (lazy deletion)
      done[u] = 1; settled++;
      if (opts.targets && opts.targets.has(u)) {
        if (opts.firstTarget) { hit = u; break; }
        if (--remaining === 0) break;
      }
      if (opts.until !== undefined && t > opts.until) break;
      for (const e of this.adj[u]) {
        if (done[e.to]) continue;
        const ta = t + this.travelTime(u, e, t);
        if (ta < arrive[e.to]) {
          arrive[e.to] = ta; tag[e.to] = tag[u]; prev[e.to] = u; km[e.to] = km[u] + e.km;
          pq.push([ta, e.to]);
        }
      }
    }
    return { arrive, tag, prev, km, settled, hit };
  }

  /** Rebuild the path ending at `target` as [{node, t}] from a Dijkstra result. */
  static path(res, target) {
    const out = [];
    for (let v = target; v !== -1; v = res.prev[v]) out.push({ node: v, t: res.arrive[v] });
    return out.reverse();
  }
}
