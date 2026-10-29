import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 inspection before setup does not allocate a large grid", (): void => {
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "unallocated-region",
      center: { x: 100, y: 200 },
      width: 256,
      height: 128,
      availableZ: [0, 1],
      portPoints: [
        { x: -20, y: 200, z: 0, connectionName: "a" },
        { x: 220, y: 200, z: 1, connectionName: "a" },
      ],
    },
    viaDiameter: 0.6,
    maxIterations: 100_000,
  })

  expect(solver.solvedConnectionsMap.size).toBe(0)
  expect(solver.getOutput()).toEqual([])
  const graphics = solver.visualize()
  expect(graphics.points).toHaveLength(2)
  expect(graphics.lines).toHaveLength(0)
  expect(graphics.rects).toHaveLength(1)
  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toContain("<svg")
  expect(solver.gridStats.states).toBe(0)
  expect(solver._setupDone).toBe(false)
  expect(solver.iterations).toBe(0)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
})
