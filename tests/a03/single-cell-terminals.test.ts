import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"

test("A03 preserves both terminals and their net inside one search cell", (): void => {
  const portPoints = [
    { connectionName: "a", rootConnectionName: "net-a", x: 0, y: 0, z: 0 },
    { connectionName: "a", rootConnectionName: "net-a", x: 0.001, y: 0, z: 0 },
  ]
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: {
      capacityMeshNodeId: "single-cell",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints,
    },
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  const route = solver.getOutput()[0]!
  expect(route.route).toEqual(portPoints)
  expect(route.rootConnectionName).toBe("net-a")
})
