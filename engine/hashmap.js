// HashMap — separate chaining with dynamic resizing.
// Used for: donation registry, volunteer status, claim locks, shelter capacity,
// and position maps inside the indexed heaps.
//
// Complexity: get / set / delete  O(1) average, O(n) worst case (all keys in one bucket)
//             resize               O(n), amortised O(1) per insert (capacity doubles at load > 0.75)

export class HashMap {
  constructor(capacity = 16) {
    this._buckets = new Array(capacity);
    this._size = 0;
    this.stats = { resizes: 0, maxChain: 0 };
  }

  // FNV-1a for strings, Knuth multiplicative hashing for integers.
  _hash(key, cap = this._buckets.length) {
    if (typeof key === 'number' && Number.isInteger(key)) {
      return (Math.imul(key | 0, 2654435761) >>> 0) % cap;
    }
    const s = String(key);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % cap;
  }

  get size() { return this._size; }

  set(key, value) {
    const i = this._hash(key);
    let chain = this._buckets[i];
    if (!chain) chain = this._buckets[i] = [];
    for (let j = 0; j < chain.length; j++) {
      if (chain[j][0] === key) { chain[j][1] = value; return this; }
    }
    chain.push([key, value]);
    if (chain.length > this.stats.maxChain) this.stats.maxChain = chain.length;
    this._size++;
    if (this._size > this._buckets.length * 0.75) this._resize(this._buckets.length * 2);
    return this;
  }

  get(key) {
    const chain = this._buckets[this._hash(key)];
    if (!chain) return undefined;
    for (let j = 0; j < chain.length; j++) if (chain[j][0] === key) return chain[j][1];
    return undefined;
  }

  has(key) {
    const chain = this._buckets[this._hash(key)];
    if (!chain) return false;
    for (let j = 0; j < chain.length; j++) if (chain[j][0] === key) return true;
    return false;
  }

  delete(key) {
    const i = this._hash(key);
    const chain = this._buckets[i];
    if (!chain) return false;
    for (let j = 0; j < chain.length; j++) {
      if (chain[j][0] === key) {
        chain[j] = chain[chain.length - 1];
        chain.pop();
        this._size--;
        return true;
      }
    }
    return false;
  }

  _resize(newCap) {
    const old = this._buckets;
    this._buckets = new Array(newCap);
    this.stats.resizes++;
    for (const chain of old) {
      if (!chain) continue;
      for (const pair of chain) {
        const i = this._hash(pair[0], newCap);
        (this._buckets[i] ||= []).push(pair);
      }
    }
  }

  *entries() {
    for (const chain of this._buckets) if (chain) for (const p of chain) yield [p[0], p[1]];
  }
  *keys() { for (const [k] of this.entries()) yield k; }
  *values() { for (const [, v] of this.entries()) yield v; }
  [Symbol.iterator]() { return this.entries(); }
}
