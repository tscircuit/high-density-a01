import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import type { NodeWithPortPoints } from "../lib/types"

test("A11 rejects outside input ports without moving ports or growing bounds", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "rounded-boundary",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "net", x: -1, y: 0, z: 0 },
      { connectionName: "net", x: 1 + 2e-7, y: 0, z: 0 },
    ],
  }
  const originalNode = structuredClone(node)
  const props = { nodeWithPortPoints: node, viaDiameter: 0.3 }
  for (const solver of [
    new HighDensitySolverA01({ ...props, cellSizeMm: 0.1 }),
    new HighDensitySolverA03(props),
    new HighDensitySolverA11(props),
  ]) {
    solver.solve()
    const isNative = solver instanceof HighDensitySolverA11
    expect(solver.solved).toBe(!isNative)
    expect(solver.failed).toBe(isNative)
    expect(node).toEqual(originalNode)
    if (isNative) {
      expect(solver.error).toContain("outside original node bounds")
      expect(solver.iterations).toBeLessThanOrEqual(1)
    }
  }
})
