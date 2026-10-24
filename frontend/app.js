/* Plate2Place frontend. Uses the Node API when served by `npm start`; otherwise runs the same engine in the browser. */
(() => {
  'use strict';
  const E = window.P2P;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmt = E.fmt;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LABEL = { fcfs: 'First come, first served', nearest: 'Nearest first', plate2place: 'Plate2Place' };
  const SHORT = { fcfs: 'First come', nearest: 'Nearest', plate2place: 'Plate2Place' };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  // ---------------------------------------------------------------- theme colours
  let C = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['bg', 'surface', 'sunk', 'ink', 'muted', 'line', 'accent', 'fresh', 'warn', 'spoil', 'route', 'map-bg', 'road', 'artery', 'zone', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
      C[k] = cs.getPropertyValue('--' + k).trim();
  }
  readColors();
  const onTheme = () => { readColors(); maps.forEach((m) => m.invalidate()); if (state.view === 'compare') renderCompare(); if (state.view === 'lab') renderKineticLab(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------- backend adapter
  const api = { server: false };
  async function detectServer() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j.service === 'plate2place') {
        api.server = true;
        $('#engine-badge').innerHTML = `<i></i>API · ${esc(j.engine)}`;
        $('#engine-badge').title = 'Simulations and the dispatch desk run on the Node.js backend';
      }
    } catch { /* static hosting: stay in browser mode */ }
  }
  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }
  const qs = (p) => new URLSearchParams(p).toString();

  async function runEvening(p) {
    if (api.server) return getJSON('api/run?' + qs(p));
    const scn = E.buildScenario(p);
    const t0 = performance.now();
    const results = {};
    for (const s of E.STRATEGIES) results[s] = E.simulate(scn, s);
    return { params: p, scenario: E.scenarioView(scn), results, computeMs: +(performance.now() - t0).toFixed(1) };
  }
  async function compareSeeds(p, seeds) {
    if (api.server) return getJSON('api/compare?' + qs({ ...p, seeds: seeds.join(',') }));
    const out = [];
    for (const seed of seeds) {
      await new Promise((r) => setTimeout(r, 0));
      const scn = E.buildScenario({ ...p, seed });
      out.push({ seed, ...Object.fromEntries(E.STRATEGIES.map((s) => [s, E.simulate(scn, s, { record: false }).metrics])) });
    }
    return out;
  }

  // ---------------------------------------------------------------- state
  const state = { view: 'map', run: null, strat: 'plate2place', T: 21 * 60 + 40, playing: !reduceMotion, speed: 5, prep: null, hl: null };

  // ---------------------------------------------------------------- map renderer
  const maps = [];
  class CityMap {
    constructor(wrap, canvas, tip) {
      this.wrap = wrap; this.canvas = canvas; this.tip = tip; this.ctx = canvas.getContext('2d');
      this.nodes = null; this.edges = null; this.static = null; this.dirty = true; this.hit = []; this.onClick = null;
      new ResizeObserver(() => this.invalidate()).observe(wrap);
      canvas.addEventListener('mousemove', (e) => this.hover(e));
      canvas.addEventListener('mouseleave', () => { this.tip.hidden = true; });
      canvas.addEventListener('click', (e) => { if (this.onClick) { const p = this.toKm(e); if (p) this.onClick(p); } });
      maps.push(this);
    }
    setCity(view) { this.nodes = view.nodes; this.edges = view.edges; this.invalidate(); }
    invalidate() { this.dirty = true; this.requestDraw?.(); }
    layout() {
      const r = this.wrap.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      this.W = r.width; this.H = r.height;
      this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pad = 14;
      this.s = Math.min((this.W - 2 * pad) / E.WIDTH_KM, (this.H - 2 * pad) / E.HEIGHT_KM);
      this.ox = (this.W - this.s * E.WIDTH_KM) / 2; this.oy = (this.H - this.s * E.HEIGHT_KM) / 2;
      this.dpr = dpr;
    }
    X(x) { return this.ox + x * this.s; }
    Y(y) { return this.oy + y * this.s; }
    toKm(e) {
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left - this.ox) / this.s, y = (e.clientY - r.top - this.oy) / this.s;
      return x >= 0 && y >= 0 && x <= E.WIDTH_KM && y <= E.HEIGHT_KM ? { x, y } : null;
    }
    buildStatic() {
      this.layout();
      const off = document.createElement('canvas');
      off.width = this.canvas.width; off.height = this.canvas.height;
      const g = off.getContext('2d');
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = C['map-bg']; g.fillRect(0, 0, this.W, this.H);
      // congestion glow
      for (const a of E.AREAS) {
        if (a.zone < 0.2) continue;
        const rad = 2.6 * this.s * (0.8 + a.zone);
        const gr = g.createRadialGradient(this.X(a.x), this.Y(a.y), 0, this.X(a.x), this.Y(a.y), rad);
        gr.addColorStop(0, `rgba(${C.zone},${0.2 * a.zone})`); gr.addColorStop(1, `rgba(${C.zone},0)`);
        g.fillStyle = gr; g.beginPath(); g.arc(this.X(a.x), this.Y(a.y), rad, 0, 7); g.fill();
      }
      if (this.nodes) {
        for (const pass of [0, 1]) {
          g.strokeStyle = pass ? C.artery : C.road; g.lineWidth = pass ? 2.2 : 1; g.lineCap = 'round';
          g.beginPath();
          for (const [u, v, art] of this.edges) {
            if (art !== pass) continue;
            g.moveTo(this.X(this.nodes[u][0]), this.Y(this.nodes[u][1])); g.lineTo(this.X(this.nodes[v][0]), this.Y(this.nodes[v][1]));
          }
          g.stroke();
        }
      }
      g.font = `600 ${this.W < 500 ? 9 : 10.5}px "Source Sans 3", system-ui, sans-serif`;
      g.textAlign = 'center';
      for (const a of E.AREAS) {
        g.fillStyle = C.muted; g.globalAlpha = 0.85;
        g.fillText(a.name.toUpperCase(), this.X(a.x), this.Y(a.y) - 9);
      }
      g.globalAlpha = 1;
      this.static = off; this.dirty = false;
    }
    begin() {
      if (this.dirty || !this.static) this.buildStatic();
      const g = this.ctx;
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.static, 0, 0); g.restore();
      this.hit = [];
      return g;
    }
    hover(e) {
      const r = this.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 14 * 14;
      for (const h of this.hit) { const d = (h.x - mx) ** 2 + (h.y - my) ** 2; if (d < bd) { bd = d; best = h; } }
      if (!best) { this.tip.hidden = true; return; }
      this.tip.innerHTML = best.html;
      this.tip.hidden = false;
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      this.tip.style.left = Math.min(this.W - tw - 6, Math.max(6, mx + 12)) + 'px';
      this.tip.style.top = Math.min(this.H - th - 6, Math.max(6, my + 12)) + 'px';
    }
  }

  const freshColor = (f) => (f > 0.5 ? C.fresh : f > 0.2 ? C.warn : C.spoil);

  // ---------------------------------------------------------------- live map view
  const map1 = new CityMap($('#map-wrap'), $('#map-canvas'), $('#map-tip'));
  map1.requestDraw = () => drawMap();

  function prepare(run, strat) {
    const tr = run.results[strat].trace;
    const dons = tr.donations.map((d) => ({ ...d, life: d.expiry - d.posted, claims: [] }));
    const byId = new Map(dons.map((d) => [d.id, d]));
    for (const d of dons) d.pickups.sort((a, b) => a.t - b.t);
    const vols = tr.volunteers;
    for (const v of vols) for (const l of v.legs) if (l.kind === 'toDonor') byId.get(l.donation)?.claims.push([l.from, l.to, v.id]);
    return { tr, dons, byId, vols, metrics: run.results[strat].metrics };
  }
  const remainingAt = (d, T) => { let r = d.portions; for (const p of d.pickups) { if (p.t <= T) r -= p.load; else break; } return r; };

  function legAt(v, T) {
    const L = v.legs; let lo = 0, hi = L.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (L[m].from <= T) { idx = m; lo = m + 1; } else hi = m - 1; }
    return idx;
  }
  function posOnPath(path, T, nodes) {
    let i = 0;
    while (i < path.length - 2 && path[i + 1][1] < T) i++;
    const [a, ta] = path[i], [b, tb] = path[Math.min(i + 1, path.length - 1)];
    const f = tb > ta ? Math.min(1, Math.max(0, (T - ta) / (tb - ta))) : 1;
    return { x: nodes[a][0] + (nodes[b][0] - nodes[a][0]) * f, y: nodes[a][1] + (nodes[b][1] - nodes[a][1]) * f, i };
  }

  function drawMap() {
    if (!state.prep || state.view !== 'map') return;
    const m = map1, g = m.begin(), T = state.T, P = state.prep, nodes = state.run.scenario.nodes;
    const nx = (n) => m.X(nodes[n][0]), ny = (n) => m.Y(nodes[n][1]);

    // shelters
    for (const s of state.run.scenario.shelters) {
      const x = nx(s.node), y = ny(s.node);
      g.fillStyle = C.ink; g.fillRect(x - 4, y - 4, 8, 8);
      g.strokeStyle = C['map-bg']; g.lineWidth = 1.5; g.strokeRect(x - 4, y - 4, 8, 8);
      m.hit.push({ x, y, html: `<b>${esc(s.name)}</b><br><span class="muted">capacity ${s.capacity} meals</span>` });
    }
    // donations
    let open = 0;
    for (const d of P.dons) {
      if (T < d.posted) continue;
      const rem = remainingAt(d, T);
      const x = nx(d.node), y = ny(d.node);
      if (T >= d.expiry) {
        if (rem > 0 && T < d.expiry + 25) {
          const a = 1 - (T - d.expiry) / 25;
          g.strokeStyle = C.spoil; g.globalAlpha = a; g.lineWidth = 2;
          g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke();
          g.globalAlpha = 1;
        }
        continue;
      }
      if (rem <= 0) continue;
      open++;
      const f = (d.expiry - T) / d.life;
      const r = 3 + Math.sqrt(rem) * 0.75;
      const claimed = d.claims.some(([a, b]) => T >= a && T <= b);
      g.fillStyle = freshColor(f); g.globalAlpha = 0.9;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalAlpha = 1;
      // remaining-life arc
      g.strokeStyle = C.ink; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, r + 2.2, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * f); g.stroke();
      if (claimed) { g.setLineDash([2, 2]); g.strokeStyle = C.route; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 5, 0, 7); g.stroke(); g.setLineDash([]); }
      if (state.hl === d.id) { g.strokeStyle = C.accent; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r + 8 + 2 * Math.sin(performance.now() / 160), 0, 7); g.stroke(); }
      m.hit.push({ x, y, html: `<b>${d.id} · ${esc(d.donor)}</b><br>${rem} of ${d.portions} portions · safe until ${fmt(d.expiry)} (${Math.round(d.expiry - T)} min)${claimed ? '<br><span class="muted">volunteer on the way</span>' : ''}` });
    }
    // volunteers
    let moving = 0;
    for (const v of P.vols) {
      const li = legAt(v, T), leg = li >= 0 ? v.legs[li] : null;
      const active = leg && T <= leg.to;
      if (!active && (T < v.shiftStart || T > v.shiftEnd)) continue;
      let px, py, carrying = false;
      if (active) {
        moving++;
        const p = posOnPath(leg.path, T, nodes);
        px = m.X(p.x); py = m.Y(p.y);
        carrying = leg.kind === 'toShelter';
        // remaining route
        g.strokeStyle = carrying ? C.fresh : C.route; g.lineWidth = 2; g.globalAlpha = 0.55;
        if (!carrying) g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(px, py);
        for (let k = p.i + 1; k < leg.path.length; k++) g.lineTo(nx(leg.path[k][0]), ny(leg.path[k][0]));
        g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      } else {
        const n = leg ? leg.path[leg.path.length - 1][0] : v.home;
        px = nx(n); py = ny(n);
      }
      const r = v.vehicle === 'Car' ? 5.5 : 4.2;
      g.beginPath(); g.arc(px, py, r, 0, 7);
      g.fillStyle = carrying ? C.fresh : active ? C.route : C['map-bg']; g.fill();
      g.strokeStyle = active && !carrying ? C['map-bg'] : C.route; g.lineWidth = 2; g.stroke();
      const doing = active ? (carrying ? `carrying ${leg.load} portions to shelter, ETA ${fmt(leg.to)}` : `heading to ${leg.donation}, ETA ${fmt(leg.to)}`) : 'waiting for a post';
      m.hit.push({ x: px, y: py, html: `<b>${esc(v.name)}</b> · ${v.vehicle} (${v.cap})<br>${doing}<br><span class="muted">${v.trips} trips · ${v.saved} meals tonight</span>` });
    }
    $('#k-open').textContent = open;
    $('#k-moving').textContent = moving;
  }

  // ---------------------------------------------------------------- side panels (map view)
  function snapAt(T) {
    const S = state.prep.tr.snapshots; let lo = 0, hi = S.length - 1, idx = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (S[m].t <= T) { idx = m; lo = m + 1; } else hi = m - 1; }
    return S[idx];
  }
  let lastPanelKey = '';
  function renderPanels(force) {
    if (!state.prep) return;
    const T = state.T, snap = snapAt(T);
    $('#clock').textContent = fmt(T);
    $('#scrub').value = T;
    $('#k-saved').textContent = snap.saved.toLocaleString('en-IN');
    $('#k-spoiled').textContent = snap.spoiled.toLocaleString('en-IN');

    // kinetic list (values recomputed exactly at T for smooth bars)
    const rows = snap.top.map((it) => {
      const d = state.prep.byId.get(it.id); const rem = remainingAt(d, T);
      return { d, v: Math.max(0, (rem * (d.expiry - T)) / d.life), f: (d.expiry - T) / d.life };
    }).filter((r) => r.f > 0).sort((a, b) => b.v - a.v);
    const max = Math.max(1, ...rows.map((r) => r.v));
    $('#klist').innerHTML = rows.length ? rows.map((r, i) => `
      <div class="krow${state.hl === r.d.id ? ' hl' : ''}" data-id="${r.d.id}" title="${esc(r.d.donor)}">
        <span class="rank">${i + 1}</span><span class="id">${r.d.id}</span>
        <span class="kbar"><i style="width:${(100 * r.v / max).toFixed(1)}%;background:${freshColor(r.f)};opacity:.45"></i><em>${esc(r.d.donor)}</em></span>
        <span class="val">${r.v.toFixed(0)}</span>
      </div>`).join('') : '<p class="note">No open posts right now.</p>';
    const recent = state.prep.tr.swaps.filter((s) => s.t <= T && s.t > T - 8).slice(-2).reverse();
    $('#swaps').innerHTML = recent.length
      ? recent.map((s) => `${fmt(s.t)} certificate failed: <b>${s.up}</b> overtook ${s.down}`).join('<br>')
      : `${snap.kEvents} certificate events so far tonight`;
    $('#kh-chip').textContent = state.strat === 'plate2place' ? 'drives decisions' : 'shown for reference';
    $('#kh-chip').className = 'chip' + (state.strat === 'plate2place' ? ' on' : '');

    // AVL + log only when the snapshot changes
    const key = state.strat + snap.t;
    if (key !== lastPanelKey || force) {
      lastPanelKey = key;
      $('#avl-meta').textContent = `n = ${snap.avlSize} · height ${snap.avlHeight} · top 4 levels shown`;
      $('#avl-box').innerHTML = snap.avl ? treeSVG(snap.avl, {
        label: (n) => n.key[1], sub: (n) => fmt(n.key[0]), maxDepth: 4, fit: true,
        cls: (n) => { const left = n.key[0] - T; return left < 30 ? 'spoil' : left < 75 ? 'warn' : 'fresh'; },
      }) : '<p class="note">Empty: no open donations.</p>';
      const L = state.prep.tr.log; let lo = 0, hi = L.length - 1, idx = -1;
      while (lo <= hi) { const mm = (lo + hi) >> 1; if (L[mm].t <= T) { idx = mm; lo = mm + 1; } else hi = mm - 1; }
      const slice = L.slice(Math.max(0, idx - 39), idx + 1).reverse();
      $('#log').innerHTML = slice.map((e) => `<div class="${e.kind}"><time>${fmt(e.t)}</time><i></i><span>${esc(e.text)}</span></div>`).join('');
      $('#log-count').textContent = `${idx + 1} events`;
      renderNow(L, idx, force || !state.playing);
    }
  }

  // ---------------------------------------------------------------- live explanation of the latest event
  const PIPE = { post: ['registry', 'rank', 'expiry'], assign: ['rank', 'expiry', 'route', 'lock'], pickup: ['rank', 'expiry', 'route'],
    deliver: ['registry'], spoil: ['expiry'], wasted: ['route'], shift: ['registry'] };
  function explain(e) {
    const d = e.id ? state.prep.byId.get(e.id) : null;
    switch (e.kind) {
      case 'post': return { title: 'New donation posted', steps: [
        ['Hash map', `${e.id} is stored under its id, so any later lookup is O(1).`],
        ['Kinetic heap', `Inserted with value ${d.portions} portions × 100% safe time. From now on its value falls every minute — O(log n).`],
        ['AVL tree', `Indexed by its expiry time ${fmt(d.expiry)}, so it appears in "spoils soon" queries in time — O(log n).`]] };
      case 'assign':
        if (state.strat === 'fcfs') return { title: 'Volunteer dispatched (first come, first served)', steps: [
          ['Queue', 'Took the oldest open post, wherever it is in the city.'],
          ['No check', 'Nobody checks whether the food will still be safe on arrival. This is how WhatsApp groups work today.']] };
        if (state.strat === 'nearest') return { title: 'Volunteer dispatched (nearest first)', steps: [
          ['Dijkstra', 'Took the closest post by travel time at this hour.'],
          ['No check', 'Ignores how many portions it has and how soon it spoils.']] };
        return { title: 'Volunteer dispatched', steps: [
          ['Candidates', 'Top 16 by value from the kinetic heap, plus everything the AVL tree says spoils within 90 minutes.'],
          ['Dijkstra', `Time-dependent routes for both legs at ${fmt(e.t)}: volunteer → donor, then donor → nearest shelter with space.`],
          ['Feasibility', `Trips that would reach a shelter after the food expires are thrown out. Arrives at the donor ${fmt(e.eta)}; food safe until ${fmt(d.expiry)}.`],
          ['Hash map', `Claim lock set on ${e.id}, so no other volunteer is sent there.`]] };
      case 'pickup': return { title: 'Food collected', steps: [
        ['Heap + AVL', `${e.id} is removed from the kinetic heap and the AVL tree — O(log n) each.`],
        ['Partial load', /vehicle full/.test(e.text) ? 'The vehicle was full, so the rest is put back in the heap with a smaller value.' : 'Everything fitted in the vehicle.'],
        ['Dijkstra', 'Routes the load to the nearest shelter that still has space.']] };
      case 'deliver': return { title: 'Meals delivered', steps: [
        ['Saved', 'Reached the shelter before expiry, so these portions count as meals saved.'],
        ['Hash map', 'Shelter capacity updated; a full shelter drops out of future routing.']] };
      case 'spoil': return { title: 'Food spoiled', steps: [
        ['AVL sweep', 'The clock passed its expiry, so it was popped from the AVL tree (smallest key first) and counted as lost.'],
        ['Why', state.strat === 'plate2place' ? 'No volunteer could reach it and a shelter before it expired.' : 'Volunteers were busy elsewhere, or arrived too late.']] };
      case 'wasted': return { title: 'Wasted trip', steps: [
        ['Too late', 'The volunteer arrived after the food had expired. Plate2Place prevents this with its feasibility check.']] };
      case 'shift': return { title: 'Volunteer comes online', steps: [
        ['Hash map', 'Added to the set of idle volunteers and dispatched immediately if there is work.']] };
      default: return { title: e.kind, steps: [] };
    }
  }
  let nowShownAt = 0, nowShownIdx = -2;
  function renderNow(L, idx, force) {
    const pipe = $$('#pipeline li');
    // while playing, hold each explanation on screen long enough to read
    if (!force && state.playing && idx !== nowShownIdx && performance.now() - nowShownAt < 2200) return;
    if (idx === nowShownIdx && !force) return;
    nowShownAt = performance.now(); nowShownIdx = idx;
    if (idx < 0) { $('#now-body').innerHTML = '<p class="note">The evening starts at 18:00. Press play.</p>'; pipe.forEach((li) => li.classList.remove('active')); return; }
    const e = L[idx], x = explain(e);
    $('#now-time').textContent = fmt(e.t);
    const prev = L.slice(Math.max(0, idx - 3), idx).reverse();
    $('#now-body').innerHTML = `
      <div class="now-title ${e.kind}"><i></i>${esc(x.title)}</div>
      <p class="now-text">${esc(e.text)}</p>
      <ul class="now-steps">${x.steps.map(([tag, t]) => `<li><b>${esc(tag)}</b><span>${esc(t)}</span></li>`).join('')}</ul>
      ${prev.length ? `<div class="now-prev">${prev.map((p) => `<div><time>${fmt(p.t)}</time>${esc(p.text)}</div>`).join('')}</div>` : ''}`;
    const on = new Set(PIPE[e.kind] || []);
    pipe.forEach((li) => li.classList.toggle('active', on.has(li.dataset.k)));
  }
  $('#klist').addEventListener('click', (e) => {
    const r = e.target.closest('.krow'); if (!r) return;
    state.hl = state.hl === r.dataset.id ? null : r.dataset.id; renderPanels(); drawMap();
  });

  // ---------------------------------------------------------------- tree SVG (shared)
  function treeSVG(root, { label, sub, cls, maxDepth = 99, fit = false }) {
    const pts = []; let i = 0, maxD = 0;
    (function walk(n, d) { if (!n || d >= maxDepth) return; walk(n.left, d + 1); n._x = i++; n._d = d; maxD = Math.max(maxD, d); pts.push(n); walk(n.right, d + 1); })(root, 0);
    const colW = 40, rowH = sub ? 50 : 44, w = Math.max(i * colW, 200), h = (maxD + 1) * rowH + 10;
    const X = (n) => n._x * colW + colW / 2 + (w - i * colW) / 2, Y = (n) => n._d * rowH + 22;
    let edges = '', nodes = '';
    for (const n of pts) {
      for (const c of [n.left, n.right]) if (c && c._d === n._d + 1 && pts.includes(c)) edges += `<line class="edge" x1="${X(n)}" y1="${Y(n)}" x2="${X(c)}" y2="${Y(c)}"/>`;
      nodes += `<g class="node ${cls ? cls(n) : ''}"><circle cx="${X(n)}" cy="${Y(n)}" r="15"/><text x="${X(n)}" y="${Y(n) + 3.5}" text-anchor="middle" font-size="10">${esc(label(n))}</text>${sub ? `<text class="sub" x="${X(n)}" y="${Y(n) + 27}" text-anchor="middle">${esc(sub(n))}</text>` : ''}</g>`;
    }
    const size = fit ? 'width="100%"' : `width="${w}" style="max-width:100%"`;
    return `<svg viewBox="0 0 ${w} ${h}" ${size} role="img" aria-label="Tree">${edges}${nodes}</svg>`;
  }

  // ---------------------------------------------------------------- playback loop
  let lastFrame = 0, panelAcc = 0;
  function frame(ts) {
    const dt = lastFrame ? Math.min(0.1, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;
    if (state.view === 'map' && state.prep) {
      if (state.playing) {
        state.T += dt * state.speed;
        if (state.T >= state.run.scenario.stop) { state.T = state.run.scenario.stop; setPlaying(false); }
      }
      drawMap();
      panelAcc += dt;
      if (panelAcc > 0.12 || !state.playing) { panelAcc = 0; if (state.playing) renderPanels(); }
    }
    requestAnimationFrame(frame);
  }
  function setPlaying(p) { state.playing = p; $('#play-btn').textContent = p ? 'Pause' : (state.T >= (state.run?.scenario.stop ?? 1e9) ? 'Replay' : 'Play'); }
  $('#play-btn').addEventListener('click', () => {
    if (!state.playing && state.T >= state.run.scenario.stop) state.T = state.run.scenario.start;
    setPlaying(!state.playing);
  });
  $('#speed').addEventListener('change', (e) => { state.speed = +e.target.value; });
  $('#step-btn').addEventListener('click', () => {
    const L = state.prep.tr.log;
    const next = L.find((e) => e.t > state.T + 0.01 && e.kind !== 'shift');
    if (!next) return;
    setPlaying(false);
    state.T = next.t + 0.01;
    renderPanels(true); drawMap();
  });
  $('#scrub').addEventListener('input', (e) => { state.T = +e.target.value; renderPanels(); drawMap(); });
  $('#strat-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setStrategy(b.dataset.s);
  });
  function setStrategy(s) {
    state.strat = s; state.hl = null;
    $$('#strat-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.s === s)));
    state.prep = prepare(state.run, s);
    renderPanels(true); drawMap();
  }

  // ---------------------------------------------------------------- run controls
  const pDon = $('#p-don'), pVol = $('#p-vol');
  pDon.addEventListener('input', () => { $('#p-don-v').textContent = pDon.value; });
  pVol.addEventListener('input', () => { $('#p-vol-v').textContent = pVol.value; });
  const params = () => ({ seed: Math.max(1, Math.min(9999, +$('#p-seed').value || 7)), donations: +pDon.value, volunteers: +pVol.value });
  async function doRun(keepTime) {
    const btn = $('#run-btn'); btn.disabled = true; $('#run-note').textContent = 'Simulating three strategies…';
    await new Promise((r) => setTimeout(r, 20));
    try {
      state.run = await runEvening(params());
      map1.setCity(state.run.scenario);
      $('#scrub').min = state.run.scenario.start; $('#scrub').max = state.run.scenario.stop;
      if (!keepTime) state.T = 21 * 60 + 40;
      state.prep = prepare(state.run, state.strat);
      const m = state.run.results;
      $('#run-note').textContent = `${state.run.params.donations} posts · ${state.run.params.volunteers} volunteers · ${m.plate2place.metrics.totalPortions.toLocaleString('en-IN')} portions · computed in ${state.run.computeMs} ms${api.server ? ' on the server' : ''}`;
      renderPanels(true); drawMap();
      cmpRendered = false; if (state.view === 'compare') renderCompare();
      $('#seeds-table').innerHTML = '<p class="note">Runs the three strategies on five different generated evenings (same settings as the current run) and reports meals saved.</p>';
    } catch (e) {
      $('#run-note').textContent = 'Could not run: ' + e.message;
    } finally { btn.disabled = false; }
  }
  $('#run-btn').addEventListener('click', () => doRun(false));

  // ---------------------------------------------------------------- compare view
  let cmpRendered = false;
  function renderCompare() {
    if (!state.run) return;
    cmpRendered = true;
    const R = state.run.results, S = E.STRATEGIES;
    const best = S.reduce((a, b) => (R[b].metrics.saved > R[a].metrics.saved ? b : a));
    const base = R.nearest.metrics.saved;
    $('#cmp-cards').innerHTML = S.map((s) => {
      const m = R[s].metrics;
      const note = s === 'fcfs' ? 'Volunteers take the oldest post wherever it is.'
        : s === 'nearest' ? 'Volunteers take the closest post by travel time at this hour.'
        : `Decaying priorities, an expiry index and an exact check that food arrives before it spoils. ${m.saved >= base ? '+' : ''}${(m.saved - base).toLocaleString('en-IN')} meals vs nearest first.`;
      return `<div class="scard${s === best ? ' best' : ''}">
        <h3>${LABEL[s]} ${s === best ? '<span class="chip on">most meals</span>' : ''}</h3>
        <div class="big">${m.saved.toLocaleString('en-IN')} <small>meals · ${(100 * m.rescueRate).toFixed(1)}%</small></div>
        <dl>
          <dt>Spoiled before pickup</dt><dd>${m.spoiledAtDonor.toLocaleString('en-IN')}</dd>
          <dt>Spoiled in transit</dt><dd>${m.spoiledInTransit.toLocaleString('en-IN')}</dd>
          <dt>Wasted trips (food gone on arrival)</dt><dd>${m.wastedTrips}</dd>
          <dt>Meals per volunteer-hour</dt><dd>${m.mealsPerVolunteerHour.toFixed(1)}</dd>
          <dt>Distance driven</dt><dd>${m.km.toLocaleString('en-IN')} km</dd>
          <dt>Route queries (Dijkstra)</dt><dd>${m.dijkstraRuns}</dd>
        </dl>
        <p>${note}</p>
      </div>`;
    }).join('');

    // cumulative line chart
    const W = 620, H = 300, L = 54, Rr = 96, Tp = 14, B = 34;
    const t0 = state.run.scenario.start, t1 = state.run.scenario.stop;
    const ymax = Math.max(...S.map((s) => R[s].metrics.saved)) * 1.08;
    const sx = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - Rr), sy = (v) => Tp + (1 - v / ymax) * (H - Tp - B);
    const col = { fcfs: C.muted, nearest: C.warn, plate2place: C.accent };
    let svg = '';
    const step = ymax > 8000 ? 2000 : ymax > 4000 ? 1000 : 500;
    for (let v = 0; v <= ymax; v += step) svg += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis" x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${v.toLocaleString('en-IN')}</text>`;
    for (let t = 19 * 60; t <= t1 - 20; t += 60) svg += `<text class="axis" x="${sx(t)}" y="${H - 12}" text-anchor="middle">${fmt(t)}</text><line class="grid" x1="${sx(t)}" x2="${sx(t)}" y1="${H - B}" y2="${H - B + 4}"/>`;
    const ends = [];
    for (const s of S) {
      const pts = R[s].trace.snapshots.map((p) => `${sx(p.t).toFixed(1)},${sy(p.saved).toFixed(1)}`).join(' ');
      const last = R[s].trace.snapshots.at(-1);
      svg += `<polyline points="${pts}" fill="none" stroke="${col[s]}" stroke-width="${s === 'plate2place' ? 2.8 : 2}" stroke-linejoin="round"/>`;
      svg += `<circle cx="${sx(last.t)}" cy="${sy(last.saved)}" r="3.5" fill="${col[s]}"/>`;
      ends.push({ s, y: sy(last.saved), v: last.saved });
    }
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 26) ends[k].y = ends[k - 1].y + 26;
    for (const e of ends) svg += `<text x="${W - Rr + 8}" y="${e.y - 2}" font-size="11" style="fill:${col[e.s]};font-family:var(--font-body);font-weight:700">${SHORT[e.s]}</text><text class="axis" x="${W - Rr + 8}" y="${e.y + 11}">${e.v.toLocaleString('en-IN')}</text>`;
    $('#cmp-line').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative meals delivered by strategy">${svg}</svg>`;

    // split bars
    const tot = R.plate2place.metrics.totalPortions;
    $('#cmp-split').innerHTML = S.map((s) => {
      const m = R[s].metrics;
      const parts = [[m.saved, C.fresh, 'delivered'], [m.spoiledAtDonor, C.spoil, 'spoiled before pickup'], [m.spoiledInTransit, C.warn, 'spoiled in transit'], [m.shelterOverflow, C.muted, 'shelter full']];
      return `<div class="row"><span>${SHORT[s]}</span><div class="bar">${parts.map(([v, c, n]) => v > 0 ? `<i style="width:${(100 * v / tot).toFixed(2)}%;background:${c}" title="${n}: ${v.toLocaleString('en-IN')}"></i>` : '').join('')}</div></div>`;
    }).join('') + `<p class="note">${tot.toLocaleString('en-IN')} portions posted tonight.</p>`;
  }

  $('#seeds-btn').addEventListener('click', async () => {
    const b = $('#seeds-btn'); b.disabled = true; b.textContent = 'Running…';
    try {
      const rows = await compareSeeds({ donations: +pDon.value, volunteers: +pVol.value }, [1, 2, 3, 4, 5]);
      const S = E.STRATEGIES, avg = Object.fromEntries(S.map((s) => [s, 0])), avgR = { ...avg };
      let wins = 0;
      const body = rows.map((r) => {
        const best = S.reduce((a, c) => (r[c].saved > r[a].saved ? c : a));
        if (best === 'plate2place') wins++;
        S.forEach((s) => { avg[s] += r[s].saved / rows.length; avgR[s] += r[s].rescueRate / rows.length; });
        return `<tr><td>Evening ${r.seed}</td>${S.map((s) => `<td class="${s === best ? 'win' : ''}">${r[s].saved.toLocaleString('en-IN')} <span class="muted">(${(100 * r[s].rescueRate).toFixed(0)}%)</span></td>`).join('')}<td>${r.plate2place.wastedTrips} / ${r.nearest.wastedTrips} / ${r.fcfs.wastedTrips}</td></tr>`;
      }).join('');
      $('#seeds-table').innerHTML = `<table class="data"><thead><tr><th>Scenario</th>${S.map((s) => `<th>${SHORT[s]}</th>`).join('')}<th>Wasted trips P2P / near / FCFS</th></tr></thead><tbody>${body}
        <tr class="avg"><td>Average</td>${S.map((s) => `<td>${Math.round(avg[s]).toLocaleString('en-IN')} <span class="muted">(${(100 * avgR[s]).toFixed(1)}%)</span></td>`).join('')}<td></td></tr></tbody></table>
        <p class="note" style="margin-top:8px">Plate2Place saved the most meals on ${wins} of ${rows.length} evenings; on average ${Math.round(avg.plate2place - avg.nearest).toLocaleString('en-IN')} more than nearest first and ${Math.round(avg.plate2place - avg.fcfs).toLocaleString('en-IN')} more than first come, first served.</p>`;
    } catch (e) { $('#seeds-table').innerHTML = `<p class="note">Could not run: ${esc(e.message)}</p>`; }
    b.disabled = false; b.textContent = 'Run seeds 1–5';
  });

  // ---------------------------------------------------------------- dispatch desk
  const deskMap = new CityMap($('#desk-wrap'), $('#desk-map'), $('#desk-tip'));
  deskMap.requestDraw = () => drawDesk();
  const desk = { local: null, mode: 'donation', vol: null, state: null, rec: null, sel: 0, view: null };
  const toast = (msg, err) => { const t = $('#desk-toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); };

  const deskApi = {
    async init() {
      if (api.server) { desk.view = await getJSON('api/live/city'); return; }
      desk.local = new E.LiveDispatcher(7, 20 * 60);
      desk.view = desk.local.city;
    },
    async state() { return api.server ? getJSON('api/live/state') : desk.local.state(); },
    async post(b) { return api.server ? getJSON('api/live/donations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }) : desk.local.post(b); },
    async time(t) { return api.server ? getJSON('api/live/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t }) }) : { expired: desk.local.setTime(t) }; },
    async recommend(b) { return api.server ? getJSON('api/live/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }) : desk.local.recommend(b); },
    async claim(id, volunteer) { return api.server ? getJSON('api/live/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, volunteer }) }) : desk.local.claim(id, volunteer); },
    async complete(id) { return api.server ? getJSON('api/live/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }) : desk.local.complete(id); },
  };

  async function deskRefresh() {
    desk.state = await deskApi.state();
    $('#desk-clock').textContent = fmt(desk.state.now);
    const row = (d) => `<div><span class="mono">${d.id}</span><span class="nm" title="${esc(d.donor)}">${esc(d.donor)}</span><span class="mono">${d.remaining}</span><span class="pill ${d.minutesLeft < 30 ? 'bad' : d.minutesLeft < 75 ? 'mid' : 'ok'}">${d.minutesLeft} min</span></div>`;
    $('#desk-ranked').innerHTML = desk.state.ranked.length ? desk.state.ranked.map(row).join('') : '<p class="note">No open donations. Click the map to post one.</p>';
    $('#desk-urgent').innerHTML = desk.state.urgent.length ? desk.state.urgent.map(row).join('') : '<p class="note">Nothing spoils in the next hour.</p>';
    drawDesk();
  }

  function drawDesk() {
    if (!desk.view || state.view !== 'desk') return;
    const m = deskMap, g = m.begin(), nodes = desk.view.nodes;
    const nx = (n) => m.X(nodes[n][0]), ny = (n) => m.Y(nodes[n][1]);
    for (const s of desk.view.shelters) {
      const x = nx(s.node), y = ny(s.node);
      g.fillStyle = C.ink; g.fillRect(x - 4, y - 4, 8, 8);
      m.hit.push({ x, y, html: `<b>${esc(s.name)}</b>` });
    }
    const opt = desk.rec?.options?.[desk.sel];
    if (opt && opt.feasible) {
      for (const [route, colr, dash] of [[opt.routeToDonor, C.route, [5, 3]], [opt.routeToShelter, C.fresh, []]]) {
        g.strokeStyle = colr; g.lineWidth = 3; g.setLineDash(dash); g.globalAlpha = 0.85;
        g.beginPath(); route.forEach((n, k) => (k ? g.lineTo(nx(n), ny(n)) : g.moveTo(nx(n), ny(n)))); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
    }
    for (const d of desk.state?.ranked ?? []) {
      const x = m.X(d.x), y = m.Y(d.y), f = d.minutesLeft / Math.max(1, d.expiry - d.posted);
      const r = 4 + Math.sqrt(d.remaining) * 0.8;
      g.fillStyle = freshColor(f); g.globalAlpha = 0.9; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalAlpha = 1;
      if (d.claimedBy) { g.setLineDash([2, 2]); g.strokeStyle = C.route; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 4, 0, 7); g.stroke(); g.setLineDash([]); }
      if (opt && opt.donation.id === d.id) { g.strokeStyle = C.accent; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r + 6, 0, 7); g.stroke(); }
      g.fillStyle = C.ink; g.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'left'; g.fillText(d.id, x + r + 3, y - r);
      m.hit.push({ x, y, html: `<b>${d.id} · ${esc(d.donor)}</b><br>${d.remaining} portions · ${d.minutesLeft} min left${d.claimedBy ? `<br>claimed by ${esc(d.claimedBy)}` : ''}` });
    }
    if (desk.vol) {
      const x = m.X(desk.vol.x), y = m.Y(desk.vol.y);
      g.beginPath(); g.arc(x, y, 7, 0, 7); g.fillStyle = C.route; g.fill(); g.strokeStyle = C['map-bg']; g.lineWidth = 2.5; g.stroke();
      m.hit.push({ x, y, html: '<b>Your volunteer</b>' });
    }
  }

  $('#desk-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    desk.mode = b.dataset.m;
    $$('#desk-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === desk.mode)));
  });
  $('#d-type').addEventListener('change', (e) => { const [, p, l] = e.target.value.split('|'); $('#d-portions').value = p; $('#d-life').value = l; });
  const areaName = (p) => { let best = E.AREAS[0], bd = Infinity; for (const a of E.AREAS) { const d = (a.x - p.x) ** 2 + (a.y - p.y) ** 2; if (d < bd) { bd = d; best = a; } } return best.name; };
  deskMap.onClick = async (p) => {
    try {
      if (desk.mode === 'volunteer') {
        desk.vol = p; desk.rec = null; $('#rec-list').innerHTML = '';
        $('#v-where').textContent = 'near ' + areaName(p); $('#rec-btn').disabled = false;
        toast(`Volunteer placed near ${areaName(p)}. Choose a vehicle and find the best pickup.`);
        drawDesk(); return;
      }
      const type = $('#d-type').value.split('|')[0];
      const d = await deskApi.post({ donor: `${type}, ${areaName(p)}`, x: p.x, y: p.y, portions: +$('#d-portions').value, lifeMinutes: +$('#d-life').value });
      $('#d-where').textContent = 'last: ' + d.id;
      toast(`Posted ${d.id}: ${d.portions} portions, safe until ${fmt(d.expiry)}.`);
      desk.rec = null; $('#rec-list').innerHTML = '';
      await deskRefresh();
    } catch (err) { toast(err.message, true); }
  };
  $$('[data-adv]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await deskApi.time(desk.state.now + +b.dataset.adv);
      toast(r.expired.length ? `Clock moved on. Expired and removed from the AVL index: ${r.expired.join(', ')}` : 'Clock moved on. Priorities re-ranked by the kinetic heap.');
      desk.rec = null; $('#rec-list').innerHTML = '';
      await deskRefresh();
    } catch (err) { toast(err.message, true); }
  }));
  $('#rec-btn').addEventListener('click', async () => {
    if (!desk.vol) return;
    try {
      desk.rec = await deskApi.recommend({ x: desk.vol.x, y: desk.vol.y, cap: +$('#v-cap').value, volunteer: 'You' });
      desk.sel = 0; renderRec(); drawDesk();
    } catch (err) { toast(err.message, true); }
  });
  function renderRec() {
    const ops = desk.rec?.options ?? [];
    if (!ops.length) { $('#rec-list').innerHTML = `<p class="note">${esc(desk.rec?.reason || 'No unclaimed donations.')}</p>`; return; }
    $('#rec-list').innerHTML = ops.slice(0, 6).map((o, k) => `
      <div class="opt${k === desk.sel ? ' sel' : ''}${o.feasible ? '' : ' no'}" data-k="${k}" role="button" tabindex="0">
        <span><b>${o.donation.id}</b> ${esc(o.donation.donor)}</span>
        <span class="pill ${o.feasible ? 'ok' : 'bad'}">${o.feasible ? `${o.load} meals · ${o.minutes} min` : 'would spoil'}</span>
        <span class="why">${o.feasible
          ? `Arrive ${fmt(o.arriveDonor)}, deliver to ${esc(o.shelter)} by ${fmt(o.deliverBy)} (food safe until ${fmt(o.donation.expiry)}). Score ${o.score}.`
          : `Earliest delivery ${fmt(o.deliverBy)} is after the food expires at ${fmt(o.donation.expiry)}.`}</span>
        ${k === desk.sel && o.feasible ? `<span class="why"><button class="btn primary" data-claim="${o.donation.id}">Assign this pickup</button> <button class="btn" data-done="${o.donation.id}">Mark collected</button></span>` : ''}
      </div>`).join('');
  }
  $('#rec-list').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-claim]'), dn = e.target.closest('[data-done]');
    try {
      if (c) { await deskApi.claim(c.dataset.claim, 'You'); toast(`${c.dataset.claim} assigned to you. No one else can claim it now.`); await deskRefresh(); return; }
      if (dn) { await deskApi.complete(dn.dataset.done); toast(`${dn.dataset.done} collected and removed from the heap and the AVL index.`); desk.rec = null; $('#rec-list').innerHTML = ''; await deskRefresh(); return; }
    } catch (err) { toast(err.message, true); return; }
    const o = e.target.closest('.opt'); if (!o) return;
    desk.sel = +o.dataset.k; renderRec(); drawDesk();
  });

  async function deskSeed() {
    await deskApi.init();
    deskMap.setCity(desk.view);
    const st = await deskApi.state();
    if (!st.open) {
      const ex = [['Wedding hall, Koramangala', 'Koramangala', 220, 170], ['Restaurant, Indiranagar', 'Indiranagar', 40, 55], ['Corporate canteen, Whitefield', 'Whitefield', 120, 140],
        ['Hostel mess, BTM Layout', 'BTM Layout', 60, 95], ['Hotel buffet, MG Road', 'MG Road', 90, 70], ['Restaurant, Jayanagar', 'Jayanagar', 30, 160]];
      for (const [donor, area, portions, life] of ex) {
        const a = E.AREAS.find((x) => x.name === area);
        await deskApi.post({ donor: donor + ' (example)', x: a.x + 0.6, y: a.y + 0.4, portions, lifeMinutes: life });
      }
    }
    const k = E.AREAS.find((x) => x.name === 'HSR Layout');
    desk.vol = { x: k.x, y: k.y }; $('#v-where').textContent = 'near HSR Layout (example)'; $('#rec-btn').disabled = false;
    await deskRefresh();
  }

  // ---------------------------------------------------------------- lab: BST vs AVL
  const lab = { bst: new E.BST(), avl: new E.AVLTree(), next: 1, last: null, rots: [], seeded: false };
  function renderTrees() {
    const label = (n) => n.key, cls = (n) => (n.key === lab.last ? 'new' : lab.rots.includes(n.key) ? 'rot' : '');
    const bc = lab.bst.stats.comparisons, ac = lab.avl.stats.comparisons;
    $('#bst-box').innerHTML = lab.bst.root ? treeSVG(lab.bst.toTree(40), { label, cls }) : '<p class="note">Empty.</p>';
    $('#avl2-box').innerHTML = lab.avl.root ? treeSVG(lab.avl.toTree(40), { label, cls }) : '<p class="note">Empty.</p>';
    $('#bst-meta').textContent = `n = ${lab.bst.size} · height ${lab.bst.height()} · ${bc} comparisons`;
    $('#avl2-meta').textContent = `n = ${lab.avl.size} · height ${lab.avl.height()} · ${ac} comparisons · ${lab.avl.stats.rotations} rotations`;
    $('#rot-log').textContent = lab.avl.lastRotations.length
      ? 'Last insert: ' + lab.avl.lastRotations.map((r) => `${r.type === 'L' ? 'left' : 'right'} rotation at ${r.at}`).join(', ')
      : 'Last operation needed no rotation.';
  }
  function labInsert(k) {
    if (lab.bst.size >= 40 && lab.bst.find(k) === undefined) { $('#rot-log').textContent = 'The lab keeps up to 40 keys so the drawing stays readable. Reset to start again.'; return; }
    lab.bst.insert(k); lab.avl.insert(k); lab.last = k; lab.rots = lab.avl.lastRotations.map((r) => r.at);
  }
  $('#t-ins').addEventListener('click', () => { labInsert(+$('#t-key').value); renderTrees(); });
  $('#t-del').addEventListener('click', () => { const k = +$('#t-key').value; lab.bst.delete(k); lab.avl.delete(k); lab.last = null; lab.rots = []; renderTrees(); });
  $('#t-sorted').addEventListener('click', () => {
    const start = Math.max(lab.next, (lab.bst.inorder().at(-1) ?? 0) + 5);
    for (let i = 0; i < 8; i++) labInsert(start + i * 5);
    lab.next = start + 40; renderTrees();
  });
  $('#t-rand').addEventListener('click', () => { for (let i = 0; i < 8; i++) labInsert(Math.floor(Math.random() * 300)); renderTrees(); });
  $('#t-reset').addEventListener('click', () => { lab.bst = new E.BST(); lab.avl = new E.AVLTree(); lab.next = 1; lab.last = null; lab.rots = []; renderTrees(); });

  // ---------------------------------------------------------------- lab: kinetic heap in slow motion
  let kSeed = 3;
  function kItems() {
    const rng = E.mulberry32(kSeed);
    const names = ['Wedding', 'Canteen', 'Hostel', 'Buffet', 'Bistro', 'Bakery'];
    return names.map((n, i) => {
      const portions = 20 + Math.round(rng() * 160), life = 90 + Math.round(rng() * 150), expiry = life - Math.round(rng() * 40) + Math.round(rng() * 30);
      return { id: n, a: (portions * expiry) / life, b: portions / life, color: C['c' + (i + 1)] };
    });
  }
  function renderKineticLab() {
    const t = +$('#kt').value;
    $('#kt-v').textContent = t;
    const items = kItems();
    const kh = new E.KineticHeap(0), swaps = [];
    kh.onSwap = (tt, up, down) => swaps.push({ t: tt, up: up.id, down: down.id, v: up.a - up.b * tt });
    for (const it of items) kh.insert({ ...it });
    kh.advance(t);
    // full-run swaps for the chart (independent heap)
    const kAll = new E.KineticHeap(0), all = [];
    kAll.onSwap = (tt, up, down) => all.push({ t: tt, up: up.id, down: down.id, v: up.a - up.b * tt });
    for (const it of items) kAll.insert({ ...it });
    kAll.advance(120);

    const W = 560, H = 290, L = 44, R = 30, Tp = 12, B = 30;
    const vmax = Math.max(...items.map((i) => i.a)) * 1.05;
    const sx = (x) => L + (x / 120) * (W - L - R), sy = (v) => Tp + (1 - Math.max(0, v) / vmax) * (H - Tp - B);
    let svg = '';
    for (let v = 0; v <= vmax; v += vmax > 300 ? 100 : 50) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
    for (let x = 0; x <= 120; x += 30) svg += `<text class="axis" x="${sx(x)}" y="${H - 10}" text-anchor="middle">${x} min</text>`;
    const labels = [];
    for (const it of items) {
      const tz = Math.min(120, it.a / it.b);
      svg += `<line x1="${sx(0)}" y1="${sy(it.a)}" x2="${sx(tz)}" y2="${sy(it.a - it.b * tz)}" stroke="${it.color}" stroke-width="2.2"/>`;
      labels.push({ it, y: sy(it.a) - 5 });
    }
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 12) labels[k].y = labels[k - 1].y + 12;
    for (const { it, y } of labels) svg += `<text x="${sx(0) + 4}" y="${Math.max(10, y)}" font-size="10" style="fill:${it.color};font-family:var(--font-body);font-weight:700">${it.id}</text>`;
    for (const s of all) svg += `<circle cx="${sx(s.t)}" cy="${sy(s.v)}" r="${s.t <= t ? 4.5 : 3.5}" fill="${s.t <= t ? C.accent : C.surface}" stroke="${C.accent}" stroke-width="1.6"><title>${s.up} overtook ${s.down} at ${s.t.toFixed(1)} min</title></circle>`;
    svg += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${Tp}" y2="${H - B}" stroke="${C.ink}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    $('#kchart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Value of six donations over two hours">${svg}</svg>`;

    // heap array as a tree
    const toTree = (i) => (i >= kh.h.length ? null : { key: kh.h[i].id, item: kh.h[i], left: toTree(2 * i + 1), right: toTree(2 * i + 2) });
    $('#kheap-box').innerHTML = treeSVG(toTree(0), { label: (n) => n.key.slice(0, 4), sub: (n) => Math.max(0, n.item.a - n.item.b * t).toFixed(0), cls: () => '' });
    $('#kstats').innerHTML = `<span>certificate events so far <b>${kh.stats.events}</b></span><span>heap swaps incl. inserts <b>${kh.stats.swaps}</b></span><span>naive re-evaluations (1/min) <b>${Math.floor(t) * items.length}</b></span>`;
    const certs = [...kh.events.a].sort((a, b) => a.t - b.t).slice(0, 5);
    $('#kcerts').innerHTML = certs.length ? certs.map((c) => `<div>${kh.h[(c.c - 1) >> 1].id} ≥ ${kh.h[c.c].id} fails at ${c.t.toFixed(1)} min</div>`).join('')
      : '<div class="muted">No certificate will fail: the order is now final.</div>';
  }
  $('#kt').addEventListener('input', renderKineticLab);
  $('#kt-new').addEventListener('click', () => { kSeed++; renderKineticLab(); });

  let benchDone = false;
  async function renderBench() {
    if (benchDone) return; benchDone = true;
    await new Promise((r) => setTimeout(r, 30));
    const trees = api.server ? await getJSON('api/bench/trees') : E.benchTrees();
    const kin = api.server ? await getJSON('api/bench/kinetic') : E.benchKinetic();
    const maxH = Math.max(...trees.map((r) => r.bst.height));
    $('#bench-trees').innerHTML = `<table class="data"><thead><tr><th>n</th><th>BST height</th><th>AVL height</th><th>BST comparisons</th><th>AVL comparisons</th><th>Ratio</th></tr></thead><tbody>${trees.map((r) => `
      <tr><td>${r.n.toLocaleString('en-IN')}</td><td>${r.bst.height}<span class="inbar alt" style="width:${(60 * r.bst.height / maxH).toFixed(0)}px"></span></td><td>${r.avl.height}<span class="inbar" style="width:${Math.max(2, 60 * r.avl.height / maxH).toFixed(0)}px"></span></td>
      <td>${(r.bst.insertCmp + r.bst.findCmp).toLocaleString('en-IN')}</td><td>${(r.avl.insertCmp + r.avl.findCmp).toLocaleString('en-IN')}</td><td>${((r.bst.insertCmp + r.bst.findCmp) / (r.avl.insertCmp + r.avl.findCmp)).toFixed(0)}×</td></tr>`).join('')}</tbody></table>
      <p class="note" style="margin-top:8px">The BST's height grows with n (a linked list); the AVL tree stays at about log₂ n.</p>`;
    $('#bench-kin').innerHTML = `<table class="data"><thead><tr><th>Posts</th><th>Kinetic events</th><th>Kinetic ms</th><th>Naive ops</th><th>Naive ms</th><th>Less work</th></tr></thead><tbody>${kin.map((r) => `
      <tr><td>${r.n.toLocaleString('en-IN')}</td><td>${r.kineticEvents.toLocaleString('en-IN')}</td><td>${r.kineticMs}</td><td>${r.naiveOps.toLocaleString('en-IN')}</td><td>${r.naiveMs}</td><td>${(r.naiveOps / Math.max(1, r.kineticCertUpdates)).toFixed(0)}×</td></tr>`).join('')}</tbody></table>
      <p class="note" style="margin-top:8px">Naive: re-score and re-sort every post every minute. Kinetic: process only the moments two values cross. “Less work” compares naive operations with certificate recomputations.</p>`;
  }

  // ---------------------------------------------------------------- tabs
  function show(view) {
    state.view = view;
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
    store.set('p2p-view', view);
    if (view === 'map') { map1.invalidate(); renderPanels(true); }
    if (view === 'compare' && state.run) renderCompare();
    if (view === 'desk') { if (!desk.view) deskSeed().catch((e) => toast(e.message, true)); else { deskMap.invalidate(); drawDesk(); } }
    if (view === 'lab') {
      if (!lab.seeded) { lab.seeded = true; for (let i = 0; i < 8; i++) labInsert(5 + i * 5); lab.next = 45; }
      renderTrees(); renderKineticLab(); renderBench().catch(() => {}); }
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

  // ---------------------------------------------------------------- boot
  (async () => {
    await detectServer();
    await doRun(false);
    setPlaying(state.playing);
    const views = ['map', 'compare', 'desk', 'lab', 'method'];
    const fromHash = location.hash.slice(1);
    const v = views.includes(fromHash) ? fromHash : (views.includes(store.get('p2p-view')) ? store.get('p2p-view') : 'map');
    show(v);
    requestAnimationFrame(frame);
  })();
})();
