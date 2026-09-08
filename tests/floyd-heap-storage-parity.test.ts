import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultParams } from "../lib/default-params"
import sample001 from "./dataset01/sample001/sample001.json"

// Frozen original heap from 75214a4. The candidate must preserve the complete
// backing arrays, not only the next minimum, before any later NaN insertion.
class ReferenceHeap {
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

test("A01 and A03 Floyd heaps preserve every stored priority bit and id across ordered and NaN transitions", () => {
  const priorities = [
    0,
    -0,
    1,
    -1,
    Infinity,
    -Infinity,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    0.3,
    NaN,
  ]
  let state = 149831
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    const solver = new Solver({
      ...defaultParams,
      nodeWithPortPoints: structuredClone(sample001),
    })
    for (let i = 0; i < 100 && !(solver as any).heap; i++) solver.step()
    const Heap = (solver as any).heap.constructor
    const candidate = new Heap()
    const reference = new ReferenceHeap() as any
    let nextId = 0
    const compare = (): void => {
      expect(candidate.size).toBe(reference.size)
      expect(Buffer.from(candidate.f.buffer)).toEqual(
        Buffer.from(reference.f.buffer),
      )
      expect(Buffer.from(candidate.id.buffer)).toEqual(
        Buffer.from(reference.id.buffer),
      )
    }
    const push = (priority: number): void => {
      candidate.push(priority, nextId)
      reference.push(priority, nextId++)
      compare()
    }
    const pop = (): void => {
      expect(candidate.pop()).toBe(reference.pop())
      compare()
    }
    // Exercise growth and many ordered pops before introducing NaN.
    for (let i = 0; i < 2100; i++)
      push(priorities[i % (priorities.length - 1)]!)
    for (let i = 0; i < 1300; i++) pop()
    push(NaN)
    while (candidate.size) pop()
    for (let round = 0; round < 8; round++) {
      candidate.clear()
      reference.clear()
      compare()
      for (let i = 0; i < 8192; i++) {
        if (
          candidate.size === 0 ||
          (candidate.size < 128 && random() % 2 === 0)
        ) {
          const bits = new Uint32Array([random(), random()])
          const priority =
            i % 3 === 0
              ? new Float64Array(bits.buffer)[0]!
              : priorities[random() % priorities.length]!
          push(priority)
        } else pop()
      }
    }
  }
})
