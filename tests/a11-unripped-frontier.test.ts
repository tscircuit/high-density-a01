import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import { getRouteGeometryViolationError } from "../lib/routeGeometryValidation"
import type { NodeWithPortPoints } from "../lib/types"

class UnprunedA11 extends HighDensitySolverA11 {
  protected override pruneUnrippedVisits = false
}

test("A11 removes dominated queue entries without changing a routed crossing", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "unripped-frontier",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "horizontal", x: -2, y: 0, z: 0 },
      { connectionName: "horizontal", x: 2, y: 0, z: 0 },
      { connectionName: "vertical", x: 0, y: -2, z: 0 },
      { connectionName: "vertical", x: 0, y: 2, z: 0 },
    ],
  }
  const props = {
    nodeWithPortPoints,
    traceThickness: 0.15,
    traceMargin: 0.1,
    viaDiameter: 0.3,
  }
  const unpruned = new UnprunedA11(props)
  const pruned = new HighDensitySolverA11(props)
  unpruned.solve()
  pruned.solve()
  expect(unpruned.solved).toBe(true)
  expect(pruned.solved).toBe(true)
  expect(pruned.iterations).toBeLessThan(unpruned.iterations)
  expect(pruned.getOutput()).toEqual(unpruned.getOutput())
  expect(getRouteGeometryViolationError(pruned.getOutput())).toBeNull()
})
