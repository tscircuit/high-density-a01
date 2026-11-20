import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("restoring via landings preserves both terminals of a single-cell wire", (): void => {
  const terminals = [
    { x: -0.23, y: -0.17, z: 0, connectionName: "signal" },
    { x: -0.21, y: -0.16, z: 0, connectionName: "signal" },
  ]
  const solver = new HighDensitySolverA03({
    viaDiameter: 0.3,
    nodeWithPortPoints: {
      capacityMeshNodeId: "single-cell-wire",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      portPoints: terminals,
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toHaveLength(1)
  expect(solver.getOutput()[0]!.route).toEqual(terminals)
  expect(solver.getOutput()[0]!.vias).toHaveLength(0)
})
