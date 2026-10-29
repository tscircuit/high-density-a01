import { expect, test } from "bun:test"
import { makeNativeViaSolver, nativeViaFamilies } from "./native-via-placement-fixture"

test("native via guidance preserves the validator exception", (): void => {
  for (const family of nativeViaFamilies) {
    const sentinel = new Error(`invalid original placement in ${family}`)
    const solver = makeNativeViaSolver(family, () => {
      throw sentinel
    })
    let caught: unknown
    try {
      solver.solve()
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(sentinel)
    expect(solver.solved).toBeFalse()
  }
})
