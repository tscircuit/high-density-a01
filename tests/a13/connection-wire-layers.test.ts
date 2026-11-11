import { expect, test } from "bun:test"
import { HighDensitySolverA13, findRouteGeometryViolations } from "../../lib"
import type { NodeWithPortPoints } from "../../lib/types"

test("A13 guides each connection on its own wire layers without blocking through vias", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "mixed-wire-layers",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    portPoints: [
      { connectionName: "bus", x: -2, y: 0, z: 0 },
      { connectionName: "bus", x: 2, y: 0, z: 0 },
      // A foreign top-layer terminal wall forces the bus to change layers.
      ...Array.from({ length: 14 }, (_, i) => ({
        connectionName: "wall",
        x: 0,
        y: -1.95 + i * 0.3,
        z: 0,
      })),
      { connectionName: "unrestricted", x: -2, y: 1.5, z: 7 },
      { connectionName: "unrestricted", x: 2, y: 1.5, z: 7 },
    ],
  }
  const control = new HighDensitySolverA13({
    nodeWithPortPoints: node,
    searchBackend: "javascript",
  })
  control.solve()
  expect(control.solved).toBe(true)
  const solver = new HighDensitySolverA13({
    nodeWithPortPoints: {
      ...node,
      allowedZByConnectionName: { bus: [0, 2] },
    },
    searchBackend: "javascript",
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const routes = solver.getOutput()
  const bus = routes.find((route) => route.connectionName === "bus")!
  const wireLayers = (route: typeof bus): number[] =>
    route.route.flatMap((b, i) => {
      const a = route.route[i - 1]
      return a && a.z === b.z && (a.x !== b.x || a.y !== b.y) ? [a.z] : []
    })
  expect(
    wireLayers(
      control.getOutput().find((route) => route.connectionName === "bus")!,
    ).some((z) => z !== 0 && z !== 2),
  ).toBe(true)
  expect(wireLayers(bus).every((z) => z === 0 || z === 2)).toBe(true)
  expect(bus.vias.length).toBeGreaterThan(0)
  expect(
    wireLayers(
      routes.find((route) => route.connectionName === "unrestricted")!,
    ),
  ).toContain(7)
  expect(
    findRouteGeometryViolations(
      routes.map((route) => ({
        ...route,
        traceThickness: route.traceThickness + 0.1,
        viaDiameter: route.viaDiameter + 0.1,
      })),
    ),
  ).toEqual([])
  expect(
    () =>
      new HighDensitySolverA13({
        nodeWithPortPoints: { ...node, allowedZByConnectionName: { bus: [1] } },
      }),
  ).toThrow('connection "bus" has a terminal outside its allowed wire layers')
  expect(
    () =>
      new HighDensitySolverA13({
        nodeWithPortPoints: { ...node, allowedZByConnectionName: { bus: [] } },
      }),
  ).toThrow('connection "bus" has invalid allowed wire layers')
})
