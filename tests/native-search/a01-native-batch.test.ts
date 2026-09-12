import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

const make = (layers = 2) =>
  new HighDensitySolverA01({
    ...defaultParams,
    useNativeSearch: true,
    nodeWithPortPoints: {
      ...structuredClone(sample003),
      availableZ: Array.from({ length: layers }, (_, z) => z),
    },
  })
const snapshot = (s: HighDensitySolverA01) => ({
  iterations: s.iterations,
  solved: s.solved,
  failed: s.failed,
  error: s.error,
  progress: s.progress,
  openSet: s.openSet,
  active: s.activeConnection,
  unsolved: s.unsolvedConnections,
  output: s.getOutput(),
  searchIterations: (s as any).searchIterations,
  skips: (s as any).consecutiveSkips,
  rips: (s as any).totalRipEvents,
  nativeSteps: s.nativeSearchSteps,
})

test("native batches preserve individual steps, live costs and every budget/terminal boundary", () => {
  for (const layers of [2, 4, 6])
    for (const mode of [
      "normal",
      "search-budget",
      "iteration-budget",
      "rip-budget",
      "live-cost",
    ] as const) {
      const single = make(layers),
        batch = make(layers)
      for (const solver of [single, batch]) {
        solver.setup()
        if (mode === "search-budget") (solver as any).baseSearchBudgetIters = 2
        if (mode === "iteration-budget") solver.MAX_ITERATIONS = 105
        if (mode === "rip-budget") solver.MAX_RIPS = 0
      }
      expect(batch.stepNativeBatch(100)).toBe(0)
      const chunks = [1, 2, 99, 100, 101, 7]
      let rounds = 0
      while (!single.solved && !single.failed) {
        if (mode === "live-cost" && rounds === 3)
          for (const solver of [single, batch]) {
            solver.hyperParameters.greedyMultiplier = 0.875
            solver.hyperParameters.viaBaseCost = 0.35
            solver.hyperParameters.ripCost = 3.25
          }
        const chunk = chunks[rounds++ % chunks.length]!
        for (let i = 0; i < chunk; i++) single.step()
        for (let i = 0; i < chunk; ) {
          const consumed = batch.stepNativeBatch(chunk - i)
          expect(consumed).toBeGreaterThanOrEqual(0)
          expect(consumed).toBeLessThanOrEqual(chunk - i)
          if (consumed === 0) {
            batch.step()
            i++
          } else i += consumed
        }
        expect(snapshot(batch)).toEqual(snapshot(single))
        if (rounds % 7 === 0 || single.solved || single.failed)
          expect(batch.visualize()).toEqual(single.visualize())
      }
      expect(batch.nativeSearchBatchedSteps).toBeGreaterThan(0)
      expect(batch.stepNativeBatch(100)).toBe(0)
    }
})
