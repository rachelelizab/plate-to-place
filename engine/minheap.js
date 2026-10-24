// MinHeap — array-backed binary heap with an optional index (key -> position)
// so items can be updated or removed in O(log n) ("indexed priority queue").
//
// Used for: Dijkstra frontier, kinetic-heap certificate event queue, top-k extraction.
//
// push / pop / upsert / remove   O(log n)
// peek / has                     O(1)  (has is O(1) average via HashMap)

import { HashMap } from './hashmap.js';

export class MinHeap {
  /**
   * @param {(x:any, y:any) => boolean} less  strict ordering: true if x should be above y
   * @param {((x:any) => any) | null} keyOf   enables upsert/remove-by-key when provided
   */
  constructor(less = (x, y) => x < y, keyOf = null) {
    this.a = [];
    this.less = less;
    this.keyOf = keyOf;
    this.pos = keyOf ? new HashMap(64) : null;
    this.stats = { pushes: 0, pops: 0, swaps: 0 };
  }

  get size() { return this.a.length; }
  isEmpty() { return this.a.length === 0; }
  peek() { return this.a[0]; }
  has(key) { return this.pos ? this.pos.has(key) : false; }
  getByKey(key) { const i = this.pos.get(key); return i === undefined ? undefined : this.a[i]; }

  _set(i, x) {
    this.a[i] = x;
    if (this.pos) this.pos.set(this.keyOf(x), i);
  }

  _swap(i, j) {
    const t = this.a[i];
    this._set(i, this.a[j]);
    this._set(j, t);
    this.stats.swaps++;
  }

  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.a[i], this.a[p])) break;
      this._swap(i, p);
      i = p;
    }
    return i;
  }

  _down(i) {
    const n = this.a.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this.less(this.a[l], this.a[m])) m = l;
      if (r < n && this.less(this.a[r], this.a[m])) m = r;
      if (m === i) return i;
      this._swap(i, m);
      i = m;
    }
  }

  push(x) {
    this.stats.pushes++;
    if (this.pos && this.pos.has(this.keyOf(x))) return this.upsert(x);
    this._set(this.a.length, x);
    this._up(this.a.length - 1);
    return this;
  }

  pop() {
    if (this.a.length === 0) return undefined;
    this.stats.pops++;
    const top = this.a[0];
    const last = this.a.pop();
    if (this.pos) this.pos.delete(this.keyOf(top));
    if (this.a.length > 0) {
      this._set(0, last);
      this._down(0);
    }
    return top;
  }

  /** Insert, or replace the item with the same key and restore heap order. */
  upsert(x) {
    const k = this.keyOf(x);
    const i = this.pos.get(k);
    if (i === undefined) { this._set(this.a.length, x); this._up(this.a.length - 1); return this; }
    this._set(i, x);
    this._down(this._up(i));
    return this;
  }

  /** Remove by key. Returns the removed item or undefined. */
  remove(key) {
    const i = this.pos.get(key);
    if (i === undefined) return undefined;
    const item = this.a[i];
    const last = this.a.pop();
    this.pos.delete(key);
    if (i < this.a.length) {
      this._set(i, last);
      this._down(this._up(i));
    }
    return item;
  }
}
