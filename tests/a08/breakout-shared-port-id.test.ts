import { expect, test } from "bun:test"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08BreakoutSolver } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import type { NodeWithPortPoints } from "../../lib/types"

test("A08 breakout splits shared port ids when root nets differ", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-port-id-repro",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0],
    portPoints: [
      {
        connectionName: "net-a",
        rootConnectionName: "net-a",
        portPointId: "shared-top",
        x: 0,
        y: 5,
        z: 0,
      },
      {
        connectionName: "net-b",
        rootConnectionName: "net-b",
        portPointId: "shared-top",
        x: 0,
        y: 5,
        z: 0,
      },
    ],
  }

  const solver = new HighDensitySolverA08BreakoutSolver({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 10_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const breakoutRoutes = solver.breakoutRoutes.sort((a, b) =>
    a.connectionName.localeCompare(b.connectionName),
  )
  expect(breakoutRoutes).toHaveLength(2)
  expect(breakoutRoutes.map((route) => route.anchorKey)).toEqual([
    "shared-top|net-a",
    "shared-top|net-b",
  ])
  expect(breakoutRoutes[0]!.assigned.x).toBeLessThan(
    breakoutRoutes[1]!.assigned.x,
  )

  const innerPorts = [
    ...(solver.innerNodeWithPortPoints?.portPoints ?? []),
  ].sort((a, b) => a.connectionName.localeCompare(b.connectionName))
  expect(innerPorts).toHaveLength(2)
  expect(innerPorts[0]!.x).toBeLessThan(innerPorts[1]!.x)
  expect(innerPorts[0]!.x).toBeCloseTo(breakoutRoutes[0]!.assigned.x, 6)
  expect(innerPorts[1]!.x).toBeCloseTo(breakoutRoutes[1]!.assigned.x, 6)
})
