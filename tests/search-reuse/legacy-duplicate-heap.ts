// Frozen duplicate heap from 3f38c565, with only the enqueue/reset adapter.
// --- Min-heap for A* open set ---
export class LegacyDuplicateHeap {
  constructor(
    private pool: {
      push(cellIdx: number, g: number, parentIdx: number, ripped: any): number
    },
  ) {}

  beginSearch(_indexed: boolean): void {
    this.clear()
  }

  enqueue(
    f: number,
    cellIdx: number,
    g: number,
    parentIdx: number,
    ripped: any,
  ): void {
    this.push(f, this.pool.push(cellIdx, g, parentIdx, ripped))
  }
  private f = new Float64Array(1024)
  private id = new Int32Array(1024)
  private n = 0

  // Nodes are enqueued once, immediately after allocation. Their pool index is
  // the insertion order, so equal priorities need no separate sequence array.
  push(f: number, id: number): void {
    this.ensureCapacity(this.n + 1)
    // Move parents into the hole, then write the new tuple once.
    let i = this.n++
    while (i > 0) {
      const p = (i - 1) >> 1
      const parentF = this.f[p]!
      const parentId = this.id[p]!
      if (parentF !== f ? parentF < f : parentId < id) break
      this.f[i] = parentF
      this.id[i] = parentId
      i = p
    }
    this.f[i] = f
    this.id[i] = id
  }

  pop(): number {
    const out = this.id[0]!
    this.n--
    if (this.n > 0) {
      const f = this.f[this.n]!
      const id = this.id[this.n]!
      let i = 0
      while (true) {
        const left = i * 2 + 1
        if (left >= this.n) break
        const right = left + 1
        let child = left
        if (right < this.n) {
          const leftF = this.f[left]!
          const rightF = this.f[right]!
          if (
            !(leftF !== rightF
              ? leftF < rightF
              : this.id[left]! < this.id[right]!)
          ) {
            child = right
          }
        }
        const childF = this.f[child]!
        const childId = this.id[child]!
        if (f !== childF ? f < childF : id < childId) break
        this.f[i] = childF
        this.id[i] = childId
        i = child
      }
      this.f[i] = f
      this.id[i] = id
    }
    return out
  }

  get size(): number {
    return this.n
  }

  clear(): void {
    this.n = 0
  }

  private ensureCapacity(size: number): void {
    if (size <= this.f.length) return
    let next = this.f.length
    while (next < size) next *= 2
    const f = new Float64Array(next)
    f.set(this.f)
    this.f = f
    const id = new Int32Array(next)
    id.set(this.id)
    this.id = id
  }
}
