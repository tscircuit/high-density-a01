import { expect, test } from "bun:test"
import {
  canRunNativeA01Search,
  NativeA01SearchKernel,
  type NativeA01SearchInput,
} from "../../lib/native-search/NativeA01SearchKernel"

test("native search accepts nonzero u32 stamps and clears visited state when they wrap", () => {
  const input: NativeA01SearchInput = {
    rows: 1,
    cols: 1,
    layers: 1,
    startZ: 0,
    startRow: 0,
    startCol: 0,
    endZ: 0,
    endRow: 0,
    endCol: 0,
    activeConnId: 0,
    minViaRow: 1,
    maxViaRow: -1,
    minViaCol: 1,
    maxViaCol: -1,
    stamp: 0xffff_ffff,
    cellSizeMm: 0.1,
    viaBaseCost: 1,
    ripCost: 1,
    ripTracePenalty: 1,
    ripViaPenalty: 1,
    greedyMultiplier: 1,
    penaltyCap: 5,
    usedCells: new Int32Array([-1]),
    portOwners: new Int32Array([-1]),
    usedDiagonals: new Int32Array(),
    penalties: new Float64Array(1),
    rootOverlap: new Uint8Array([1]),
    viaOffsetsDr: new Int32Array(),
    viaOffsetsDc: new Int32Array(),
  }
  for (const stamp of [0, -0, -1, 0.5, NaN, Infinity, 0x1_0000_0000]) {
    expect(canRunNativeA01Search({ ...input, stamp })).toBe(false)
  }
  expect(canRunNativeA01Search(input)).toBe(true)
  const kernel = NativeA01SearchKernel.create(input)!
  expect(kernel).not.toBeNull()
  for (const stamp of [0xffff_ffff, 1, 2]) {
    input.stamp = stamp
    kernel.begin(input)
    expect(kernel.heapSize).toBe(1)
    expect(kernel.advance(input.cellSizeMm, input, input.penaltyCap)).toBe(1)
    expect(Array.from(kernel.readGoal().cellIds)).toEqual([0])
    const visited = new Uint32Array(1)
    kernel.copyVisitedTo(visited)
    expect(visited[0]).toBe(stamp)
    kernel.clear()
  }
})
