import { expect, test } from "bun:test"
import { makeNativeViaSolver, nativeViaFamilies } from "./native-via-placement-fixture"

test("native via guidance rejects a blocked corridor while finding a legal alternative", (): void => {
  for (const family of nativeViaFamilies) {
    let rejected = 0
    let accepted = 0
    const solver = makeNativeViaSolver(family, (placement) => {
      const allowed = placement.x < 9
      if (allowed) accepted++
      else rejected++
      return allowed
    })
    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(rejected).toBeGreaterThan(0)
    expect(accepted).toBeGreaterThan(0)
    const vias = solver.getOutput().flatMap((route) => route.vias)
    expect(vias.length).toBeGreaterThan(0)
    expect(vias.every((via) => via.x < 9)).toBeTrue()
  }
})
