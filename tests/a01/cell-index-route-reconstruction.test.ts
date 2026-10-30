import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("compact A01 nodes preserve route coordinates, parent chains and rip outcomes", (): void => {
  const outcomes = []
  let ripEvents = 0
  for (const stepMultiplier of [1, 37]) {
    for (const shuffleSeed of [0, 1, 2]) {
      const solver = new HighDensitySolverA01({
        nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
        cellSizeMm: 0.1,
        viaDiameter: 0.3,
        traceThickness: 0.1,
        traceMargin: 0.1,
        stepMultiplier,
        hyperParameters: { shuffleSeed },
      })
      solver.solve()
      expect(solver.solved).toBe(true)
      ripEvents += solver["totalRipEvents"]
      outcomes.push({
        stepMultiplier,
        shuffleSeed,
        iterations: solver.iterations,
        ripCount: solver["ripCount"],
        output: solver.getOutput(),
      })
    }
  }
  expect(ripEvents).toBeGreaterThan(0)
  // Captured with the original coordinate-based SearchNode representation.
  expect(outcomes).toMatchSnapshot()
})
