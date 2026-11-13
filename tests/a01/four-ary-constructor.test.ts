import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01 constructor replay preserves the opt-in heap and original default", (): void => {
  const props = {
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  }
  const original = new HighDensitySolverA01(props)
  expect(original.enableFourAryHeap).toBe(false)
  expect(original.getConstructorParams()[0].enableFourAryHeap).toBeUndefined()
  const actual = new HighDensitySolverA01({ ...props, enableFourAryHeap: true })
  const replay = new HighDensitySolverA01(...actual.getConstructorParams())
  expect(replay.enableFourAryHeap).toBe(true)
  actual.solve()
  replay.solve()
  expect(actual.solved).toBe(true)
  expect(replay.iterations).toBe(actual.iterations)
  expect(replay.getOutput()).toEqual(actual.getOutput())
})
