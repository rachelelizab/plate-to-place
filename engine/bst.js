// Plain (unbalanced) Binary Search Tree — kept deliberately as the baseline.
// Donations arrive in time order, so expiry keys are close to sorted: the worst
// case for a BST, which then degenerates into a linked list of height n.
//
// insert / find / delete   O(h): O(log n) for random keys, O(n) for sorted keys
// rangeQuery               O(h + k)
// Everything is iterative so a degenerate tree of height 10^4 cannot overflow the stack.

const defaultCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class Node {
  constructor(key, value) { this.key = key; this.value = value; this.left = null; this.right = null; }
}

export class BST {
  constructor(cmp = defaultCmp) {
    this.root = null;
    this.cmp = cmp;
    this.size = 0;
    this.stats = { comparisons: 0 };
  }

  insert(key, value = key) {
    const node = new Node(key, value);
    if (!this.root) { this.root = node; this.size++; return; }
    let cur = this.root;
    for (;;) {
      this.stats.comparisons++;
      const c = this.cmp(key, cur.key);
      if (c === 0) { cur.value = value; return; }
      if (c < 0) { if (!cur.left) { cur.left = node; break; } cur = cur.left; }
      else { if (!cur.right) { cur.right = node; break; } cur = cur.right; }
    }
    this.size++;
  }

  find(key) {
    let cur = this.root;
    while (cur) {
      this.stats.comparisons++;
      const c = this.cmp(key, cur.key);
      if (c === 0) return cur.value;
      cur = c < 0 ? cur.left : cur.right;
    }
    return undefined;
  }

  delete(key) {
    let parent = null, cur = this.root;
    while (cur) {
      this.stats.comparisons++;
      const c = this.cmp(key, cur.key);
      if (c === 0) break;
      parent = cur;
      cur = c < 0 ? cur.left : cur.right;
    }
    if (!cur) return false;
    if (cur.left && cur.right) {
      // replace with in-order successor
      let sp = cur, s = cur.right;
      while (s.left) { sp = s; s = s.left; }
      cur.key = s.key; cur.value = s.value;
      parent = sp; cur = s;
    }
    const child = cur.left || cur.right;
    if (!parent) this.root = child;
    else if (parent.left === cur) parent.left = child;
    else parent.right = child;
    this.size--;
    return true;
  }

  rangeQuery(lo, hi) {
    const out = [], stack = [];
    let cur = this.root;
    while (cur || stack.length) {
      while (cur) {
        stack.push(cur);
        cur = this.cmp(cur.key, lo) > 0 ? cur.left : null;
      }
      const n = stack.pop();
      const cLo = this.cmp(n.key, lo), cHi = this.cmp(n.key, hi);
      if (cLo >= 0 && cHi <= 0) out.push(n.value);
      cur = cHi < 0 ? n.right : null;
    }
    return out;
  }

  inorder() {
    const out = [], stack = [];
    let cur = this.root;
    while (cur || stack.length) {
      while (cur) { stack.push(cur); cur = cur.left; }
      const n = stack.pop();
      out.push(n.key);
      cur = n.right;
    }
    return out;
  }

  height() {
    if (!this.root) return 0;
    let h = 0, level = [this.root];
    while (level.length) {
      h++;
      const next = [];
      for (const n of level) { if (n.left) next.push(n.left); if (n.right) next.push(n.right); }
      level = next;
    }
    return h;
  }

  /** Plain-object snapshot for drawing (depth-limited). */
  toTree(maxDepth = 12) {
    const walk = (n, d) => (!n || d > maxDepth) ? null
      : { key: n.key, left: walk(n.left, d + 1), right: walk(n.right, d + 1) };
    return walk(this.root, 1);
  }
}
