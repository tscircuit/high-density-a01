import { expect, test } from "bun:test"
import { HighDensitySolverA13, findRouteGeometryViolations } from "../../lib"

test("retains provisional connections and never accepts an unresolved crossing", () => {
  const solver = new HighDensitySolverA13({
    nodeWithPortPoints: {
      capacityMeshNodeId: "impossible-planar-cross",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0],
      portPoints: [
        { connectionName: "a", x: -2, y: 0, z: 0 },
        { connectionName: "a", x: 2, y: 0, z: 0 },
        { connectionName: "b", x: 0, y: -2, z: 0 },
        { connectionName: "b", x: 0, y: 2, z: 0 },
      ],
    },
    maxRounds: 3,
  })
  let previousCount = 0
  while (!solver.solved && !solver.failed) {
    solver.step()
    expect(solver.routedCount).toBeGreaterThanOrEqual(previousCount)
    previousCount = solver.routedCount
  }
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.routedCount).toBe(2)
  expect(solver.rerouteCount).toBeGreaterThan(0)
  expect(
    findRouteGeometryViolations(solver.getOutput()).length,
  ).toBeGreaterThan(0)
})
