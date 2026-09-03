import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../lib/types"

test("A01 and A03 retain distinct same-net terminal pairs that occupy the same grid cells", (): void => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "distinct-same-net-cell-pairs",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "a", rootConnectionName: "shared" },
      { x: 1, y: 0, z: 0, connectionName: "a", rootConnectionName: "shared" },
      { x: -1, y: 0, z: 0, connectionName: "b", rootConnectionName: "shared" },
      { x: 1, y: 0.0003, z: 0, connectionName: "b", rootConnectionName: "shared" },
    ],
  }

  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    const solver = new Solver({
      nodeWithPortPoints,
      viaDiameter: 0.3,
      cellSizeMm: 0.1,
    })
    solver.step()
    const solvedSegmentCount = [...solver.solvedConnectionsMap.values()].reduce(
      (count, routes): number => count + routes.length,
      0,
    )
    const totalSegmentCount =
      solver.unsolvedConnections.length +
      (solver.activeConnection ? 1 : 0) +
      solvedSegmentCount

    expect(totalSegmentCount).toBe(2)

    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const output = solver.getOutput()
    expect(output.map((route): string => route.connectionName).sort()).toEqual([
      "a",
      "b",
    ])
    for (const route of output) {
      const terminals = nodeWithPortPoints.portPoints.filter(
        (point): boolean => point.connectionName === route.connectionName,
      )
      expect(route.route[0]).toEqual(terminals[0])
      expect(route.route.at(-1)).toEqual(terminals[1])
    }
  }
})
