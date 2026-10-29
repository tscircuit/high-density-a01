import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { makeNativeViaSolver, nativeViaFamilies } from "./native-via-placement-fixture"

const getSearchBudget = (solver: ReturnType<typeof makeNativeViaSolver>): number => {
  if (solver instanceof HighDensitySolverA01) {
    return solver["baseSearchBudgetIters"]
  }
  return solver["baseSearchBudgetIters"]
}

test("an allow-all native via callback preserves output, search work, and budgets", (): void => {
  for (const family of nativeViaFamilies) {
    let queries = 0
    const legacy = makeNativeViaSolver(family)
    const allowAll = makeNativeViaSolver(family, () => {
      queries++
      return true
    })
    legacy.solve()
    allowAll.solve()

    expect(legacy.solved).toBeTrue()
    expect(allowAll.solved).toBeTrue()
    expect(queries).toBeGreaterThan(0)
    expect(allowAll.getOutput()).toEqual(legacy.getOutput())
    expect(allowAll.iterations).toBe(legacy.iterations)
    expect(allowAll.MAX_ITERATIONS).toBe(legacy.MAX_ITERATIONS)
    expect(getSearchBudget(allowAll)).toBe(getSearchBudget(legacy))
  }
})
