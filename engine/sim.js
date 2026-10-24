// Event-driven simulation of one evening of surplus-food rescue in Bengaluru.
//
// Three dispatch strategies run on the SAME scenario so the comparison is fair:
//   fcfs     — WhatsApp-style: an idle volunteer takes the oldest open post (a FIFO queue).
//   nearest  — an idle volunteer takes the open post that is closest in travel time.
//   plate2place — the proposed method:
//       * KineticHeap keeps donations ranked by value still savable, P·(expiry − t)/life,
//         which decays continuously; only certificate failures cost work.
//       * AVLTree keyed on (expiry, id) gives "spoils within the next hour" and the
//         expiry sweep, both O(log n + k).
//       * Time-dependent Dijkstra from the volunteer gives exact arrival times for this
//         departure time; a multi-source Dijkstra from all shelters gives a delivery-leg field.
//       * A trip is only taken if the food reaches a shelter before it expires;
//         among feasible trips the one with most meals saved per volunteer-minute wins.
//       * HashMap claim locks stop two volunteers from going to the same post.
//
// All times are minutes since 00:00 (21:30 = 1290; 01:00 next day = 1500).

import { HashMap } from './hashmap.js';
import { MinHeap } from './minheap.js';
import { AVLTree } from './avl.js';
import { KineticHeap } from './kinetic.js';
import { RoadGraph } from './graph.js';
import { buildScenario, mulberry32 } from './city.js';

export const STRATEGIES = ['fcfs', 'nearest', 'plate2place'];
export const STRATEGY_LABEL = { fcfs: 'First come, first served', nearest: 'Nearest first', plate2place: 'Plate2Place' };

const PICKUP_MIN = 6, DROP_MIN = 5;
const expiryCmp = (x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);

function volunteerFleet(scn) {
  const rng = mulberry32(scn.seed * 31 + 5);
  return scn.volunteers.map((v) => {
    const car = rng() < 0.35;
    const shiftStart = 18 * 60 + Math.round(rng() * 3.5 * 60 / 5) * 5;          // 18:00 – 21:30
    const shiftEnd = Math.min(scn.end, shiftStart + Math.round((3 + rng() * 2.5) * 60 / 5) * 5);
    return { ...v, vehicle: car ? 'Car' : 'Scooter', cap: car ? 180 : 45, shiftStart, shiftEnd };
  });
}

export function simulate(scnOrOpts = {}, strategy = 'plate2place', opts = {}) {
  const scn = scnOrOpts.graph ? scnOrOpts : buildScenario(scnOrOpts);
  const { graph } = scn;
  const record = opts.record !== false;
  const K = opts.topK ?? 16;
  const URGENT_WINDOW = opts.urgentWindow ?? 90;
  const URGENCY_W = opts.urgencyWeight ?? 0.6;

  // ---------- state ----------
  const donations = new HashMap(256);           // id -> donation state
  for (const d of scn.donations) {
    donations.set(d.id, { ...d, remaining: d.portions, life: d.expiry - d.posted, status: 'scheduled',
      saved: 0, spoiled: 0, pickups: [] });
  }
  const shelterCap = new HashMap(64);
  for (const s of scn.shelters) shelterCap.set(s.id, s.capacity);
  const shelterByNode = new HashMap(64);
  for (const s of scn.shelters) {
    if (!shelterByNode.has(s.node)) shelterByNode.set(s.node, []);
    shelterByNode.get(s.node).push(s);
  }
  const fleet = volunteerFleet(scn);
  const vol = new HashMap(64);
  for (const v of fleet) vol.set(v.id, { ...v, at: v.node, busy: false, legs: [], trips: 0, minutesBusy: 0, km: 0, saved: 0 });

  // open-post structures (each strategy uses what it needs; all stay in sync)
  const kheap = new KineticHeap(scn.start);   // plate2place ranking
  const avl = new AVLTree(expiryCmp);          // plate2place urgency + every strategy's expiry sweep
  const fifo = [];                              // fcfs queue (array + head pointer)
  let fifoHead = 0;
  const open = new HashMap(256);                // id -> true while postable
  const claimed = new HashMap(64);              // claim locks: donation id -> volunteer id

  const metrics = { saved: 0, spoiledAtDonor: 0, spoiledInTransit: 0, shelterOverflow: 0, wastedTrips: 0, trips: 0,
    volunteerMinutes: 0, km: 0, dijkstraRuns: 0, nodesSettled: 0, decisions: 0, partialPickups: 0 };
  const log = [];
  const snapshots = [];
  const swaps = [];
  if (record) kheap.onSwap = (t, up, down) => { if (swaps.length < 4000) swaps.push({ t, up: up.id, down: down.id }); };

  const say = (t, kind, text, extra = {}) => { if (record) log.push({ t, kind, text, ...extra }); };

  const priorityItem = (d) => ({ id: d.id, a: (d.remaining * d.expiry) / d.life, b: d.remaining / d.life });

  function openPost(d) {
    open.set(d.id, true);
    d.status = 'open';
    kheap.insert(priorityItem(d));
    avl.insert([d.expiry, d.id], d.id);
    fifo.push(d.id);
  }

  function closePost(d) {
    open.delete(d.id);
    kheap.remove(d.id);
    avl.delete([d.expiry, d.id]);
    // fifo uses lazy deletion: closed ids are skipped when read
  }

  // ---------- shelter field (multi-source Dijkstra, cached per 15-minute bucket) ----------
  let field = null, fieldKey = -1;
  function shelterField(t) {
    const key = Math.floor(t / 15);
    if (field && fieldKey === key) return field;
    const sources = [];
    scn.shelters.forEach((s, i) => { if (shelterCap.get(s.id) > 0) sources.push({ node: s.node, t, tag: i }); });
    const res = graph.timeDependentDijkstra(sources);
    metrics.dijkstraRuns++; metrics.nodesSettled += res.settled;
    field = res; fieldKey = key;
    return field;
  }
  const invalidateField = () => { field = null; };

  // exact delivery leg: depart `node` at time t, reach first shelter with free capacity
  function routeToShelter(node, t, load) {
    let targets = new Set(scn.shelters.filter((s) => shelterCap.get(s.id) >= load).map((s) => s.node));
    if (!targets.size) targets = new Set(scn.shelters.filter((s) => shelterCap.get(s.id) > 0).map((s) => s.node));
    if (!targets.size) return null;
    const res = graph.timeDependentDijkstra([{ node, t, tag: 0 }], { targets, firstTarget: true });
    metrics.dijkstraRuns++; metrics.nodesSettled += res.settled;
    if (res.hit < 0) return null;
    const shelter = shelterByNode.get(res.hit).find((s) => shelterCap.get(s.id) > 0);
    return { shelter, arrive: res.arrive[res.hit], km: res.km[res.hit], path: RoadGraph.path(res, res.hit) };
  }

  // ---------- strategies: choose a donation for an idle volunteer at time t ----------
  function candidatesFor(strategyName, t) {
    if (strategyName === 'fcfs') {
      while (fifoHead < fifo.length && (!open.has(fifo[fifoHead]) || claimed.has(fifo[fifoHead]))) fifoHead++;
      // first open, unclaimed post in posting order
      for (let i = fifoHead; i < fifo.length; i++) {
        const id = fifo[i];
        if (open.has(id) && !claimed.has(id)) return [id];
      }
      return [];
    }
    if (strategyName === 'nearest') {
      const ids = [];
      for (const [id] of open) if (!claimed.has(id)) ids.push(id);
      return ids;
    }
    // plate2place: top-K by decaying value  ∪  everything spoiling within the urgent window
    kheap.advance(t);
    const set = new HashMap(32);
    for (const it of kheap.topK(K)) set.set(it.id, true);
    for (const id of avl.rangeQuery([t, ''], [t + URGENT_WINDOW, '￿'])) set.set(id, true);
    const ids = [];
    for (const [id] of set) if (!claimed.has(id)) ids.push(id);
    return ids;
  }

  function choose(v, t) {
    const ids = candidatesFor(strategy, t);
    if (!ids.length) return null;
    metrics.decisions++;
    if (strategy === 'fcfs') return { id: ids[0] };

    const targets = new Set(ids.map((id) => donations.get(id).node));
    const res = graph.timeDependentDijkstra([{ node: v.at, t, tag: 0 }], { targets });
    metrics.dijkstraRuns++; metrics.nodesSettled += res.settled;

    if (strategy === 'nearest') {
      let best = null;
      for (const id of ids) {
        const ta = res.arrive[donations.get(id).node];
        if (!best || ta < best.ta || (ta === best.ta && id < best.id)) best = { id, ta };
      }
      return best;
    }

    // plate2place: exact feasibility + meals saved per volunteer-minute
    const fld = shelterField(t);
    const scored = [];
    for (const id of ids) {
      const d = donations.get(id);
      const ta = res.arrive[d.node];
      if (!(ta < Infinity)) continue;
      // cheap filter with the multi-source shelter field before the exact check
      const est = ta + PICKUP_MIN + (fld.arrive[d.node] - t) + DROP_MIN;
      if (est > d.expiry + 20) continue;
      scored.push({ d, ta });
    }
    let best = null;
    for (const { d, ta } of scored) {
      const load = Math.min(v.cap, d.remaining);
      const leg = routeToShelter(d.node, ta + PICKUP_MIN, load);  // exact, early-stopping Dijkstra
      if (!leg) continue;
      const eta = leg.arrive + DROP_MIN;
      if (eta > d.expiry - 3) continue;                           // would spoil: never send anyone
      const minutes = eta - t;
      const slack = d.expiry - eta;
      const urgency = 1 + URGENCY_W * Math.max(0, 1 - slack / 90); // favour posts few others could still save
      const score = (load / minutes) * urgency;
      if (!best || score > best.score) best = { id: d.id, ta, score, eta };
    }
    return best;
  }

  // ---------- event loop ----------
  const events = new MinHeap((x, y) => x.t < y.t || (x.t === y.t && x.seq < y.seq));
  let seq = 0;
  const schedule = (t, kind, data = {}) => events.push({ t, kind, seq: seq++, ...data });
  for (const d of scn.donations) schedule(d.posted, 'post', { id: d.id });
  for (const v of fleet) { schedule(v.shiftStart, 'shiftStart', { vid: v.id }); }
  for (let t = scn.start; t <= scn.end + 45; t += 2) schedule(t, 'snapshot');   // +45: trips under way at 02:30 finish

  const idle = new HashMap(64);   // volunteers waiting for work

  function sweepExpired(t) {
    for (const id of avl.popUpTo([t, '￿'])) {
      const d = donations.get(id);
      // avl already removed it; clean the others
      open.delete(id); kheap.remove(id);
      if (claimed.has(id)) continue;           // someone is on the way: decided at arrival
      d.status = d.saved > 0 ? 'partial' : 'spoiled';
      d.spoiled += d.remaining;
      metrics.spoiledAtDonor += d.remaining;
      say(t, 'spoil', `${d.donor}: ${d.remaining} portions spoiled before pickup`, { id });
      d.remaining = 0;
    }
  }

  function startTrip(v, pick, t) {
    const d = donations.get(pick.id);
    claimed.set(d.id, v.id);
    idle.delete(v.id);
    v.busy = true;
    // exact leg 1: volunteer -> donor
    const r1 = graph.timeDependentDijkstra([{ node: v.at, t, tag: 0 }], { targets: new Set([d.node]) });
    metrics.dijkstraRuns++; metrics.nodesSettled += r1.settled;
    const arrive = r1.arrive[d.node];
    const path1 = RoadGraph.path(r1, d.node);
    v.legs.push({ kind: 'toDonor', donation: d.id, from: t, to: arrive, path: path1.map((p) => [p.node, +p.t.toFixed(2)]) });
    v.km += r1.km[d.node];
    d.status = 'claimed';
    if (!d.firstClaim) d.firstClaim = t;
    say(t, 'assign', `${v.name} (${v.vehicle}) → ${d.donor}`, { vid: v.id, id: d.id, eta: arrive });
    schedule(arrive, 'arriveDonor', { vid: v.id, id: d.id });
  }

  function dispatch(t) {
    if (!idle.size) return;
    // stable order for reproducibility
    const ids = [...idle.keys()].sort();
    for (const vid of ids) {
      const v = vol.get(vid);
      if (t >= v.shiftEnd) { idle.delete(vid); continue; }
      const pick = choose(v, t);
      if (pick) startTrip(v, pick, t);
    }
  }

  function finishLeg(v, t) {
    v.busy = false;
    if (t < v.shiftEnd) idle.set(v.id, true);
  }

  while (events.size) {
    const ev = events.pop();
    const t = ev.t;
    if (t > scn.end + 240) break;
    sweepExpired(t);

    switch (ev.kind) {
      case 'post': {
        const d = donations.get(ev.id);
        openPost(d);
        say(t, 'post', `${d.donor} posted ${d.portions} portions (safe until ${fmt(d.expiry)})`, { id: d.id });
        dispatch(t);
        break;
      }
      case 'shiftStart': {
        const v = vol.get(ev.vid);
        idle.set(v.id, true);
        say(t, 'shift', `${v.name} (${v.vehicle}, ${v.area}) comes online`, { vid: v.id });
        dispatch(t);
        break;
      }
      case 'arriveDonor': {
        const v = vol.get(ev.vid), d = donations.get(ev.id);
        v.at = d.node;
        if (t > d.expiry || d.remaining <= 0) {
          claimed.delete(d.id);
          metrics.wastedTrips++;
          if (d.remaining > 0 && !open.has(d.id)) {
            d.spoiled += d.remaining; metrics.spoiledAtDonor += d.remaining;
            d.status = d.saved > 0 ? 'partial' : 'spoiled';
            say(t, 'wasted', `${v.name} reached ${d.donor} at ${fmt(t)} — food expired at ${fmt(d.expiry)}`, { vid: v.id, id: d.id });
            d.remaining = 0;
          } else {
            say(t, 'wasted', `${v.name} reached ${d.donor} — nothing left to collect`, { vid: v.id, id: d.id });
          }
          v.legs[v.legs.length - 1].wasted = true;
          finishLeg(v, t); dispatch(t);
          break;
        }
        const load = Math.min(v.cap, d.remaining);
        d.remaining -= load;
        d.pickups.push({ t, vid: v.id, load });
        claimed.delete(d.id);
        if (d.remaining > 0) {
          // partial pickup: re-key the kinetic item with the smaller portion count
          metrics.partialPickups++;
          kheap.remove(d.id);
          if (open.has(d.id)) kheap.insert(priorityItem(d));
          d.status = 'open';
          say(t, 'pickup', `${v.name} collected ${load} of ${load + d.remaining} portions at ${d.donor} (vehicle full)`, { vid: v.id, id: d.id });
        } else {
          closePost(d);
          d.status = 'transit';
          say(t, 'pickup', `${v.name} collected ${load} portions at ${d.donor}`, { vid: v.id, id: d.id });
        }
        const depart = t + PICKUP_MIN;
        const r = routeToShelter(d.node, depart, load);
        if (!r) { finishLeg(v, depart); break; }
        v.legs.push({ kind: 'toShelter', donation: d.id, shelter: r.shelter.id, load, from: depart, to: r.arrive,
          path: r.path.map((p) => [p.node, +p.t.toFixed(2)]) });
        v.km += r.km;
        schedule(r.arrive, 'arriveShelter', { vid: v.id, id: d.id, sid: r.shelter.id, load, expiry: d.expiry });
        dispatch(t);
        break;
      }
      case 'arriveShelter': {
        const v = vol.get(ev.vid), d = donations.get(ev.id);
        const s = scn.shelters.find((x) => x.id === ev.sid);
        v.at = s.node;
        v.trips++; metrics.trips++;
        if (t > ev.expiry) {
          d.spoiled += ev.load; metrics.spoiledInTransit += ev.load;
          say(t, 'spoil', `${v.name} reached ${s.name} at ${fmt(t)} — ${ev.load} portions expired on the way`, { vid: v.id, id: d.id, sid: s.id });
          v.legs[v.legs.length - 1].spoiled = true;
        } else {
          const cap = shelterCap.get(s.id);
          const used = Math.min(cap, ev.load);
          shelterCap.set(s.id, cap - used);
          if (cap - used <= 0) invalidateField();
          d.saved += used; v.saved += used; metrics.saved += used;
          if (used < ev.load) { d.spoiled += ev.load - used; metrics.shelterOverflow += ev.load - used; }
          say(t, 'deliver', `${v.name} delivered ${used} portions to ${s.name}`, { vid: v.id, id: d.id, sid: s.id, load: used });
        }
        if (d.remaining === 0 && !claimed.has(d.id)) d.status = d.spoiled === 0 ? 'saved' : d.saved > 0 ? 'partial' : 'spoiled';
        schedule(t + DROP_MIN, 'free', { vid: v.id });
        break;
      }
      case 'free': {
        const v = vol.get(ev.vid);
        finishLeg(v, t);
        dispatch(t);
        break;
      }
      case 'snapshot': {
        if (!record) break;
        kheap.advance(Math.max(kheap.now, t));
        const top = kheap.topK(8).map((it) => ({ id: it.id, v: +(it.a - it.b * t).toFixed(1) }));
        snapshots.push({
          t, top, avl: avl.toTree(5), avlSize: avl.size, avlHeight: avl.height(),
          open: open.size, saved: metrics.saved, spoiled: metrics.spoiledAtDonor + metrics.spoiledInTransit,
          kEvents: kheap.stats.events, idle: idle.size,
        });
        break;
      }
    }
  }

  // anything left open at the end of the night spoils
  for (const d of donations.values()) {
    if (d.remaining > 0) { d.spoiled += d.remaining; metrics.spoiledAtDonor += d.remaining; d.remaining = 0;
      d.status = d.saved > 0 ? 'partial' : 'spoiled'; }
    if (d.status === 'transit' || d.status === 'claimed') d.status = d.saved > 0 ? (d.spoiled ? 'partial' : 'saved') : 'spoiled';
  }

  for (const v of vol.values()) {
    for (const l of v.legs) v.minutesBusy += l.to - l.from;
    metrics.volunteerMinutes += v.minutesBusy;
    metrics.km += v.km;
  }
  const total = scn.donations.reduce((s, d) => s + d.portions, 0);
  metrics.totalPortions = total;
  metrics.rescueRate = metrics.saved / total;
  metrics.mealsPerVolunteerHour = metrics.volunteerMinutes ? metrics.saved / (metrics.volunteerMinutes / 60) : 0;
  metrics.km = +metrics.km.toFixed(1);
  metrics.kinetic = { ...kheap.stats };
  metrics.avl = { ...avl.stats, finalHeight: avl.height() };

  return {
    strategy, metrics,
    trace: record ? {
      volunteers: [...vol.values()].map((v) => ({ id: v.id, name: v.name, vehicle: v.vehicle, cap: v.cap, area: v.area,
        home: v.node, shiftStart: v.shiftStart, shiftEnd: v.shiftEnd, legs: v.legs, trips: v.trips, saved: v.saved })),
      donations: [...donations.values()].map((d) => ({ id: d.id, donor: d.donor, donorType: d.donorType, area: d.area,
        node: d.node, portions: d.portions, posted: d.posted, expiry: d.expiry, saved: d.saved, spoiled: d.spoiled,
        status: d.status, pickups: d.pickups })),
      log, snapshots, swaps,
    } : null,
  };
}

export function fmt(t) {
  const m = ((Math.round(t) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** Run all strategies on one scenario. */
export function compare(opts = {}) {
  const scn = buildScenario(opts);
  const out = {};
  for (const s of STRATEGIES) out[s] = simulate(scn, s, { record: opts.record !== false });
  return { scenario: scn, results: out };
}

/** Serialisable view of a scenario for the frontend. */
export function scenarioView(scn) {
  const edges = [];
  scn.graph.adj.forEach((list, u) => list.forEach((e) => { if (u < e.to) edges.push([u, e.to, e.cls === 'arterial' ? 1 : 0]); }));
  return {
    seed: scn.seed, start: scn.start, end: scn.end, stop: scn.end + 45,
    nodes: scn.graph.nodes.map((n) => [+n.x.toFixed(3), +n.y.toFixed(3), +n.zone.toFixed(2)]),
    edges, shelters: scn.shelters,
  };
}
