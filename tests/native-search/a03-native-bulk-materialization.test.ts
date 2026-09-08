import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import type { NativeA03Snapshot } from "../../lib/native-search/decodeNativeA03Snapshot"
import sample003 from "../dataset01/sample003/sample003.json"

const bytes = (value: ArrayBufferView): Uint8Array =>
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
const equalBytes = (
  actual: ArrayBufferView,
  expected: ArrayBufferView,
): void => {
  expect(actual.constructor).toBe(expected.constructor)
  const a = bytes(actual)
  const b = bytes(expected)
  expect(a.length).toBe(b.length)
  let identical = true
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      identical = false
      break
    }
  }
  expect(identical).toBe(true)
}
const publicState = (solver: any): unknown => ({
  iterations: solver.iterations,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  progress: solver.progress,
  openSet: solver.openSet,
  active: solver.activeConnection,
  search: solver.searchIterations,
  skips: solver.consecutiveSkips,
  unsolved: solver.unsolvedConnections,
  rips: solver.ripCount,
  output: solver.getOutput(),
})
const checkStorage = (solver: any, expected: NativeA03Snapshot): void => {
  expect(solver.heap.size).toBe(expected.heap.length)
  equalBytes(solver.heap.f, expected.heap.f)
  equalBytes(solver.heap.id, expected.heap.id)
  expect(solver.nodePool.length).toBe(expected.nodes.length)
  for (const key of [
    "z",
    "cellId",
    "g",
    "parent",
    "ripHead",
    "ripCount",
  ] as const)
    equalBytes(solver.nodePool[key], expected.nodes[key])
  expect(solver.ripChain.length).toBe(expected.rips.length)
  equalBytes(solver.ripChain.connId, expected.rips.connId)
  equalBytes(solver.ripChain.prev, expected.rips.prev)
  for (const [actual, key] of [
    ["visitedStamp", "visited"],
    ["visitedFlatStamp", "visitedFlat"],
    ["bestGStamp", "bestStamp"],
    ["bestGValue", "bestG"],
    ["layerOccupantStamp", "layerStamp"],
  ] as const)
    equalBytes(solver[actual], expected[key])
  expect(Object.is(solver._moveCost, expected.moveCost)).toBe(true)
  expect(solver._moveRippedHead).toBe(expected.moveHead)
  expect(Object.is(solver._moveRipCount, expected.moveRipCount)).toBe(true)
  expect(solver._viaOccs).toEqual(expected.viaScratch)
  expect(solver._cellOccs).toEqual(expected.cellScratch)
  expect(solver._layerOccs).toEqual(expected.layerScratch)
  expect(Array.from(solver.viaOccupantsByCell)).toEqual(
    Array.from(expected.viaOccupants),
  )
  expect(solver.layerOccupantsByCell).toEqual(expected.layerOccupants)
}

test("bulk native materialization matches the retained full ABI at goals, budgets, fallback, MAX and setup boundaries", () => {
  let boundaries = 0
  for (const control of [
    "goals",
    "budget",
    "fallback",
    "MAX",
    "setup",
  ] as const) {
    for (const layers of [2, 4]) {
      const create = (native: boolean): any =>
        new HighDensitySolverA03({
          ...defaultA03Params,
          nodeWithPortPoints: {
            ...structuredClone(sample003),
            availableZ: Array.from({ length: layers }, (_, i) => i),
          },
          useNativeSearch: native,
        })
      const js = create(false)
      const native = create(true)
      const original = native.materializeNativeSearch
      let checked = 0
      // This transport boundary is not a search hook. Compare the new copies to
      // the independently retained ABI 40/41 decoders before finalization clears
      // or mutates any state, including full unused backing and NaN bit patterns.
      native.materializeNativeSearch = function (): void {
        if (!this.nativeActive) return Reflect.apply(original, this, [])
        const expected = this.nativeKernel.snapshot() as NativeA03Snapshot
        const distances = this.nativeKernel.distanceSnapshot()
        const heap = this.heap
        const footprints = this.viaFootprintByCell
        const footprintEntries = Array.from(footprints) as Array<
          [number, Int32Array]
        >
        const map = this.distanceByGoal
        const tables = new Map<number, any>(map)
        const tableArrays = new Map(
          Array.from(tables, ([key, table]) => [
            key,
            [table.dx, table.dy, table.distance, table.valid],
          ]),
        )
        Reflect.apply(original, this, [])
        checkStorage(this, expected)
        expect(this.heap).toBe(heap)
        expect(this.viaFootprintByCell).toBe(footprints)
        for (const [key, value] of footprintEntries)
          expect(footprints.get(key)).toBe(value)
        expect(this.distanceByGoal).toBe(map)
        expect(Array.from(map.keys())).toEqual(
          Array.from(distances.tables.keys()),
        )
        for (const [key, table] of distances.tables as Map<number, any>) {
          const actual = map.get(key)
          const previous = tables.get(key)
          if (previous && previous.valid.length === table.valid.length) {
            expect(actual).toBe(previous)
            const retained = tableArrays.get(key)!
            for (const [i, field] of [
              "dx",
              "dy",
              "distance",
              "valid",
            ].entries())
              expect(actual[field]).toBe(retained[i])
          }
          for (const field of ["dx", "dy", "distance", "valid"])
            equalBytes(actual[field], table[field])
        }
        expect(this.distanceCacheCapacity).toBe(distances.capacity)
        expect(this.distanceCacheSlots).toBe(distances.slots)
        expect(this.nativeSearchActive).toBe(false)
        checked++
        boundaries++
      }
      for (let i = 0; i < 100; i++) {
        js.step()
        native.step()
      }
      expect(native.nativeSearchActive).toBe(true)
      expect(native.nativeSearchSteps).toBeGreaterThan(0)
      for (const solver of [js, native]) {
        if (control === "budget") solver.baseSearchBudgetIters = 3
        if (control === "MAX") solver.MAX_ITERATIONS = solver.iterations + 1
        if (control === "fallback") {
          const computeH = solver.computeH
          solver.computeH = function (...args: number[]): number {
            return Reflect.apply(computeH, this, args)
          }
        }
        if (control === "setup") {
          solver.lowResolutionCellSize = 0
          solver._setup()
        }
      }
      for (let i = 0; i < 6000 && !js.solved && !js.failed; i++) {
        js.step()
        native.step()
        expect(publicState(native)).toEqual(publicState(js))
        if (checked >= (control === "goals" ? 2 : 1)) break
      }
      expect(checked).toBeGreaterThan(0)
      expect(publicState(native)).toEqual(publicState(js))
      expect(native.visualize()).toEqual(js.visualize())
    }
  }
  expect(boundaries).toBeGreaterThanOrEqual(10)
})
