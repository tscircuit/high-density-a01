import { expect, test } from "bun:test"
import {
  createPreflightSolver,
  findLaterRow,
  fullPreflightState,
  setRawNaNEdge,
  warmPreflightSolver,
} from "./a03-native-preflight-helpers"

test("a later invalid row stops native batches before its pop with exact completed counters, FIFO and budget boundaries", () => {
  for (const layers of [2, 4]) {
    const row = findLaterRow(layers)
    expect(row.pops).toBeGreaterThan(0)
    for (const limit of ["ordinary", "batch", "budget", "MAX"] as const) {
      const js = createPreflightSolver(false, layers)
      const native = createPreflightSolver(true, layers)
      warmPreflightSolver(js)
      warmPreflightSolver(native)
      expect(native.nativeSearchActive).toBe(true)
      expect(fullPreflightState(native)).toBe(fullPreflightState(js))
      const before = native.nativeSearchSteps
      const beforeBatched = native.nativeSearchBatchedSteps
      const distanceMap = native.distanceByGoal
      for (const solver of [js, native]) {
        setRawNaNEdge(solver, row.edge)
        if (limit === "budget")
          solver.baseSearchBudgetIters = solver.searchIterations + row.pops + 1
        if (limit === "MAX")
          solver.MAX_ITERATIONS = solver.iterations + row.pops + 2
      }
      if (limit === "ordinary") {
        for (let i = 0; i < row.pops; i++) {
          js.step()
          native.step()
          expect(native.nativeSearchActive).toBe(true)
          expect(fullPreflightState(native)).toBe(fullPreflightState(js))
        }
      } else {
        const completed = native.stepNativeBatch(row.pops + 5)
        expect(completed).toBe(row.pops)
        expect(native.nativeSearchActive).toBe(false)
        expect(native.nativeDeclined).toBe(true)
        expect(native.nativeSearchBatchedSteps - beforeBatched).toBe(row.pops)
        for (let i = 0; i < completed; i++) js.step()
        expect(fullPreflightState(native)).toBe(fullPreflightState(js))
      }
      expect(native.nativeSearchSteps - before).toBe(row.pops)
      for (let i = 0; i < 5 && !js.solved && !js.failed; i++) {
        js.step()
        native.step()
        expect(fullPreflightState(native)).toBe(fullPreflightState(js))
        expect(native.nativeSearchActive).toBe(false)
        expect(native.nativeDeclined).toBe(true)
        expect(native.nativeSearchSteps - before).toBe(row.pops)
      }
      expect(native.distanceByGoal).toBe(distanceMap)
      expect(native.visualize()).toEqual(js.visualize())
    }
  }
})
