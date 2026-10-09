import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import type { NodeWithPortPoints } from "../lib/types"

test("A11 releases obsolete search storage on success and iteration exhaustion", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "crossing",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "horizontal", x: -1, y: 0, z: 0 },
      { connectionName: "horizontal", x: 1, y: 0, z: 0 },
      { connectionName: "vertical", x: 0, y: -1, z: 0 },
      { connectionName: "vertical", x: 0, y: 1, z: 0 },
    ],
  }
  for (const exhaust of [false, true]) {
    const solver = new HighDensitySolverA11({
      nodeWithPortPoints,
      viaDiameter: 0.3,
      traceThickness: 0.1,
      traceMargin: 0.1,
    })
    if (exhaust) solver.MAX_ITERATIONS = 1
    solver.solve()
    expect(solver.failed).toBe(exhaust)
    expect(solver.solved).toBe(!exhaust)
    expect(solver).toHaveProperty("nodePool.length", 0)
    expect(solver).toHaveProperty("heap.f.length", 0)
    expect(solver).toHaveProperty("heap.id.length", 0)
    expect(solver).toHaveProperty("heap.seq.length", 0)
    expect(solver).toHaveProperty("portOwnerFlat.length", 0)
    expect(solver).toHaveProperty("usedDiagFlat.length", 0)
    expect(solver).toHaveProperty("bestUnrippedG.length", 0)
    expect(solver).toHaveProperty("usedIndicesByConn.length", 0)
    if (!exhaust) expect(solver.getOutput()).toHaveLength(2)
    else expect(solver.error).toContain("ran out of iterations")
  }
})
