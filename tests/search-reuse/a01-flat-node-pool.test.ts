import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

type RippedNode = { id: number; prev: RippedNode | null }
type SearchState = {
  nodePool: {
    cellIdx: Float64Array
    g: Float64Array
    parentIdx: Int32Array
    ripped: Array<RippedNode | null>
    length: number
    push(
      cellIdx: number,
      g: number,
      parentIdx: number,
      ripped: RippedNode | null,
    ): number
    clear(): void
  }
  heap: { push(f: number, id: number): void; pop(): number; size: number }
}

test("flat node storage preserves large cell IDs and node sequence across typed-array growth and reuse", () => {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: sample003,
  })
  solver.setup()
  const { nodePool: pool, heap } = solver as unknown as SearchState
  const cellIds = [
    0,
    0x7fffffff,
    0x80000000,
    0xffffffff,
    0x100000001,
    Number.MAX_SAFE_INTEGER,
  ]
  const rip: RippedNode = { id: 7, prev: { id: 3, prev: null } }
  for (let id = 0; id < 4097; id++) {
    expect(pool.push(cellIds[id % cellIds.length]!, id / 10, id - 1, rip)).toBe(
      id,
    )
    heap.push(1, id)
  }
  expect(pool.cellIdx).toBeInstanceOf(Float64Array)
  expect(pool.g).toBeInstanceOf(Float64Array)
  expect(pool.parentIdx).toBeInstanceOf(Int32Array)
  expect(pool.cellIdx.length).toBe(8192)
  expect(pool.length).toBe(4097)
  for (let id = 0; id < pool.length; id++) {
    expect(pool.cellIdx[id]).toBe(cellIds[id % cellIds.length])
    expect(pool.g[id]).toBe(id / 10)
    expect(pool.parentIdx[id]).toBe(id - 1)
    expect(pool.ripped[id]).toBe(rip)
    expect(heap.pop()).toBe(id)
  }
  expect(heap.size).toBe(0)
  const cellStorage = pool.cellIdx
  const costStorage = pool.g
  const parentStorage = pool.parentIdx
  pool.clear()
  expect(pool.length).toBe(0)
  expect(pool.ripped).toHaveLength(0)
  expect(pool.push(0x100000001, 3.25, -1, null)).toBe(0)
  expect(pool.cellIdx).toBe(cellStorage)
  expect(pool.g).toBe(costStorage)
  expect(pool.parentIdx).toBe(parentStorage)
  expect(pool.cellIdx[0]).toBe(0x100000001)
  expect(pool.g[0]).toBe(3.25)
  expect(pool.parentIdx[0]).toBe(-1)
  expect(pool.ripped[0]).toBeNull()
})
