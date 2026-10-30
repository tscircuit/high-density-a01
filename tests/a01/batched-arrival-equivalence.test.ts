import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

const stateKeys = [
  "solved",
  "failed",
  "iterations",
  "error",
  "progress",
  "nodePool",
  "seqCounter",
  "searchIterations",
  "activeConnSeg",
  "unsolvedSegs",
  "solvedRoutes",
  "ripCount",
  "totalRipEvents",
  "penalty2d",
  "usedCellsFlat",
  "usedDiagFlat",
  "visitedStamp",
] as const

for (const stepMultiplier of [1, 37]) {
  test(`batched arrivals preserve state at mixed boundaries (multiplier ${stepMultiplier})`, () => {
    for (const shuffleSeed of [0, 1, 2]) {
      for (const limit of [10, 101.5, Infinity]) {
        const props = {
          nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
          cellSizeMm: 0.1,
          viaDiameter: 0.3,
          traceThickness: 0.1,
          traceMargin: 0.1,
          stepMultiplier,
          hyperParameters: { shuffleSeed },
        }
        const actual = new HighDensitySolverA01(structuredClone(props))
        const reference = new HighDensitySolverA01(structuredClone(props))
        actual.setup()
        reference.setup()
        if (Number.isFinite(limit)) {
          actual.MAX_ITERATIONS = limit
          reference.MAX_ITERATIONS = limit
        }
        // Convert an already populated heap, not only an empty search.
        for (let i = 0; i < 7; i++) {
          actual.step()
          reference.step()
        }
        let batchIndex = 0
        while (!reference.solved && !reference.failed) {
          const count = [0, 1, 2, 37, 100, 1000][batchIndex++ % 6]!
          actual.stepBatch(count)
          for (let i = 0; i < count; i++) reference.step()
          for (const key of stateKeys)
            expect(actual[key]).toEqual(reference[key])
          expect(actual["heap"].size).toBe(reference["heap"].size)
          // Single steps can be interleaved after conversion too.
          actual.step()
          reference.step()
        }
        actual.stepBatch(1000)
        expect(actual.getOutput()).toEqual(reference.getOutput())
        for (const key of stateKeys) expect(actual[key]).toEqual(reference[key])
      }
    }
  })
}

test("batching preserves progress callbacks and rejects invalid counts", () => {
  class ObservedSolver extends HighDensitySolverA01 {
    calls = 0
    computeProgress() {
      return ++this.calls
    }
  }
  const props = {
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  }
  const actual = new ObservedSolver(props)
  const reference = new ObservedSolver(props)
  actual.stepBatch(100)
  for (let i = 0; i < 100; i++) reference.step()
  expect(actual.calls).toBe(reference.calls)
  for (const key of stateKeys) expect(actual[key]).toEqual(reference[key])
  for (const count of [-1, 0.5, NaN, Infinity]) {
    expect(() => actual.stepBatch(count)).toThrow()
  }
})
