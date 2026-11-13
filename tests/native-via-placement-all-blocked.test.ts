import { expect, test } from "bun:test"
import { makeNativeViaSolver, nativeViaFamilies } from "./native-via-placement-fixture"

test("blocking every native via reports an unsolved cross-layer connection", (): void => {
  for (const family of nativeViaFamilies) {
    let queries = 0
    const solver = makeNativeViaSolver(family, () => {
      queries++
      return false
    })
    solver.solve()

    expect(queries).toBeGreaterThan(0)
    expect(solver.failed).toBeTrue()
    expect(solver.solved).toBeFalse()
    expect(solver.error).toContain("No path found")
    expect(solver.getOutput()).toEqual([])
  }
})
