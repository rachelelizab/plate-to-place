// Plate2Place backend — zero-dependency Node.js HTTP server.
//   npm start            → http://localhost:3000
// Serves the frontend (frontend/dist/index.html, built by `npm run build`) and a JSON API.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildScenario } from '../engine/city.js';
import { simulate, STRATEGIES, scenarioView } from '../engine/sim.js';
import { benchTrees, benchKinetic } from '../engine/bench.js';
import { LiveDispatcher } from '../engine/live.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;

const live = new LiveDispatcher(7, 20 * 60);
const cache = new Map();   // small LRU of simulation runs keyed by parameters

const clampInt = (v, lo, hi, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function params(q) {
  return {
    seed: clampInt(q.get('seed'), 1, 9999, 7),
    donations: clampInt(q.get('donations'), 20, 400, 160),
    volunteers: clampInt(q.get('volunteers'), 4, 80, 20),
    shelters: clampInt(q.get('shelters'), 4, 40, 22),
  };
}

function runAll(p) {
  const key = JSON.stringify(p);
  if (cache.has(key)) return cache.get(key);
  const scn = buildScenario(p);
  const t0 = performance.now();
  const results = {};
  for (const s of STRATEGIES) results[s] = simulate(scn, s);
  const out = { params: p, scenario: scenarioView(scn), results, computeMs: +(performance.now() - t0).toFixed(1) };
  cache.set(key, out);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  return out;
}

async function body(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 1e5) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}

const routes = {
  'GET /api/health': () => ({ ok: true, service: 'plate2place', engine: 'node ' + process.version, strategies: STRATEGIES }),
  'GET /api/run': (q) => runAll(params(q)),
  'GET /api/simulate': (q) => {
    const p = params(q), s = q.get('strategy') || 'plate2place';
    if (!STRATEGIES.includes(s)) throw Object.assign(new Error('unknown strategy'), { status: 400 });
    return simulate(buildScenario(p), s);
  },
  'GET /api/compare': (q) => {
    const seeds = (q.get('seeds') || '1,2,3,4,5').split(',').map(Number).filter(Number.isFinite).slice(0, 10);
    const p = params(q);
    return seeds.map((seed) => {
      const scn = buildScenario({ ...p, seed });
      return { seed, ...Object.fromEntries(STRATEGIES.map((s) => [s, simulate(scn, s, { record: false }).metrics])) };
    });
  },
  'GET /api/bench/trees': () => benchTrees(),
  'GET /api/bench/kinetic': () => benchKinetic(),
  'GET /api/live/city': () => live.city,
  'GET /api/live/state': () => live.state(),
  'GET /api/live/urgent': (q) => live.urgent(clampInt(q.get('within'), 5, 600, 60)),
  'POST /api/live/time': (_, b) => ({ expired: live.setTime(Number(b.t)), state: live.state() }),
  'POST /api/live/donations': (_, b) => live.post(b),
  'POST /api/live/recommend': (_, b) => live.recommend(b),
  'POST /api/live/claim': (_, b) => live.claim(b.id, b.volunteer),
  'POST /api/live/complete': (_, b) => live.complete(b.id),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, data, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  try {
    if (req.method === 'OPTIONS') return send(204, '', 'text/plain');
    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) {
      const b = req.method === 'POST' ? await body(req) : null;
      const t0 = performance.now();
      const data = handler(url.searchParams, b);
      console.log(`${req.method} ${url.pathname}${url.search} ${(performance.now() - t0).toFixed(1)}ms`);
      return send(200, data);
    }
    if (url.pathname.startsWith('/api/')) return send(404, { error: 'no such endpoint' });
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(path.join(ROOT, 'frontend', 'dist', 'index.html'), 'utf8')
        .catch(() => '<h1>Run <code>npm run build</code> first</h1>');
      return send(200, html, 'text/html; charset=utf-8');
    }
    send(404, 'Not found', 'text/plain');
  } catch (e) {
    send(e.status || 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Plate2Place running at http://localhost:${PORT}`));
