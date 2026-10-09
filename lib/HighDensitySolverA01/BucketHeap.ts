// Each bucket retains the original binary heap comparison and tie rules.
class BucketEntryHeap {
  private f: number[] = []
  private seq: number[] = []
  private id: number[] = []
  private n = 0

  push(f: number, seq: number, id: number) {
    let i = this.n++
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(p, i)) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const out = this.id[0]!
    this.n--
    if (this.n > 0) {
      this.f[0] = this.f[this.n]!
      this.seq[0] = this.seq[this.n]!
      this.id[0] = this.id[this.n]!
      this.siftDown(0)
    }
    return out
  }

  peek(): number {
    return this.id[0]!
  }

  get size() {
    return this.n
  }

  clear() {
    this.n = 0
  }

  private siftDown(i: number) {
    while (true) {
      const l = i * 2 + 1
      const r = l + 1
      if (l >= this.n) return
      let m = l
      if (r < this.n && !this.less(l, r)) m = r
      if (this.less(i, m)) return
      this.swap(i, m)
      i = m
    }
  }

  private less(i: number, j: number) {
    const fi = this.f[i]!
    const fj = this.f[j]!
    if (fi !== fj) return fi < fj
    return this.seq[i]! < this.seq[j]!
  }

  private swap(i: number, j: number) {
    const tmpF = this.f[i]!
    this.f[i] = this.f[j]!
    this.f[j] = tmpF
    const tmpS = this.seq[i]!
    this.seq[i] = this.seq[j]!
    this.seq[j] = tmpS
    const tmpI = this.id[i]!
    this.id[i] = this.id[j]!
    this.id[j] = tmpI
  }
}

/**
 * Two-level ordered priority queue. Monotone f buckets reduce the number of
 * entries compared by each heap without changing the total (f, sequence) order.
 * No query answers are cached.
 */
export class BucketHeap {
  private buckets = new Map<number, BucketEntryHeap>()
  private keys = new BucketEntryHeap()
  private n = 0

  push(f: number, seq: number, id: number): void {
    if (Number.isNaN(f)) {
      throw new RangeError("Bucket queue requires non-NaN priorities")
    }
    // 1/8-wide buckets. Overflow to an infinite bucket remains ordered because
    // entries within that bucket still use their original unrounded priority.
    const key = Math.floor(f / 0.125)
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = new BucketEntryHeap()
      this.buckets.set(key, bucket)
      this.keys.push(key, 0, key)
    }
    bucket.push(f, seq, id)
    this.n++
  }

  pop(): number {
    const key = this.keys.peek()
    const bucket = this.buckets.get(key)!
    const id = bucket.pop()
    this.n--
    if (bucket.size === 0) {
      this.keys.pop()
      this.buckets.delete(key)
    }
    return id
  }

  get size(): number {
    return this.n
  }

  clear(): void {
    this.buckets.clear()
    this.keys.clear()
    this.n = 0
  }
}
