import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01 releases spare nodes on success and iteration-budget exhaustion", (): void => {
  for (const outcome of ["solved", "exhausted"] as const) {
    const solver = new HighDensitySolverA01({
      nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
      cellSizeMm: 0.1,
      viaDiameter: 0.3,
    })
    solver.setup()
    solver["nodePool"] = Array.from({ length: 64 }, () => ({
      z: 0, row: 0, col: 0, g: 0, parentIdx: -1, ripped: null,
    }))
    solver["resetNodePool"]()
    expect(solver["recycledSearchNodes"].length).toBe(64)
    if (outcome === "solved") solver["unsolvedSegs"] = []
    else solver.MAX_ITERATIONS = 1
    solver.step()
    expect(solver["recycledSearchNodes"]).toEqual([])
    expect(solver.solved).toBe(outcome === "solved")
    expect(solver.failed).toBe(outcome === "exhausted")
    expect(solver.iterations).toBe(1)
    if (outcome === "exhausted") {
      expect(solver.error).toBe("HighDensitySolverA01 ran out of iterations")
      expect(solver["nodePool"].length).toBe(1)
    }
  }
})
