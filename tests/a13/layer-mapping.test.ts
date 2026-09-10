import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "../../lib"

test("preserves exact terminal metadata and non-contiguous layer IDs", () => {
  const a = {
    connectionName: "a",
    portPointId: "start",
    x: -1.3,
    y: -0.33,
    z: 1,
  }
  const b = { connectionName: "a", portPointId: "end", x: 1.3, y: 0.33, z: 3 }
  const solver = new HighDensitySolverA13({
    nodeWithPortPoints: {
      capacityMeshNodeId: "layers",
      center: { x: 0, y: 0 },
      width: 2.6,
      height: 2,
      availableZ: [1, 3],
      portPoints: [a, b],
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const r = solver.getOutput()[0]!
  expect(r.route[0]).toMatchObject(a)
  expect(r.route.at(-1)).toMatchObject(b)
  expect(r.route.every((p) => p.z === 1 || p.z === 3)).toBe(true)
  expect(r.vias.length).toBeGreaterThan(0)
})
