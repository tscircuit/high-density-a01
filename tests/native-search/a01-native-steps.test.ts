import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

test("opt-in native A01 preserves every public step, live costs, heap length and terminal visualization", () => {
  for (const layers of [2, 4]) {
    const node = {
      ...sample003,
      availableZ: Array.from({ length: layers }, (_, z) => z),
    }
    const js = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints: structuredClone(node),
    })
    const native = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints: structuredClone(node),
      useNativeSearch: true,
    })
    const snapshot = (solver: HighDensitySolverA01): object => ({
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      iterations: solver.iterations,
      openSet: solver.openSet,
      active: solver.activeConnection,
      unsolved: solver.unsolvedConnections,
      output: solver.getOutput(),
    })
    while (!js.solved && !js.failed) {
      if (js.iterations === 16) {
        for (const solver of [js, native]) {
          solver.hyperParameters.ripTracePenalty = 0.625
          solver.hyperParameters.greedyMultiplier = 2.25
        }
      }
      js.step()
      native.step()
      expect(snapshot(native)).toEqual(snapshot(js))
      if (js.iterations % 64 === 0 || js.solved || js.failed)
        expect(native.visualize()).toEqual(js.visualize())
    }
    expect(native.nativeSearchSteps).toBeGreaterThan(0)
    expect(native.nativeSearchActive).toBe(false)
    expect(js.nativeSearchSteps).toBe(0)
    // Repeated terminal steps neither advance nor clear the original heap view.
    const terminal = snapshot(native)
    native.step()
    native.step()
    expect(snapshot(native)).toEqual(terminal)
  }
})
