import { expect, test } from "bun:test"
import { createObstacleSolvers } from "./fixtures/createObstacleSolvers"

test("omitted and empty obstacles preserve the same routing and iteration count", (): void => {
  const node = {
    capacityMeshNodeId: "no-obstacles",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "signal" },
      { x: 1, y: 0, z: 1, connectionName: "signal" },
    ],
  }
  const withoutObstacles = createObstacleSolvers(node)
  const withEmptyObstacles = createObstacleSolvers(node, [])
  for (let i = 0; i < withoutObstacles.length; i++) {
    const baseline = withoutObstacles[i]!
    const empty = withEmptyObstacles[i]!
    baseline.solve()
    empty.solve()
    expect(baseline.solved).toBeTrue()
    expect(empty.getOutput()).toEqual(baseline.getOutput())
    expect(empty.iterations).toBe(baseline.iterations)
  }
})
