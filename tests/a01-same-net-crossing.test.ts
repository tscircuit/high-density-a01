import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { PortPoint } from "../lib/types"

test("distinct same-net routes can share copper without a duplicate route", (): void => {
  for (const sameNet of [true, false]) {
    const portPoints: PortPoint[] = [
      {
        connectionName: "first",
        rootConnectionName: "shared",
        x: -1,
        y: -1,
        z: 0,
      },
      {
        connectionName: "first",
        rootConnectionName: "shared",
        x: 1,
        y: 1,
        z: 0,
      },
      {
        connectionName: "second",
        rootConnectionName: sameNet ? "shared" : "foreign",
        x: -1,
        y: 1,
        z: 0,
      },
      {
        connectionName: "second",
        rootConnectionName: sameNet ? "shared" : "foreign",
        x: 1,
        y: -1,
        z: 0,
      },
    ]
    const originalPorts = structuredClone(portPoints)
    const solver = new HighDensitySolverA01({
      nodeWithPortPoints: {
        capacityMeshNodeId: "crossing",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0],
        portPoints,
      },
      cellSizeMm: 0.2,
      viaDiameter: 0.3,
      traceThickness: 0.1,
      traceMargin: 0.1,
      hyperParameters: { shuffleSeed: 0 },
    })
    solver.solve()

    // Alternating boundary endpoints must cross on this single layer. That
    // junction is valid only when both routes belong to the same physical net.
    expect(solver.solved).toBe(sameNet)
    expect(solver.failed).toBe(!sameNet)
    expect(portPoints).toEqual(originalPorts)
    if (!sameNet) continue

    const routes = solver.getOutput()
    expect(routes).toHaveLength(2)
    for (const route of routes) {
      const terminals = portPoints.filter(
        (point): boolean => point.connectionName === route.connectionName,
      )
      expect(route.route[0]).toEqual(terminals[0])
      expect(route.route.at(-1)).toEqual(terminals[1])
      expect(route.rootConnectionName).toBe("shared")
      expect(route.traceThickness).toBe(0.1)
      expect(route.vias).toEqual([])
      expect(route.route.every((point): boolean => point.z === 0)).toBe(true)
    }
  }
})
