// AVL tree — self-balancing BST keyed on (expiry time, donation id).
// Answers "which open donations spoil before time T?" and sweeps expired ones.
//
// insert / delete / find      O(log n)   (height <= 1.44 log2(n+2))
// rangeQuery(lo, hi)          O(log n + k)
// popUpTo(t) (expiry sweep)   O(k log n) for k expired items
// Rotations are counted so the demo can show balancing work.

const defaultCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class Node {
  constructor(key, value) {
    this.key = key; this.value = value;
    this.left = null; this.right = null;
    this.h = 1;
  }
}

const h = (n) => (n ? n.h : 0);
const fix = (n) => { n.h = 1 + Math.max(h(n.left), h(n.right)); };
const bal = (n) => h(n.left) - h(n.right);

export class AVLTree {
  constructor(cmp = defaultCmp) {
    this.root = null;
    this.cmp = cmp;
    this.size = 0;
    this.stats = { comparisons: 0, rotations: 0 };
    this.lastRotations = []; // rotation log of the most recent operation (for the visualiser)
  }

  _rotRight(y) {
    const x = y.left;
    y.left = x.right; x.right = y;
    fix(y); fix(x);
    this.stats.rotations++;
    this.lastRotations.push({ type: 'R', at: y.key });
    return x;
  }

  _rotLeft(x) {
    const y = x.right;
    x.right = y.left; y.left = x;
    fix(x); fix(y);
    this.stats.rotations++;
    this.lastRotations.push({ type: 'L', at: x.key });
    return y;
  }

  _rebalance(n) {
    fix(n);
    const b = bal(n);
    if (b > 1) {                                   // left heavy
      if (bal(n.left) < 0) n.left = this._rotLeft(n.left);   // LR case
      return this._rotRight(n);                    // LL case
    }
    if (b < -1) {                                  // right heavy
      if (bal(n.right) > 0) n.right = this._rotRight(n.right); // RL case
      return this._rotLeft(n);                     // RR case
    }
    return n;
  }

  insert(key, value = key) {
    this.lastRotations = [];
    let added = false;
    const ins = (n) => {
      if (!n) { added = true; return new Node(key, value); }
      this.stats.comparisons++;
      const c = this.cmp(key, n.key);
      if (c === 0) { n.value = value; return n; }
      if (c < 0) n.left = ins(n.left); else n.right = ins(n.right);
      return this._rebalance(n);
    };
    this.root = ins(this.root);
    if (added) this.size++;
  }

  delete(key) {
    this.lastRotations = [];
    let removed = false;
    const del = (n, k) => {
      if (!n) return null;
      this.stats.comparisons++;
      const c = this.cmp(k, n.key);
      if (c < 0) n.left = del(n.left, k);
      else if (c > 0) n.right = del(n.right, k);
      else {
        removed = true;
        if (!n.left || !n.right) return n.left || n.right;
        let s = n.right;
        while (s.left) s = s.left;
        n.key = s.key; n.value = s.value;
        removed = false;              // the successor deletion below sets it again
        n.right = del(n.right, s.key);
      }
      return this._rebalance(n);
    };
    this.root = del(this.root, key);
    if (removed) this.size--;
    return removed;
  }

  find(key) {
    let n = this.root;
    while (n) {
      this.stats.comparisons++;
      const c = this.cmp(key, n.key);
      if (c === 0) return n.value;
      n = c < 0 ? n.left : n.right;
    }
    return undefined;
  }

  min() {
    let n = this.root;
    if (!n) return undefined;
    while (n.left) n = n.left;
    return { key: n.key, value: n.value };
  }

  /** All values with lo <= key <= hi, in key order. O(log n + k). */
  rangeQuery(lo, hi) {
    const out = [];
    const walk = (n) => {
      if (!n) return;
      const cLo = this.cmp(n.key, lo), cHi = this.cmp(n.key, hi);
      if (cLo > 0) walk(n.left);
      if (cLo >= 0 && cHi <= 0) out.push(n.value);
      if (cHi < 0) walk(n.right);
    };
    walk(this.root);
    return out;
  }

  /** Remove and return every entry whose key <= bound (used for the expiry sweep). */
  popUpTo(bound) {
    const out = [];
    for (let m = this.min(); m && this.cmp(m.key, bound) <= 0; m = this.min()) {
      out.push(m.value);
      this.delete(m.key);
    }
    return out;
  }

  height() { return h(this.root); }

  inorder() {
    const out = [];
    const walk = (n) => { if (!n) return; walk(n.left); out.push(n.key); walk(n.right); };
    walk(this.root);
    return out;
  }

  /** Verify AVL invariants (used by tests). */
  check() {
    const walk = (n) => {
      if (!n) return 0;
      const l = walk(n.left), r = walk(n.right);
      if (Math.abs(l - r) > 1) throw new Error('AVL balance violated at ' + n.key);
      if (n.h !== 1 + Math.max(l, r)) throw new Error('AVL height wrong at ' + n.key);
      if (n.left && this.cmp(n.left.key, n.key) >= 0) throw new Error('BST order violated');
      if (n.right && this.cmp(n.right.key, n.key) <= 0) throw new Error('BST order violated');
      return n.h;
    };
    return walk(this.root);
  }

  toTree(maxDepth = 12) {
    const walk = (n, d) => (!n || d > maxDepth) ? null
      : { key: n.key, h: n.h, left: walk(n.left, d + 1), right: walk(n.right, d + 1) };
    return walk(this.root, 1);
  }
}
