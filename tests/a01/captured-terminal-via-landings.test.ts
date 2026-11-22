import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"

test("captured regional route loses its via landings during export", async (): Promise<void> => {
  // Minimized from a captured regional solve: five connection pairs, six
  // layers, grid size and copper dimensions retained. Identities are
  // anonymized and coordinates are translated to the local origin.
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "captured-region",
      center: { x: 0, y: 0 },
      width: 3.432,
      height: 3.432,
      availableZ: [0, 1, 2, 3, 4, 5],
      portPoints: [
        { x: 0.4, y: 0, z: 0, connectionName: "signal_0" },
        { x: -0.4, y: 0, z: 0, connectionName: "signal_0" },
        {
          x: 0.858,
          y: -0.57630434782605,
          z: 0,
          connectionName: "signal_1",
        },
        {
          x: 0.858,
          y: -0.57632989690718,
          z: 5,
          connectionName: "signal_1",
        },
        { x: 0, y: -0.8, z: 0, connectionName: "signal_2" },
        { x: -0.858, y: -0.8, z: 0, connectionName: "signal_2" },
        { x: 0, y: 0.8, z: 0, connectionName: "signal_3" },
        { x: -0.858, y: 0.8, z: 0, connectionName: "signal_3" },
        { x: 0.858, y: 0.8452, z: 0, connectionName: "signal_4" },
        {
          x: -0.858,
          y: -0.03154953652639,
          z: 0,
          connectionName: "signal_4",
        },
      ],
    },
    cellSizeMm: 0.1,
    viaDiameter: 0.56,
    traceThickness: 0.1778,
    traceMargin: 0.178,
    viaMinDistFromBorder: 0.28,
    hyperParameters: {
      shuffleSeed: 0,
      ripCost: 10,
      ripTracePenalty: 0.5,
      ripViaPenalty: 0.75,
      viaBaseCost: 0.1,
      greedyMultiplier: 1.5,
    },
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.error).toBeNull()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(5)
  const route = routes.find((route) => route.connectionName === "signal_1")!
  expect(route.route[0]).toMatchObject(solver.nodeWithPortPoints.portPoints[2]!)
  expect(route.route.at(-1)).toMatchObject(
    solver.nodeWithPortPoints.portPoints[3]!,
  )
  expect(route.vias).toHaveLength(1)
  const via = route.vias[0]!
  const landingLayers = route.route
    .filter((point) => Math.hypot(point.x - via.x, point.y - via.y) < 1e-9)
    .map((point) => point.z)
  expect(landingLayers).toEqual([])

  await expect(
    getSvgFromGraphicsObject(solver.visualize({ showViaLandings: true }), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
