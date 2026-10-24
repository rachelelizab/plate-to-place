// Synthetic but realistic Bengaluru scenario generator (seeded, fully reproducible).
// Road grid over the city's bounding box, arterial corridors, congested core zones,
// donors / shelters / volunteers placed around real neighbourhoods.
// Donor and shelter names are generic labels, not real businesses.

import { RoadGraph } from './graph.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BBOX = { latMin: 12.83, latMax: 13.115, lngMin: 77.515, lngMax: 77.775 };
const KM_PER_LAT = 110.6, KM_PER_LNG = 108.4;
export const toXY = (lat, lng) => ({ x: (lng - BBOX.lngMin) * KM_PER_LNG, y: (BBOX.latMax - lat) * KM_PER_LAT });
export const WIDTH_KM = (BBOX.lngMax - BBOX.lngMin) * KM_PER_LNG;
export const HEIGHT_KM = (BBOX.latMax - BBOX.latMin) * KM_PER_LAT;

export const AREAS = [
  ['MG Road', 12.9756, 77.6050, 0.6], ['Majestic', 12.9767, 77.5713, 0.6],
  ['Indiranagar', 12.9784, 77.6408, 0.4], ['Koramangala', 12.9352, 77.6245, 0.5],
  ['HSR Layout', 12.9116, 77.6474, 0.3], ['BTM Layout', 12.9166, 77.6101, 0.35],
  ['Jayanagar', 12.9250, 77.5938, 0.3], ['JP Nagar', 12.9063, 77.5857, 0.2],
  ['Basavanagudi', 12.9422, 77.5755, 0.3], ['Malleshwaram', 13.0035, 77.5710, 0.3],
  ['Rajajinagar', 12.9910, 77.5525, 0.2], ['Hebbal', 13.0358, 77.5970, 0.4],
  ['Yelahanka', 13.1005, 77.5963, 0.0], ['Whitefield', 12.9698, 77.7500, 0.4],
  ['Marathahalli', 12.9569, 77.7011, 0.6], ['Bellandur', 12.9260, 77.6762, 0.6],
  ['Electronic City', 12.8452, 77.6602, 0.3], ['KR Puram', 13.0076, 77.6950, 0.5],
  ['Banashankari', 12.9255, 77.5468, 0.15], ['Yeshwanthpur', 13.0285, 77.5400, 0.2],
  ['RT Nagar', 13.0213, 77.5946, 0.2], ['Banaswadi', 13.0141, 77.6518, 0.2],
].map(([name, lat, lng, zone]) => ({ name, lat, lng, zone, ...toXY(lat, lng) }));

// Donor categories: portions range, safe shelf life (hours), posting window (hours, 24h clock)
export const DONOR_TYPES = [
  { type: 'Restaurant',       weight: 0.30, portions: [12, 55],  life: [2.5, 3.5], window: [21.5, 23.6] },
  { type: 'Wedding hall',     weight: 0.13, portions: [80, 260], life: [2.5, 3.5], window: [21.0, 23.0] },
  { type: 'Corporate canteen',weight: 0.15, portions: [40, 140], life: [2.0, 3.0], window: [19.0, 20.8] },
  { type: 'Hostel mess',      weight: 0.14, portions: [20, 70],  life: [2.5, 3.5], window: [20.8, 22.2] },
  { type: 'Hotel buffet',     weight: 0.13, portions: [30, 110], life: [1.5, 2.5], window: [22.2, 23.6] },
  { type: 'Bakery',           weight: 0.15, portions: [20, 70],  life: [8, 12],    window: [19.5, 22.0] },
];

const SHELTER_TYPES = ['Night shelter', "Children's home", 'Old-age home', "Workers' camp", 'Community kitchen'];

function pickWeighted(rng, list) {
  let r = rng() * list.reduce((s, x) => s + x.weight, 0);
  for (const x of list) { if ((r -= x.weight) <= 0) return x; }
  return list[list.length - 1];
}

const lerp = (a, b, f) => a + (b - a) * f;

/** Point near a neighbourhood (gaussian-ish scatter, km). */
function nearArea(rng, area, spread = 1.6) {
  const r = spread * Math.sqrt(-2 * Math.log(rng() + 1e-12)) * 0.6;
  const th = rng() * Math.PI * 2;
  return {
    x: Math.min(WIDTH_KM, Math.max(0, area.x + r * Math.cos(th))),
    y: Math.min(HEIGHT_KM, Math.max(0, area.y + r * Math.sin(th))),
  };
}

export function buildCity(seed = 7, cols = 19, rows = 22) {
  const rng = mulberry32(seed * 7919 + 13);
  const g = new RoadGraph();
  const dx = WIDTH_KM / (cols - 1), dy = HEIGHT_KM / (rows - 1);
  const id = (c, r) => r * cols + c;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * dx + (c > 0 && c < cols - 1 ? (rng() - 0.5) * dx * 0.45 : 0);
      const y = r * dy + (r > 0 && r < rows - 1 ? (rng() - 0.5) * dy * 0.45 : 0);
      // congestion zone: max influence of nearby busy areas
      let zone = 0;
      for (const a of AREAS) {
        const d = Math.hypot(a.x - x, a.y - y);
        zone = Math.max(zone, a.zone * Math.exp(-(d * d) / (2 * 2.2 * 2.2)));
      }
      g.addNode({ x, y, lat: BBOX.latMax - y / KM_PER_LAT, lng: BBOX.lngMin + x / KM_PER_LNG, zone });
    }
  }

  // Ring road approximation (Outer Ring Road-ish) around the centre
  const centre = toXY(12.972, 77.615);
  const onRing = (n) => { const d = Math.hypot(n.x - centre.x, n.y - centre.y); return d > 8.2 && d < 10.4; };
  const link = (u, v, arterialHint) => {
    const a = g.nodes[u], b = g.nodes[v];
    const km = Math.hypot(a.x - b.x, a.y - b.y) * 1.25; // road winding factor
    const arterial = arterialHint || (onRing(a) && onRing(b));
    g.addEdge(u, v, km, arterial ? 32 : 21, arterial ? 'arterial' : 'local');
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && (r % 5 === 2 || rng() > 0.07)) link(id(c, r), id(c + 1, r), r % 5 === 2);
      if (r + 1 < rows && (c % 5 === 2 || rng() > 0.07)) link(id(c, r), id(c, r + 1), c % 5 === 2);
      if (c + 1 < cols && r + 1 < rows && rng() < 0.18) link(id(c, r), id(c + 1, r + 1), false);
      if (c > 0 && r + 1 < rows && rng() < 0.12) link(id(c, r), id(c - 1, r + 1), false);
    }
  }
  // Ring links between ring nodes that are close but not grid-adjacent
  const ring = g.nodes.filter(onRing);
  for (const a of ring) for (const b of ring) {
    if (a.id < b.id) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < Math.max(dx, dy) * 1.05) link(a.id, b.id, true); }
  }
  // Guarantee connectivity (BFS from node 0, bridge any stragglers to the nearest reached node)
  for (;;) {
    const seen = new Uint8Array(g.nodes.length); const q = [0]; seen[0] = 1;
    while (q.length) { const u = q.pop(); for (const e of g.adj[u]) if (!seen[e.to]) { seen[e.to] = 1; q.push(e.to); } }
    const lost = g.nodes.find((n) => !seen[n.id]);
    if (!lost) break;
    let best = -1, bd = Infinity;
    for (const n of g.nodes) if (seen[n.id]) { const d = g.distKm(n.id, lost.id); if (d < bd) { bd = d; best = n.id; } }
    link(lost.id, best, false);
  }
  return { graph: g, cols, rows };
}

/**
 * Full scenario: city + donations + shelters + volunteers.
 * Times are absolute minutes since 00:00 (so 21:30 = 1290). Simulation runs 18:00 → 02:30.
 */
export function buildScenario({ seed = 7, donations = 160, volunteers = 20, shelters = 22 } = {}) {
  const { graph } = buildCity(seed);
  const rng = mulberry32(seed);
  const pickArea = () => AREAS[Math.floor(rng() * AREAS.length)];
  const counters = {};
  const BUSY = AREAS.filter((a) => a.zone >= 0.4);

  const shelterList = [];
  for (let i = 0; i < shelters; i++) {
    const area = AREAS[i % AREAS.length];
    const p = nearArea(rng, area, 2.4);
    const type = SHELTER_TYPES[Math.floor(rng() * SHELTER_TYPES.length)];
    shelterList.push({
      id: 'S' + (i + 1), node: graph.nearestNode(p.x, p.y), area: area.name, type,
      name: `${type}, ${area.name}`, capacity: Math.round(lerp(220, 640, rng()) / 10) * 10,
    });
  }

  const volunteerList = [];
  for (let i = 0; i < volunteers; i++) {
    const area = pickArea();
    const p = nearArea(rng, area, 2.0);
    volunteerList.push({ id: 'V' + (i + 1), node: graph.nearestNode(p.x, p.y), area: area.name, name: `Volunteer ${i + 1}` });
  }

  const donationList = [];
  for (let i = 0; i < donations; i++) {
    const dt = pickWeighted(rng, DONOR_TYPES);
    // busier areas get more donors
    let area = pickArea();
    if (rng() < 0.45) area = BUSY[Math.floor(rng() * BUSY.length)];
    const p = nearArea(rng, area, 1.8);
    const posted = Math.round(lerp(dt.window[0], dt.window[1], rng()) * 60);
    const life = Math.round(lerp(dt.life[0], dt.life[1], rng()) * 60);
    let portions = Math.round(lerp(dt.portions[0], dt.portions[1], rng() ** 1.4));
    counters[dt.type + area.name] = (counters[dt.type + area.name] || 0) + 1;
    donationList.push({
      id: 'D' + String(i + 1).padStart(3, '0'), node: graph.nearestNode(p.x, p.y),
      donorType: dt.type, area: area.name, donor: `${dt.type} #${counters[dt.type + area.name]}, ${area.name}`,
      portions, posted, expiry: posted + life,
    });
  }
  donationList.sort((a, b) => a.posted - b.posted || a.id.localeCompare(b.id));

  return {
    seed, graph, shelters: shelterList, volunteers: volunteerList, donations: donationList,
    start: 18 * 60, end: 26 * 60 + 30,
  };
}
