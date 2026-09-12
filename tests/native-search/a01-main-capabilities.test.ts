import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA11 } from "../../lib/HighDensitySolverA11/HighDensitySolverA11"
import sample003 from "../dataset01/sample003/sample003.json"

class HistoryCostSolver extends HighDensitySolverA01 {
  protected override ripHistoryCostMultiplier = 1
}

class ExactClearanceSolver extends HighDensitySolverA01 {
  protected override useExactViaTraceClearance = true
}

class CustomRipCostSolver extends HighDensitySolverA01 {
  ripCostReads = 0
  protected override getRipCost(connId: number): number {
    this.ripCostReads++
    return super.getRipCost(connId) + 0.125
  }
}

test("native opt-in preserves upstream exact-clearance, history and custom rip-cost solvers through JS fallback", () => {
  for (const Solver of [
    HistoryCostSolver,
    ExactClearanceSolver,
    CustomRipCostSolver,
    HighDensitySolverA11,
  ]) {
    const make = (useNativeSearch: boolean) =>
      new Solver({
        ...defaultParams,
        nodeWithPortPoints: structuredClone(sample003),
        useNativeSearch,
      })
    const js = make(false),
      optedIn = make(true)
    const snapshot = (solver: HighDensitySolverA01) => ({
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      iterations: solver.iterations,
      openSet: solver.openSet,
      active: solver.activeConnection,
      output: solver.getOutput(),
      reads:
        solver instanceof CustomRipCostSolver ? solver.ripCostReads : undefined,
    })
    for (let call = 0; call < 5000 && !js.solved && !js.failed; call++) {
      js.step()
      optedIn.step()
      expect(snapshot(optedIn)).toEqual(snapshot(js))
      expect(optedIn.nativeSearchActive).toBe(false)
      expect(optedIn.nativeSearchSteps).toBe(0)
    }
    if (optedIn instanceof CustomRipCostSolver)
      expect(optedIn.ripCostReads).toBeGreaterThan(0)
  }
})
