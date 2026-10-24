import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

export function createA03Heap(): HighDensitySolverA03["heap"] {
  const solver = new HighDensitySolverA03({
    viaDiameter: 0.3,
    nodeWithPortPoints: {
      capacityMeshNodeId: "heap-test",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [],
    },
  })
  solver.setup()
  return solver["heap"]
}
