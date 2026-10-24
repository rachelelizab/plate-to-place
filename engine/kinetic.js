// KineticHeap — a max-heap whose priorities change continuously with time.
//
// Every item has a linear priority  f(t) = a - b·t  (b >= 0: value decays as food spoils).
// A normal heap would have to re-evaluate and re-heapify all n items on every clock tick.
// A kinetic heap instead keeps one *certificate* per parent–child edge:
//
//        cert(c):  f_parent(c)(t) >= f_c(t)
//
// and computes the exact time that certificate will fail (when the two lines cross).
// All failure times live in an indexed MinHeap (the event queue). Advancing the clock
// only processes the certificates that actually fail; each failure is repaired by one
// parent–child swap plus O(1) certificate recomputations, each O(log n) in the event queue.
//
//   advance(t)       O(e log n) for e certificate failures in (now, t]
//   insert / remove  O(log n)
//   top              O(1)
//   topK(k)          O(k log k)  (best-first walk over the heap array)
//
// Framework: kinetic data structures, Basch, Guibas & Hershberger (1997).

import { HashMap } from './hashmap.js';
import { MinHeap } from './minheap.js';

const EPS = 1e-9;

export class KineticHeap {
  constructor(now = 0) {
    this.h = [];                     // heap array of items {id, a, b, ...}
    this.pos = new HashMap(64);      // id -> index in h
    this.now = now;
    // event queue: one certificate per child index c, ordered by failure time
    this.events = new MinHeap((x, y) => x.t < y.t || (x.t === y.t && x.c < y.c), (e) => e.c);
    this.stats = { events: 0, swaps: 0, certUpdates: 0, inserts: 0, removes: 0 };
    this.onSwap = null;              // optional hook (time, upperItem, lowerItem)
  }

  get size() { return this.h.length; }
  value(item, t = this.now) { return item.a - item.b * t; }

  /** x should sit above y at time t (ties broken by the slower decay, so order stays valid just after t). */
  _above(x, y, t = this.now) {
    const vx = this.value(x, t), vy = this.value(y, t);
    if (vx > vy + EPS) return true;
    if (vy > vx + EPS) return false;
    if (x.b !== y.b) return x.b < y.b;
    return x.id < y.id;
  }

  /** Time at which the certificate parent >= child fails, or Infinity. */
  _failTime(p, c) {
    const P = this.h[p], C = this.h[c];
    if (P.b <= C.b) return Infinity;              // parent decays no faster: never overtaken
    const t = (P.a - C.a) / (P.b - C.b);          // lines cross here
    return t > this.now ? t : this.now;
  }

  _refreshCert(c) {
    if (c <= 0 || c >= this.h.length) { this.events.remove(c); return; }
    const t = this._failTime((c - 1) >> 1, c);
    this.stats.certUpdates++;
    if (t === Infinity) this.events.remove(c);
    else this.events.upsert({ c, t });
  }

  /** Recompute certificates touching index i (its own and its two children's). */
  _touch(i) {
    this._refreshCert(i);
    this._refreshCert(2 * i + 1);
    this._refreshCert(2 * i + 2);
  }

  _place(i, item) { this.h[i] = item; this.pos.set(item.id, i); }

  _swap(i, j) {
    const t = this.h[i];
    this._place(i, this.h[j]);
    this._place(j, t);
    this.stats.swaps++;
  }

  _siftUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this._above(this.h[i], this.h[p])) break;
      this._swap(i, p);
      this._touch(i);
      i = p;
    }
    this._touch(i);
    return i;
  }

  _siftDown(i) {
    const n = this.h.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this._above(this.h[l], this.h[m])) m = l;
      if (r < n && this._above(this.h[r], this.h[m])) m = r;
      if (m === i) break;
      this._swap(i, m);
      this._touch(i);
      i = m;
    }
    this._touch(i);
    return i;
  }

  /** item: {id, a, b, ...payload} with priority a - b·t */
  insert(item) {
    if (this.pos.has(item.id)) throw new Error('duplicate id ' + item.id);
    this.stats.inserts++;
    this._place(this.h.length, item);
    this._siftUp(this.h.length - 1);
  }

  remove(id) {
    const i = this.pos.get(id);
    if (i === undefined) return undefined;
    this.stats.removes++;
    const item = this.h[i];
    const lastIdx = this.h.length - 1;
    const last = this.h.pop();
    this.pos.delete(id);
    this.events.remove(lastIdx);                  // that index no longer exists
    if (i < this.h.length) {
      this._place(i, last);
      this._siftDown(this._siftUp(i));
    }
    return item;
  }

  has(id) { return this.pos.has(id); }
  get(id) { const i = this.pos.get(id); return i === undefined ? undefined : this.h[i]; }

  /** Move the clock forward to t, repairing exactly the certificates that fail on the way. */
  advance(t) {
    if (t < this.now) throw new Error('time cannot go backwards');
    let processed = 0;
    while (this.events.size && this.events.peek().t <= t) {
      const ev = this.events.pop();
      this.now = Math.max(this.now, ev.t);
      const c = ev.c, p = (c - 1) >> 1;
      if (c >= this.h.length) continue;
      this.stats.events++;
      processed++;
      if (this._above(this.h[c], this.h[p])) {
        if (this.onSwap) this.onSwap(this.now, this.h[c], this.h[p]);
        this._swap(c, p);
        this._touch(p);
        this._touch(c);
        // the sibling of c now hangs under the item moved up; its certificate is in _touch(p)
      } else {
        this._refreshCert(c);
      }
    }
    this.now = t;
    return processed;
  }

  top() { return this.h[0]; }

  /** The k highest-priority items at the current time, best first, without modifying the heap. */
  topK(k) {
    const out = [];
    if (!this.h.length) return out;
    const frontier = new MinHeap((x, y) => this._above(this.h[x], this.h[y]));
    frontier.push(0);
    while (frontier.size && out.length < k) {
      const i = frontier.pop();
      out.push(this.h[i]);
      const l = 2 * i + 1, r = l + 1;
      if (l < this.h.length) frontier.push(l);
      if (r < this.h.length) frontier.push(r);
    }
    return out;
  }

  /** Verify the heap property at the current time (used by tests). */
  check() {
    for (let c = 1; c < this.h.length; c++) {
      const p = (c - 1) >> 1;
      if (this.value(this.h[c]) > this.value(this.h[p]) + 1e-6) {
        throw new Error(`kinetic heap violated at t=${this.now}: child ${c} above parent ${p}`);
      }
    }
    return true;
  }
}
