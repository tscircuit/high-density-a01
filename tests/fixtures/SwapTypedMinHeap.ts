// Original A03 heap, retained as an independent differential oracle.
export class SwapTypedMinHeap {
  private f = new Float64Array(1024)
  private seq = new Uint32Array(1024)
  private id = new Int32Array(1024)
  private n = 0

  push(f: number, seq: number, id: number) {
    this.ensureCapacity(this.n + 1)
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

  get size() {
    return this.n
  }

  clear() {
    this.n = 0
  }

  private ensureCapacity(size: number) {
    if (size <= this.f.length) return
    let next = this.f.length
    while (next < size) next *= 2

    const nf = new Float64Array(next)
    nf.set(this.f)
    this.f = nf

    const ns = new Uint32Array(next)
    ns.set(this.seq)
    this.seq = ns

    const ni = new Int32Array(next)
    ni.set(this.id)
    this.id = ni
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
    const tf = this.f[i]!
    this.f[i] = this.f[j]!
    this.f[j] = tf

    const ts = this.seq[i]!
    this.seq[i] = this.seq[j]!
    this.seq[j] = ts

    const ti = this.id[i]!
    this.id[i] = this.id[j]!
    this.id[j] = ti
  }
}
