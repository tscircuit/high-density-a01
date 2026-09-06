import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints, PortPoint } from "../lib/types"

test("same-net pair deduplication preserves exact geometry rather than grid identity", (): void => {
  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    for (const reverseDuplicate of [false, true]) {
      for (const endpointOffset of [0, 0.0003]) {
        const duplicatePoints: PortPoint[] = [
          {
            x: -1,
            y: 0,
            z: 0,
            connectionName: "duplicate",
            rootConnectionName: "shared",
          },
          {
            x: 1,
            y: endpointOffset,
            z: 0,
            connectionName: "duplicate",
            rootConnectionName: "shared",
          },
        ]
        if (reverseDuplicate) duplicatePoints.reverse()
        const nodeWithPortPoints: NodeWithPortPoints = {
          capacityMeshNodeId: "exact-physical-same-net-pairs",
          center: { x: 0, y: 0 },
          width: 2,
          height: 2,
          availableZ: [0, 1],
          portPoints: [
            {
              x: -1,
              y: 0,
              z: 0,
              connectionName: "original",
              rootConnectionName: "shared",
            },
            {
              x: 1,
              y: 0,
              z: 0,
              connectionName: "original",
              rootConnectionName: "shared",
            },
            ...duplicatePoints,
          ],
        }
        const original = structuredClone(nodeWithPortPoints)
        const solver = new Solver({
          nodeWithPortPoints,
          viaDiameter: 0.3,
          cellSizeMm: 0.1,
        })
        solver.solve()
        expect(solver.solved).toBeTrue()
        expect(solver.failed).toBeFalse()
        const routes = solver.getOutput()
        expect(routes).toHaveLength(endpointOffset === 0 ? 1 : 2)
        expect(
          routes.map((route): string => route.connectionName).sort(),
        ).toEqual(
          endpointOffset === 0 ? ["original"] : ["duplicate", "original"],
        )
        for (const route of routes) {
          const terminals = original.portPoints.filter(
            (point): boolean => point.connectionName === route.connectionName,
          )
          expect(route.route[0]).toEqual(terminals[0])
          expect(route.route.at(-1)).toEqual(terminals[1])
        }
        expect(nodeWithPortPoints).toEqual(original)
      }
    }
  }
})
